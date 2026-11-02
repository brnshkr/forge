import { compileLinearPattern, readGroup } from '#src/shared/utils/pattern';
import { before } from '#src/shared/utils/string';

import type { Maybe } from '#src/shared/types/core';

interface VersionTag {
  readonly numbers: readonly number[];
  readonly prefix: string;
  readonly prerelease?: string;
  readonly suffix: string;
}

interface CandidateTag extends VersionTag {
  readonly tag: string;
}

const MOVABLE_NUMBER_COUNT = 2;
const ZERO_MAJOR_MOVABLE_NUMBER_COUNT = 3;

const PRERELEASE_KINDS = <const>[
  'alpha',
  'beta',
  'rc',
];

const PRERELEASE_SOURCE = String.raw`(?:${PRERELEASE_KINDS.join('|')})\.\d+`;

export const VERSION_SOURCE = String.raw`v?\d+(?:\.\d+)*(?:-${PRERELEASE_SOURCE})?`;

/**
 * @throws {Error}
 */
const createVersionTagPattern = (): RegExp => compileLinearPattern(
  String.raw`^(?<prefix>v?)(?<numbers>\d+(?:\.\d+)*)(?:-(?<prerelease>${PRERELEASE_SOURCE}))?(?<suffix>(?:\D.*)?)$`,
  'v',
);

export const readVersionNumbers = (version: string): number[] => version
  .split('.')
  .map(Number);

export const formatPrereleaseSuffix = (prerelease?: string): string => (
  prerelease === undefined ? '' : `-${prerelease}`
);

/**
 * @throws {Error}
 */
const parseVersionTag = (tag: string): Maybe<VersionTag> => {
  const groups = createVersionTagPattern().exec(tag)?.groups;

  if (groups === undefined) {
    return undefined;
  }

  const { prerelease } = groups;

  return {
    numbers: readVersionNumbers(readGroup(groups, 'numbers')),
    prefix: readGroup(groups, 'prefix'),
    suffix: readGroup(groups, 'suffix'),
    ...prerelease === undefined
      ? {}
      : {
        prerelease,
      },
  };
};

export const compareNumbers = (left: readonly number[], right: readonly number[]): number => {
  for (const [position, leftNumber] of left.entries()) {
    const rightNumber = right.at(position);

    if (rightNumber !== undefined && rightNumber !== leftNumber) {
      return leftNumber - rightNumber;
    }
  }

  return left.length - right.length;
};

const readPrereleaseNumbers = (prerelease: string): number[] => {
  const kind = before(prerelease, '.');

  return [
    PRERELEASE_KINDS.indexOf(kind),
    Number(prerelease.slice(kind.length + 1)),
  ];
};

export const comparePrereleases = (left?: string, right?: string): number => {
  if (left === right) {
    return 0;
  }

  if (left === undefined || right === undefined) {
    return left === undefined ? 1 : -1;
  }

  return compareNumbers(readPrereleaseNumbers(left), readPrereleaseNumbers(right));
};

const compareVersionTags = (left: VersionTag, right: VersionTag): number => {
  const numberComparison = compareNumbers(left.numbers, right.numbers);

  return numberComparison === 0
    ? comparePrereleases(left.prerelease, right.prerelease)
    : numberComparison;
};

const isMovable = (versionTag: VersionTag): boolean => {
  const movableNumberCount = versionTag.numbers.at(0) === 0
    ? ZERO_MAJOR_MOVABLE_NUMBER_COUNT
    : MOVABLE_NUMBER_COUNT;

  return versionTag.prerelease !== undefined
    || versionTag.numbers.length >= movableNumberCount;
};

/**
 * @throws {Error}
 */
const listTagsOfFamily = (
  versionTag: VersionTag,
  leadingNumbers: readonly number[],
  availableTags: readonly string[],
): CandidateTag[] => availableTags.flatMap((tag) => {
  const candidateTag = parseVersionTag(tag);

  const isInFamily = candidateTag?.prefix === versionTag.prefix
    && candidateTag.suffix === versionTag.suffix
    && leadingNumbers.every((leadingNumber, index) => candidateTag.numbers.at(index) === leadingNumber);

  return isInFamily
    ? [{
      ...candidateTag,
      tag,
    }]
    : [];
});

/**
 * @throws {Error}
 */
export const getLatestTag = (currentTag: string, availableTags: readonly string[]): string => {
  const currentVersionTag = parseVersionTag(currentTag);

  if (currentVersionTag === undefined || !isMovable(currentVersionTag)) {
    return currentTag;
  }

  const isPrerelease = currentVersionTag.prerelease !== undefined;
  const leadingNumbers = isPrerelease ? currentVersionTag.numbers : currentVersionTag.numbers.slice(0, -1);

  return listTagsOfFamily(currentVersionTag, leadingNumbers, availableTags)
    .filter((candidateTag) => candidateTag.numbers.length === currentVersionTag.numbers.length
      && (isPrerelease || candidateTag.prerelease === undefined))
    .toSorted((left, right) => compareVersionTags(right, left))
    .find((candidateTag) => compareVersionTags(candidateTag, currentVersionTag) > 0)
    ?.tag ?? currentTag;
};

/**
 * @throws {Error}
 */
export const listVersionCandidates = (tag: string, availableTags: readonly string[]): string[] => {
  const versionTag = parseVersionTag(tag);

  if (versionTag === undefined) {
    return [];
  }

  return listTagsOfFamily(versionTag, versionTag.numbers, availableTags)
    .filter((candidateTag) => candidateTag.prerelease === versionTag.prerelease
      && candidateTag.numbers.length > versionTag.numbers.length)
    .toSorted((left, right) => (left.numbers.length === right.numbers.length
      ? compareNumbers(right.numbers, left.numbers)
      : right.numbers.length - left.numbers.length))
    .map((candidateTag) => candidateTag.tag);
};

/**
 * @throws {Error}
 */
export const getVersionFromTag = (tag: string): string => {
  const versionTag = parseVersionTag(tag);

  if (versionTag === undefined) {
    return '';
  }

  return `${versionTag.numbers.join('.')}${formatPrereleaseSuffix(versionTag.prerelease)}`;
};
