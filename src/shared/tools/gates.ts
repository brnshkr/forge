import { getCandidateSelection } from '#src/shared/bump/release-age';
import { readDigest } from '#src/shared/pins/digests';
import { getVersionFromTag } from '#src/shared/pins/version-tags';
import { fetchDigest } from '#src/shared/registry';
import { fetchChecksum, GITHUB_REPOSITORIES } from '#src/shared/tools/sources';

import {
  createUpstreamReferences,
  formatUpstreamReference,
  getBumpLevel,
  getLatestVersion,
  getVersionName,
  getVersionsWithMinors,
  readPinValue,
  readUpstreamReference,
} from '#src/shared/tools/versions';

import { objectEntries, objectKeys } from '#src/shared/utils/object';
import { filterPassing } from '#src/shared/utils/promise';
import { before } from '#src/shared/utils/string';

import type { CandidateSearch, ReleaseAge, Sightings } from '#src/shared/bump/release-age';
import type { SourceContext } from '#src/shared/tools/sources';
import type { DigestName, PinName, Versions } from '#src/shared/tools/versions';

export interface GatedPin {
  readonly candidateReference: string;
  readonly createReference: (versions: Versions, hash: string) => string;
  readonly hashName?: PinName;
  readonly pinnedReference: string;
  readonly readVersion: (reference: string) => string;
  readonly versionName: PinName;
}

export interface GatedSelection {
  readonly sightings: Sightings;
  readonly versions: Readonly<Record<string, string>>;
}

export interface GateContext extends SourceContext {
  readonly candidateVersions: Versions;
  readonly pinnedVersions: Versions;
}

const DOWNLOAD_SEGMENT = '/releases/download/';

const RELEASE_ASSETS = <const>{
  ACTIONLINT_CHECKSUM: (pinnedVersions: Versions) => {
    const version = pinnedVersions.ACTIONLINT_VERSION;

    return `rhysd/actionlint/releases/download/v${version}/actionlint_${version}_linux_amd64.tar.gz`;
  },
  HADOLINT_CHECKSUM: (pinnedVersions: Versions) => {
    const version = pinnedVersions.HADOLINT_VERSION;

    return `hadolint/hadolint/releases/download/v${version}/hadolint-Linux-x86_64`;
  },
  SHELLCHECK_CHECKSUM: (pinnedVersions: Versions) => {
    const version = pinnedVersions.SHELLCHECK_VERSION;

    return `koalaman/shellcheck/releases/download/v${version}/shellcheck-v${version}.linux.x86_64.tar.xz`;
  },
} satisfies Partial<Record<PinName, (pinnedVersions: Versions) => string>>;

type ChecksumName = keyof typeof RELEASE_ASSETS;

/**
 * @throws {Error}
 */
const readTagVersion = (reference: string): string => {
  const taggedName = before(reference, '@');

  return getVersionFromTag(taggedName.slice(taggedName.lastIndexOf(':') + 1));
};

/**
 * @throws {Error}
 */
const readAssetVersion = (reference: string): string => {
  const releasePath = reference.slice(reference.indexOf(DOWNLOAD_SEGMENT) + DOWNLOAD_SEGMENT.length);

  return getVersionFromTag(before(releasePath, '/'));
};

const readComposerVersion = (reference: string): string => reference.slice(reference.lastIndexOf(':') + 1);

/**
 * @rejects {Error}
 */
const createImageGate = async (name: DigestName, context: GateContext): Promise<GatedPin> => {
  const createReference = (versions: Versions, hash: string): string => formatUpstreamReference(
    readUpstreamReference(versions, name),
    hash,
  );

  const upstreamReference = readUpstreamReference(context.candidateVersions, name);
  const digest = await fetchDigest(upstreamReference, upstreamReference.tag, context.sources.registries);

  return {
    candidateReference: createReference(context.candidateVersions, digest),
    createReference,
    hashName: name,
    pinnedReference: createReference(context.pinnedVersions, readPinValue(context.pinnedVersions, name)),
    readVersion: readTagVersion,
    versionName: getVersionName(name),
  };
};

/**
 * @rejects {Error}
 */
const createChecksumGate = async (
  name: ChecksumName,
  getAssetPath: (versions: Versions) => string,
  context: GateContext,
): Promise<GatedPin> => {
  const createReference = (versions: Versions, hash: string): string => `${getAssetPath(versions)}@${hash}`;
  const candidateChecksum = await fetchChecksum(getAssetPath(context.candidateVersions), context);

  return {
    candidateReference: createReference(context.candidateVersions, candidateChecksum),
    createReference,
    hashName: name,
    pinnedReference: createReference(context.pinnedVersions, readPinValue(context.pinnedVersions, name)),
    readVersion: readAssetVersion,
    versionName: getVersionName(name),
  };
};

const createComposerGate = (context: GateContext): GatedPin => {
  const repository = GITHUB_REPOSITORIES.COMPOSER_VERSION;
  const createReference = (versions: Versions): string => `${repository}:${versions.COMPOSER_VERSION}`;

  return {
    candidateReference: createReference(context.candidateVersions),
    createReference,
    pinnedReference: createReference(context.pinnedVersions),
    readVersion: readComposerVersion,
    versionName: 'COMPOSER_VERSION',
  };
};

/**
 * @rejects {Error}
 */
export const createGatedPins = async (context: GateContext): Promise<GatedPin[]> => {
  const fetchedGatedPins = await Promise.all([
    ...objectKeys(createUpstreamReferences(context.candidateVersions))
      .map(async (name) => createImageGate(name, context)),
    ...objectEntries(RELEASE_ASSETS)
      .map(async ([name, getAssetPath]) => createChecksumGate(name, getAssetPath, context)),
  ]);

  return [
    ...fetchedGatedPins,
    createComposerGate(context),
  ];
};

/**
 * @rejects {Error}
 */
const isRelevantSighting = async (
  gatedPin: GatedPin,
  pinnedVersions: Versions,
  seenReference: string,
): Promise<boolean> => {
  const seenVersion = gatedPin.readVersion(seenReference);

  const seenVersions = getVersionsWithMinors({
    ...pinnedVersions,
    [gatedPin.versionName]: seenVersion,
  });

  if (seenReference === gatedPin.pinnedReference
    || gatedPin.createReference(seenVersions, readDigest(seenReference)) !== seenReference) {
    return false;
  }

  const pinnedVersion = readPinValue(pinnedVersions, gatedPin.versionName);
  const latestVersion = await getLatestVersion(pinnedVersion, [seenVersion], getBumpLevel(gatedPin.versionName));

  return latestVersion === seenVersion;
};

/**
 * @rejects {Error}
 */
export const getGatedSelection = async (
  gatedPin: GatedPin,
  pinnedVersions: Versions,
  releaseAge: ReleaseAge,
): Promise<GatedSelection> => {
  const search = <const>{
    candidateReference: gatedPin.candidateReference,
    pinnedReference: gatedPin.pinnedReference,
  } satisfies CandidateSearch;

  const relevantReferences = new Set(await filterPassing(
    [
      ...objectKeys(releaseAge.seenCandidates),
      gatedPin.candidateReference,
    ],
    async (seenReference) => isRelevantSighting(gatedPin, pinnedVersions, seenReference),
  ));

  const selection = getCandidateSelection(search, releaseAge, (seenReference) => relevantReferences.has(seenReference));

  if (selection.reference === undefined) {
    return {
      sightings: selection.sightings,
      versions: {},
    };
  }

  return {
    sightings: selection.sightings,
    versions: {
      [gatedPin.versionName]: gatedPin.readVersion(selection.reference),
      ...gatedPin.hashName === undefined
        ? {}
        : {
          [gatedPin.hashName]: readDigest(selection.reference),
        },
    },
  };
};
