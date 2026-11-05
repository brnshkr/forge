import { file, write } from 'bun';

import { readDigest } from '#src/shared/pins/digests';
import { readPlainAssignments } from '#src/shared/pins/dotenv';
import { parseImageReference } from '#src/shared/pins/references';
import { getLatestTag, getVersionFromTag, listVersionCandidates } from '#src/shared/pins/version-tags';

import {
  DOCKER_HUB,
  fetchDigest,
  fetchTags,
  GHCR,
} from '#src/shared/registry';

import { readEnvironmentValue } from '#src/shared/utils/environment';

import {
  isPlainObject,
  objectEntries,
  objectFromEntries,
  readOwnValue,
} from '#src/shared/utils/object';

import { packageOrganization } from '#src/shared/utils/package-json';
import { before, parseSeconds } from '#src/shared/utils/string';

import type { PinnedImage } from '#src/shared/pins/references';
import type { Registries, RegistryRepository } from '#src/shared/registry';
import type { Maybe } from '#src/shared/types/core';
import type { Environment } from '#src/shared/utils/environment';

export type Sightings = Readonly<Record<string, string>>;

export interface CandidateSearch {
  readonly candidateReference: string;
  readonly pinnedReference: string;
}

export interface CandidateSelection {
  readonly reference?: string;
  readonly sightings: Sightings;
}

export interface ReleaseAge {
  readonly minimumAgeSeconds: number;
  readonly now: number;
  readonly scope: string;
  readonly seenCandidates: Sightings;
  readonly seenFile: string;
}

export interface ImageSelection {
  readonly pinnedImage?: PinnedImage;
  readonly sightings: Sightings;
}

interface NewestReference {
  readonly availableTags: readonly string[];
  readonly reference: string;
}

type Sighting = readonly [string, string];

const DEFAULT_MINIMUM_RELEASE_AGE = '604800';
const DISABLED_MINIMUM_RELEASE_AGE = '0';
const MILLISECONDS_PER_SECOND = 1_000;

const EXEMPT_REFERENCE_PREFIXES = [
  DOCKER_HUB,
  GHCR,
].map((registry) => `${registry}/${packageOrganization}/`);

/**
 * @throws {Error}
 */
export const readMinimumReleaseAge = (dotenvText: string, environment: Environment): number => {
  const dotenvValue = readOwnValue(readPlainAssignments(dotenvText), 'MINIMUM_RELEASE_AGE');
  const configuredValue = dotenvValue === '' ? DISABLED_MINIMUM_RELEASE_AGE : dotenvValue;

  const value = configuredValue
    ?? readEnvironmentValue(environment, 'MINIMUM_RELEASE_AGE')
    ?? DEFAULT_MINIMUM_RELEASE_AGE;

  const seconds = parseSeconds(value);

  if (seconds === undefined) {
    throw new Error(`Variable "MINIMUM_RELEASE_AGE" must be a number of seconds, "${value}" given.`);
  }

  return seconds;
};

const readJsonOrUndefined = async (filePath: string): Promise<unknown> => {
  try {
    return await file(filePath).json();
  } catch {
    return undefined;
  }
};

const isSeenTime = (entry: [string, unknown]): entry is [string, string] => typeof entry[1] === 'string'
  && !Number.isNaN(Date.parse(entry[1]));

const readSeenCandidates = (seenState: unknown, scope: string): Record<string, string> => {
  const scopeState = isPlainObject(seenState) ? readOwnValue(seenState, scope) : undefined;

  if (!isPlainObject(scopeState)) {
    return {};
  }

  return objectFromEntries(objectEntries(scopeState).filter(isSeenTime));
};

export const readReleaseAge = async (
  seenFile: string,
  scope: string,
  minimumAgeSeconds: number,
): Promise<ReleaseAge> => ({
  minimumAgeSeconds,
  now: Date.now(),
  scope,
  seenCandidates: readSeenCandidates(seenFile === '' ? undefined : await readJsonOrUndefined(seenFile), scope),
  seenFile,
});

const compareSightings = (left: Sighting, right: Sighting): number => Date.parse(left[1]) - Date.parse(right[1]);

export const getCandidateSelection = (
  search: CandidateSearch,
  releaseAge: ReleaseAge,
  isRelevant: (seenReference: string) => boolean,
): CandidateSelection => {
  if (search.candidateReference === search.pinnedReference
    || EXEMPT_REFERENCE_PREFIXES.some((prefix) => search.candidateReference.startsWith(prefix))) {
    return {
      reference: search.candidateReference,
      sightings: {},
    };
  }

  const candidateFirstSeen = readOwnValue(releaseAge.seenCandidates, search.candidateReference)
    ?? new Date(releaseAge.now).toISOString();

  const sightings = Object
    .entries({
      ...releaseAge.seenCandidates,
      [search.candidateReference]: candidateFirstSeen,
    })
    .filter(([seenReference]) => isRelevant(seenReference))
    .toSorted(compareSightings);

  const latestAgedTime = releaseAge.now - (releaseAge.minimumAgeSeconds * MILLISECONDS_PER_SECOND);
  const agedSighting = sightings.findLast(([, firstSeen]) => Date.parse(firstSeen) <= latestAgedTime);

  if (agedSighting === undefined) {
    return {
      sightings: objectFromEntries(sightings),
    };
  }

  return {
    reference: agedSighting[0],
    sightings: objectFromEntries(sightings.filter((sighting) => compareSightings(sighting, agedSighting) > 0)),
  };
};

/**
 * @rejects {Error}
 */
export const writeSightings = async (sightingRecords: readonly Sightings[], releaseAge: ReleaseAge): Promise<void> => {
  if (releaseAge.seenFile === '') {
    return;
  }

  const seenState = await readJsonOrUndefined(releaseAge.seenFile);
  const scopeSightings = objectFromEntries(sightingRecords.flatMap((sightings) => objectEntries(sightings)));

  await write(releaseAge.seenFile, JSON.stringify({
    ...isPlainObject(seenState) ? seenState : {},
    [releaseAge.scope]: scopeSightings,
  }));
};

/**
 * @rejects {Error}
 */
const findVersionOfDigest = async (
  image: RegistryRepository,
  digest: string,
  candidateTags: readonly string[],
  registries: Registries,
): Promise<Maybe<string>> => {
  const [candidateTag, ...otherTags] = candidateTags;

  if (candidateTag === undefined) {
    return undefined;
  }

  return await fetchDigest(image, candidateTag, registries) === digest
    ? getVersionFromTag(candidateTag)
    : findVersionOfDigest(
      image,
      digest,
      otherTags,
      registries,
    );
};

/**
 * @rejects {Error}
 */
const fetchNewestReference = async (reference: string, registries: Registries): Promise<NewestReference> => {
  const parsedReference = parseImageReference(reference);
  const availableTags = await fetchTags(parsedReference.image, registries);
  const newestTag = getLatestTag(parsedReference.tag, availableTags);
  const digest = await fetchDigest(parsedReference.image, newestTag, registries);

  return {
    availableTags,
    reference: `${parsedReference.name}:${newestTag}@${digest}`,
  };
};

/**
 * @rejects {Error}
 */
const getPinnedImage = async (
  reference: string,
  availableTags: readonly string[],
  registries: Registries,
): Promise<PinnedImage> => {
  const parsedReference = parseImageReference(reference);

  const version = await findVersionOfDigest(
    parsedReference.image,
    readDigest(reference),
    listVersionCandidates(parsedReference.tag, availableTags),
    registries,
  );

  return {
    reference,
    version: version ?? getVersionFromTag(parsedReference.tag),
  };
};

/**
 * @throws {Error}
 */
const isMoveTarget = (pinnedReference: string, seenReference: string): boolean => {
  const parsedReference = parseImageReference(pinnedReference);
  const namePrefix = `${parsedReference.name}:`;

  if (seenReference === pinnedReference || !seenReference.startsWith(namePrefix)) {
    return false;
  }

  const seenTag = before(seenReference.slice(namePrefix.length), '@');

  return getLatestTag(parsedReference.tag, [seenTag]) === seenTag;
};

/**
 * @rejects {Error}
 */
export const getImageSelection = async (
  reference: string,
  registries: Registries,
  releaseAge: ReleaseAge,
): Promise<ImageSelection> => {
  const newestReference = await fetchNewestReference(reference, registries);

  const search = <const>{
    candidateReference: newestReference.reference,
    pinnedReference: reference,
  } satisfies CandidateSearch;

  const selection = getCandidateSelection(
    search,
    releaseAge,
    (seenReference) => isMoveTarget(reference, seenReference),
  );

  if (selection.reference === undefined) {
    return {
      sightings: selection.sightings,
    };
  }

  return {
    pinnedImage: await getPinnedImage(selection.reference, newestReference.availableTags, registries),
    sightings: selection.sightings,
  };
};
