import { splitWords } from '#src/shared/make';
import { readDeployTargets } from '#src/shared/release/deploys';
import { getImageName, readImageTargetsByStage } from '#src/shared/release/images';
import { findManifestIssues, readManifests, readPackageTargets } from '#src/shared/release/manifests';

import {
  createGitTags,
  createImageTags,
  createMergeTargets,
  formatVersion,
  getDistributionTag,
  parseBranchVersion,
  readFragmentFiles,
} from '#src/shared/release/versions';

import { readStringArguments } from '#src/shared/utils/arguments';
import { objectEntries } from '#src/shared/utils/object';

import type { DeployTarget } from '#src/shared/release/deploys';
import type { ImageLocation, ImageTarget } from '#src/shared/release/images';
import type { ReleaseVersion } from '#src/shared/release/versions';
import type { Maybe } from '#src/shared/types/core';

const OWN_JOB_TARGETS = new Set([
  'production',
  'testing',
]);

interface BuildTargets {
  readonly deployTargets: Readonly<Record<string, DeployTarget>>;
  readonly imageTargets: readonly ImageTarget[];
}

interface ImageOutput {
  readonly arguments: string;
  readonly cache: string;
  readonly dockerfile: string;
  readonly name: string;
  readonly tags: string;
  readonly target: string;
}

interface ImageOutputs {
  readonly all: readonly ImageOutput[];
  readonly firstWave: readonly ImageOutput[];
  readonly secondWave: readonly ImageOutput[];
}

interface StagingOutput extends DeployTarget {
  readonly target: string;
}

interface VersionOutputs {
  readonly createTags: (imageTarget: ImageTarget) => readonly string[];
  readonly release: {
    readonly distributionTag: string;
    readonly gitTags: string;
    readonly isPrerelease: boolean;
    readonly mergeTargets: string;
    readonly version: string;
  };
}

const createVersionOutputs = (
  version: Maybe<ReleaseVersion>,
  location: ImageLocation,
  isPackagistPackage: boolean,
): VersionOutputs => (version === undefined
  ? {
    createTags: () => [],
    release: {
      distributionTag: '',
      gitTags: '',
      isPrerelease: false,
      mergeTargets: '',
      version: '',
    },
  }
  : {
    createTags: (imageTarget) => createImageTags({
      aliases: imageTarget.aliases,
      image: getImageName(location, imageTarget),
      suffix: imageTarget.suffix,
      version,
    }),
    release: {
      distributionTag: getDistributionTag(version),
      gitTags: createGitTags({
        isPackagistPackage,
        version,
      }).join(' '),
      isPrerelease: version.prerelease !== undefined,
      mergeTargets: createMergeTargets(version).join(' '),
      version: formatVersion(version),
    },
  });

const createStagingOutputs = (
  deployTargets: Readonly<Record<string, DeployTarget>>,
): StagingOutput[] => objectEntries(deployTargets)
  .filter(([target]) => !OWN_JOB_TARGETS.has(target))
  .map(([target, deployTarget]) => ({
    ...deployTarget,
    target,
  }));

/**
 * @throws {Error}
 */
const isImageGroupingOn = (value: string): boolean => {
  if (!['', 'false', 'true'].includes(value)) {
    throw new Error(`Option "group-image-builds" must be "true" or "false", "${value}" given.`);
  }

  return value === 'true';
};

const readFirstWaveIndexes = (
  imageTargets: readonly ImageTarget[],
  isGroupingImageBuilds: boolean,
): ReadonlySet<number> => {
  if (!isGroupingImageBuilds) {
    return new Set(imageTargets.keys());
  }

  const baseKeys = imageTargets.map((imageTarget) => `${imageTarget.dockerfile}\0${imageTarget.base}`);

  return new Set(baseKeys.flatMap((baseKey, index) => (baseKeys.indexOf(baseKey) === index ? [index] : [])));
};

const createImageOutputs = (
  imageTargets: readonly ImageTarget[],
  versionOutputs: VersionOutputs,
  isGroupingImageBuilds: boolean,
): ImageOutputs => {
  const all = imageTargets.map((imageTarget) => ({
    arguments: imageTarget.arguments.join('\n'),
    cache: isGroupingImageBuilds ? imageTarget.dockerfile : `${imageTarget.name}-${imageTarget.target}`,
    dockerfile: imageTarget.dockerfile,
    name: imageTarget.name,
    tags: versionOutputs.createTags(imageTarget).join('\n'),
    target: imageTarget.target,
  }));

  const firstWaveIndexes = readFirstWaveIndexes(imageTargets, isGroupingImageBuilds);

  return {
    all,
    firstWave: all.filter((_imageOutput, index) => firstWaveIndexes.has(index)),
    secondWave: all.filter((_imageOutput, index) => !firstWaveIndexes.has(index)),
  };
};

/**
 * @rejects {Error}
 */
const readBuildTargets = async (directory: string, chosenDeployTargets: readonly string[]): Promise<BuildTargets> => {
  const imageTargetsByStage = await readImageTargetsByStage(directory);

  return {
    deployTargets: await readDeployTargets(directory, imageTargetsByStage, chosenDeployTargets),
    imageTargets: imageTargetsByStage.values().toArray(),
  };
};

/**
 * @rejects {Error}
 * @rejects {ENOTDIR}
 * @rejects {SyntaxError}
 */
export const main = async (argv: readonly string[], directory: string): Promise<number> => {
  const options = readStringArguments(argv, [
    'deploy-targets',
    'group-image-builds',
    'namespace',
    'reference',
    'registry',
  ]);

  const isGroupingImageBuilds = isImageGroupingOn(options['group-image-builds']);

  const [
    branchVersion,
    manifests,
    buildTargets,
    fragmentFiles,
  ] = await Promise.all([
    parseBranchVersion(options.reference),
    readManifests(directory),
    readBuildTargets(directory, splitWords(options['deploy-targets'])),
    readFragmentFiles(directory),
  ]);

  const manifestIssues = findManifestIssues(manifests);

  if (manifestIssues.length > 0) {
    process.stderr.write(`${manifestIssues.join('\n')}\n`);

    return 1;
  }

  const packageTargets = readPackageTargets(manifests);

  const versionOutputs = createVersionOutputs(
    branchVersion?.kind === 'release' ? branchVersion : undefined,
    options,
    packageTargets.packagist !== '',
  );

  const imageOutputs = createImageOutputs(buildTargets.imageTargets, versionOutputs, isGroupingImageBuilds);

  const releaseOutput = {
    fragments: fragmentFiles.join(' '),
    ...versionOutputs.release,
    ...packageTargets,
  };

  process.stdout.write([
    `deploy=${JSON.stringify(buildTargets.deployTargets)}`,
    `first-wave-images=${JSON.stringify(imageOutputs.firstWave)}`,
    `images=${JSON.stringify(imageOutputs.all)}`,
    `release=${JSON.stringify(releaseOutput)}`,
    `second-wave-images=${JSON.stringify(imageOutputs.secondWave)}`,
    `staging=${JSON.stringify(createStagingOutputs(buildTargets.deployTargets))}`,
    '',
  ].join('\n'));

  return 0;
};
