import { getErrorMessage } from '#src/shared/utils/error';
import { objectEntries } from '#src/shared/utils/object';

const SKIP_GROUPS = <const>{
  bump: [
    'bump',
  ],
  check: [
    'hygiene',
    'matrix',
  ],
  deploy: [
    'testing',
    'staging',
    'production',
  ],
  publish: [
    'images',
    'npm',
    'packagist',
    'fragments',
    'release',
    'changelog',
    'merge',
    'dispatch',
    'pages',
  ],
  review: [
    'reword',
  ],
  security: [
    'semgrep',
    'gitleaks',
    'osv-scanner',
    'trivy',
  ],
};

const SKIP_NAMES = new Set(objectEntries(SKIP_GROUPS).flatMap(([group, jobs]) => [group, ...jobs]));

const isStringArray = (value: unknown): value is string[] => Array.isArray(value)
  && value.every((item) => typeof item === 'string');

/**
 * @throws {Error}
 */
const parseSkipList = (text: string): unknown => {
  if (text === '') {
    return [];
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Skip list must be a JSON array of names, "${text}" given: ${getErrorMessage(error)}.`, {
      cause: error,
    });
  }
};

/**
 * @throws {Error}
 */
export const readSkippedNames = (text: string): string[] => {
  const skippedNames = parseSkipList(text);

  if (!isStringArray(skippedNames)) {
    throw new Error(`Skip list must be a JSON array of names, "${text}" given.`);
  }

  const unknownNames = skippedNames.filter((name) => !SKIP_NAMES.has(name));

  if (unknownNames.length > 0) {
    throw new Error(unknownNames
      .map((name) => `Unknown skip name "${name}".`)
      .join('\n'));
  }

  return skippedNames;
};

const isInGroup = (
  group: string,
  job: string,
): boolean => objectEntries(SKIP_GROUPS).some(
  ([groupName, jobs]) => groupName === group && jobs.includes(job),
);

export const isSkipped = (
  skippedNames: readonly string[],
  job: string,
): boolean => skippedNames.some(
  (skippedName) => skippedName === job || isInGroup(skippedName, job),
);
