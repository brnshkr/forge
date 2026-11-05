import { file, Glob } from 'bun';
import path from 'node:path';

import {
  FORGE_DIRECTORY,
  readMakeVariable,
  readMakeVariables,
} from '#src/shared/make';

import { compareNumbers, comparePrereleases, formatPrereleaseSuffix } from '#src/shared/pins/version-tags';
import { compileLinearPattern, readGroup } from '#src/shared/utils/pattern';
import { before } from '#src/shared/utils/string';

import type { Maybe, StringRecord } from '#src/shared/types/core';
import type { Shell } from '#src/shared/utils/shell';

interface DevelopmentVersion {
  readonly kind: 'dev';
  readonly major: number;
  readonly minor?: number;
}

export interface ReleaseVersion {
  readonly kind: 'release';
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease?: string;
}

interface TaggedVersion {
  readonly tag: string;
  readonly version: ReleaseVersion;
}

interface SemverGrammar {
  readonly number: string;
  readonly prereleaseStrict: string;
}

interface GitTagOptions {
  readonly isPackagistPackage: boolean;
  readonly version: ReleaseVersion;
}

interface ImageOptions {
  readonly image: string;
  readonly suffix: string;
  readonly version: ReleaseVersion;
}

interface ImageTagOptions extends ImageOptions {
  readonly aliases: readonly string[];
}

type ReleaseTags = readonly [string, ...string[]];

const BRANCH_REFERENCE_PREFIX = 'refs/heads/';
const semverGrammarCache: { grammar?: Promise<SemverGrammar> } = {};

/**
 * @rejects {Error}
 */
const loadSemverGrammar = async (): Promise<SemverGrammar> => {
  const variables = await readMakeVariables(FORGE_DIRECTORY, {
    required: [
      'SEMVER_NUMBER',
      'SEMVER_PRERELEASE_STRICT',
    ],
  });

  return {
    number: variables.SEMVER_NUMBER,
    prereleaseStrict: variables.SEMVER_PRERELEASE_STRICT,
  };
};

/**
 * @rejects {Error}
 */
const readSemverGrammar = async (): Promise<SemverGrammar> => {
  semverGrammarCache.grammar ??= loadSemverGrammar();

  return semverGrammarCache.grammar;
};

/**
 * @rejects {Error}
 */
const createReleasePattern = async (prefix: string): Promise<RegExp> => {
  const grammar = await readSemverGrammar();

  return compileLinearPattern(
    [
      String.raw`^${prefix}(?<major>${grammar.number})\.(?<minor>${grammar.number})\.(?<patch>${grammar.number})`,
      `(?:-(?<prerelease>${grammar.prereleaseStrict}))?$`,
    ].join(''),
    'v',
  );
};

/**
 * @rejects {Error}
 */
const createDevelopmentPattern = async (): Promise<RegExp> => {
  const grammar = await readSemverGrammar();

  return compileLinearPattern(String.raw`^dev/(?<major>${grammar.number})\.(?:(?<minor>${grammar.number})|x)$`, 'v');
};

/**
 * @throws {Error}
 */
const readReleaseVersion = (groups: StringRecord): ReleaseVersion => {
  const { prerelease } = groups;

  return {
    kind: 'release',
    major: Number(readGroup(groups, 'major')),
    minor: Number(readGroup(groups, 'minor')),
    patch: Number(readGroup(groups, 'patch')),
    ...prerelease === undefined
      ? {}
      : {
        prerelease,
      },
  };
};

/**
 * @rejects {Error}
 */
export const createExactVersionPattern = async (): Promise<RegExp> => {
  const grammar = await readSemverGrammar();

  return compileLinearPattern(String.raw`^${grammar.number}\.${grammar.number}\.${grammar.number}$`, 'v');
};

/**
 * @throws {Error}
 */
const readDevelopmentVersion = (groups: StringRecord): DevelopmentVersion => {
  const { minor } = groups;

  return {
    kind: 'dev',
    major: Number(readGroup(groups, 'major')),
    ...minor === undefined
      ? {}
      : {
        minor: Number(minor),
      },
  };
};

/**
 * @rejects {Error}
 */
export const parseBranchVersion = async (
  reference: string,
): Promise<Maybe<DevelopmentVersion | ReleaseVersion>> => {
  const branch = reference.startsWith(BRANCH_REFERENCE_PREFIX)
    ? reference.slice(BRANCH_REFERENCE_PREFIX.length)
    : reference;

  const [releasePattern, developmentPattern] = await Promise.all([
    createReleasePattern('release/'),
    createDevelopmentPattern(),
  ]);

  const releaseGroups = releasePattern.exec(branch)?.groups;

  if (releaseGroups) {
    return readReleaseVersion(releaseGroups);
  }

  const developmentGroups = developmentPattern.exec(branch)?.groups;

  if (developmentGroups) {
    return readDevelopmentVersion(developmentGroups);
  }

  if (branch.startsWith('dev/') || branch.startsWith('release/')) {
    throw new Error(`Invalid branch "${branch}". Expected "release/<version>" or "dev/<major>.<minor>".`);
  }

  return undefined;
};

const compareVersions = (left: ReleaseVersion, right: ReleaseVersion): number => {
  const numberComparison = compareNumbers(
    [left.major, left.minor, left.patch],
    [right.major, right.minor, right.patch],
  );

  return numberComparison === 0 ? comparePrereleases(left.prerelease, right.prerelease) : numberComparison;
};

/**
 * @rejects {Error}
 */
const readTaggedVersions = async (tags: readonly string[]): Promise<TaggedVersion[]> => {
  const tagPattern = await createReleasePattern('v');

  return tags
    .flatMap((tag) => {
      const groups = tagPattern.exec(tag)?.groups;

      return groups === undefined
        ? []
        : [{
          tag,
          version: readReleaseVersion(groups),
        }];
    })
    .toSorted((left, right) => compareVersions(right.version, left.version));
};

/**
 * @rejects {Error}
 */
export const listVersionTags = async (shell: Shell): Promise<string[]> => {
  const tagListing = await shell`git tag --list 'v*'`.text();

  return tagListing.split('\n');
};

/**
 * @rejects {Error}
 */
export const findPredecessorTag = async (
  version: ReleaseVersion,
  tags: readonly string[],
): Promise<Maybe<string>> => {
  const taggedVersions = await readTaggedVersions(tags);

  return taggedVersions.find((taggedVersion) => compareVersions(taggedVersion.version, version) < 0)?.tag;
};

/**
 * @rejects {Error}
 */
export const findNewestRelease = async (tags: readonly string[]): Promise<Maybe<ReleaseVersion>> => {
  const taggedVersions = await readTaggedVersions(tags);
  const newestStableVersion = taggedVersions.find((taggedVersion) => taggedVersion.version.prerelease === undefined);

  return (newestStableVersion ?? taggedVersions.at(0))?.version;
};

export const formatVersion = (version: ReleaseVersion): string => [
  String(version.major),
  String(version.minor),
  `${String(version.patch)}${formatPrereleaseSuffix(version.prerelease)}`,
].join('.');

const createReleaseTags = (version: ReleaseVersion): ReleaseTags => {
  if (version.prerelease !== undefined) {
    return [formatVersion(version)];
  }

  const minorTag = `${String(version.major)}.${String(version.minor)}`;

  return version.major === 0
    ? [
      minorTag,
      formatVersion(version),
    ]
    : [
      String(version.major),
      minorTag,
      formatVersion(version),
    ];
};

const formatImageTag = (options: ImageOptions, tag: string): string => `${options.image}:${tag}${options.suffix}`;

export const createGitTags = (options: GitTagOptions): string[] => {
  const releaseTags = options.isPackagistPackage
    ? [formatVersion(options.version)]
    : createReleaseTags(options.version);

  return releaseTags.map((tag) => `v${tag}`);
};

export const createImageTags = (options: ImageTagOptions): string[] => {
  if (options.version.prerelease !== undefined) {
    return createReleaseTags(options.version).map((tag) => formatImageTag(options, tag));
  }

  const roleTags = options.suffix === '' ? [] : [`${options.image}:${options.suffix.replace(/^-/v, '')}`];

  return [
    ...[
      ...createReleaseTags(options.version),
      ...options.aliases,
    ].map((tag) => formatImageTag(options, tag)),
    ...roleTags,
  ];
};

export const createWidestImageTag = (options: ImageOptions): string => {
  const [widestTag] = createReleaseTags(options.version);

  return formatImageTag(options, widestTag);
};

export const createMergeTargets = (version: ReleaseVersion): string[] => [
  `dev/${String(version.major)}.${String(version.minor)}`,
  `dev/${String(version.major)}.x`,
];

export const getDistributionTag = (version: ReleaseVersion): string => (version.prerelease === undefined
  ? 'latest'
  : before(version.prerelease, '.'));

/**
 * @rejects {Error}
 * @rejects {ENOTDIR}
 */
export const readFragmentFiles = async (directory: string): Promise<string[]> => {
  const configDirectory = await readMakeVariable(directory, 'CONFIG_DIR');

  const fragmentFiles = await Promise.all([
    path.join(configDirectory, 'compose'),
    'compose',
  ].map(async (fragmentDirectory) => Array.fromAsync(new Glob(`${fragmentDirectory}/*.yaml`).scan(directory))));

  const runnableFiles = await Promise.all(fragmentFiles.flat().map(async (fragmentFile) => (
    /^ {4}image: /mv.test(await file(path.join(directory, fragmentFile)).text()) ? [fragmentFile] : []
  )));

  return runnableFiles.flat();
};
