import { DIGEST_SOURCE } from '#src/shared/pins/digests';
import { formatVersionComment, VERSION_COMMENT_SOURCE } from '#src/shared/pins/references';
import { DOCKER_HUB } from '#src/shared/registry';
import { readEnvironmentValue } from '#src/shared/utils/environment';
import { objectFromEntries, readOwnValue } from '#src/shared/utils/object';
import { packageName, packageOrganization } from '#src/shared/utils/package-json';
import { compileLinearPattern, readGroup } from '#src/shared/utils/pattern';

import type { StringRecord } from '#src/shared/types/core';

export interface SplitPin {
  readonly digest: string;
  readonly digestKey: string;
  readonly kind: 'fragment' | 'image';
  readonly prefix: string;
}

export interface SplitReference {
  readonly reference: string;
  readonly suffix: string;
  readonly tagKey: string;
}

export interface SplitDefaults {
  readonly forgeFragmentNamespace: string;
  readonly forgeImageNamespace: string;
  readonly repositories: Readonly<Record<string, string>>;
  readonly tagSuffixes: Readonly<Record<string, string>>;
}

export interface ForgeImageRole {
  readonly nameKey: string;
  readonly suffix: string;
}

export const FORGE_IMAGE_NAME_KEY = 'FORGE_IMAGE_NAME';

const FORGE_PREFIX = 'FORGE_';
const DEFAULT_FORGE_IMAGE_NAME = packageName;
const DEFAULT_FORGE_NAMESPACE = `${DOCKER_HUB}/${packageOrganization}`;

export const FORGE_IMAGE_ROLES: ReadonlyMap<string, ForgeImageRole> = new Map([
  ['FORGE_APP_DEV', {
    nameKey: 'FORGE_APP_DEV_IMAGE_NAME',
    suffix: '-app-dev',
  }],
  ['FORGE_APP', {
    nameKey: 'FORGE_APP_IMAGE_NAME',
    suffix: '-app',
  }],
  ['FORGE_CLI_CHROMIUM', {
    nameKey: 'FORGE_CLI_CHROMIUM_IMAGE_NAME',
    suffix: '-cli-chromium',
  }],
  ['FORGE_CLI', {
    nameKey: 'FORGE_CLI_IMAGE_NAME',
    suffix: '-cli',
  }],
]);

const SPLIT_PIN_SOURCE = String.raw`^(?<digestKey>(?<prefix>[A-Z][\dA-Z_]*?)_(?<kind>IMAGE|FRAGMENT)_DIGEST)=["']?`;

/**
 * @throws {Error}
 */
const createRepositoryDefaultPattern = (): RegExp => compileLinearPattern(
  [
    String.raw`\$\{(?<prefix>[A-Z][\dA-Z_]*)_REPOSITORY:-`,
    String.raw`(?<owner>\$\{FORGE_IMAGE_NAMESPACE:-\$\{FORGE_NAMESPACE:\?[^\}]*\}\})?(?<repository>[^\}]+)\}`,
  ].join(''),
  'gv',
);

/**
 * @throws {Error}
 */
const createTagSuffixPattern = (): RegExp => compileLinearPattern(
  String.raw`\$\{[A-Z][\dA-Z_]*_TAG:\?[^\}]*\}(?<suffix>[^\s@\}]*)@\$\{(?<prefix>[A-Z][\dA-Z_]*)_IMAGE_DIGEST:`,
  'gv',
);

/**
 * @throws {Error}
 */
const createAssignmentPattern = (key: string): RegExp => compileLinearPattern(
  String.raw`^(?<head>${key}=)(?<quote>["']?)[^\s"'#]*\k<quote>${VERSION_COMMENT_SOURCE}`,
  'gmv',
);

export const joinContinuedLines = (text: string): string => text.replaceAll(/\\\n[\t ]*/gv, '');

/**
 * @throws {Error}
 */
export const findSplitPins = (text: string): SplitPin[] => Array.from(
  text.matchAll(compileLinearPattern(`${SPLIT_PIN_SOURCE}(?<digest>${DIGEST_SOURCE})`, 'gmv')),
  (match) => ({
    digest: readGroup(match.groups, 'digest'),
    digestKey: readGroup(match.groups, 'digestKey'),
    kind: readGroup(match.groups, 'kind') === 'IMAGE' ? 'image' : 'fragment',
    prefix: readGroup(match.groups, 'prefix'),
  }),
);

/**
 * @throws {Error}
 */
export const readRepositoryDefaults = (
  fragmentTexts: readonly string[],
  forgeImageNamespace: string,
): Record<string, string> => objectFromEntries(fragmentTexts.flatMap((text) => Array.from(
  joinContinuedLines(text).matchAll(createRepositoryDefaultPattern()),
  (match) => <const>[
    readGroup(match.groups, 'prefix'),
    `${match.groups?.['owner'] === undefined ? '' : forgeImageNamespace}${readGroup(match.groups, 'repository')}`,
  ],
)));

/**
 * @throws {Error}
 */
export const readTagSuffixes = (fragmentTexts: readonly string[]): Record<string, string> => objectFromEntries(
  fragmentTexts.flatMap((text) => Array.from(
    joinContinuedLines(text).matchAll(createTagSuffixPattern()),
    (match) => <const>[
      readGroup(match.groups, 'prefix'),
      readGroup(match.groups, 'suffix'),
    ],
  )),
);

/**
 * @throws {Error}
 */
const requireSplitValue = (values: StringRecord, key: string, pin: SplitPin): string => {
  const value = readEnvironmentValue(values, key);

  if (value === undefined) {
    throw new Error(`Variable "${key}" not found, but "${pin.digestKey}" requires it.`);
  }

  return value;
};

/**
 * @throws {Error}
 */
const createFragmentReference = (pin: SplitPin, values: StringRecord, splitDefaults: SplitDefaults): SplitReference => {
  if (!pin.prefix.startsWith(FORGE_PREFIX)) {
    throw new Error(`Fragment pin "${pin.digestKey}" must start with "${FORGE_PREFIX}".`);
  }

  const tag = requireSplitValue(values, 'FORGE_TAG', pin);

  const fragmentName = pin.prefix
    .slice(FORGE_PREFIX.length)
    .toLowerCase()
    .replaceAll('_', '-');

  return {
    reference: `${splitDefaults.forgeFragmentNamespace}/${packageName}-compose-${fragmentName}:${tag}@${pin.digest}`,
    suffix: '',
    tagKey: 'FORGE_TAG',
  };
};

const readForgeNamespace = (values: StringRecord, key: string): string => readEnvironmentValue(values, key)
  ?? readEnvironmentValue(values, 'FORGE_NAMESPACE')
  ?? DEFAULT_FORGE_NAMESPACE;

export const readForgeImageNamespace = (values: StringRecord): string => readForgeNamespace(
  values,
  'FORGE_IMAGE_NAMESPACE',
);

export const readForgeFragmentNamespace = (values: StringRecord): string => readForgeNamespace(
  values,
  'FORGE_FRAGMENT_NAMESPACE',
);

export const formatForgeImage = (
  role: ForgeImageRole,
  values: StringRecord,
  forgeImageNamespace: string,
): string => {
  const name = readEnvironmentValue(values, role.nameKey)
    ?? readEnvironmentValue(values, FORGE_IMAGE_NAME_KEY)
    ?? DEFAULT_FORGE_IMAGE_NAME;

  return `${forgeImageNamespace}/${name}`;
};

/**
 * @throws {Error}
 */
const createForgeImageReference = (
  pin: SplitPin,
  values: StringRecord,
  splitDefaults: SplitDefaults,
  role: ForgeImageRole,
): SplitReference => {
  const tag = requireSplitValue(values, 'FORGE_TAG', pin);
  const repository = formatForgeImage(role, values, splitDefaults.forgeImageNamespace);

  return {
    reference: `${repository}:${tag}${role.suffix}@${pin.digest}`,
    suffix: role.suffix,
    tagKey: 'FORGE_TAG',
  };
};

/**
 * @throws {Error}
 */
const createImageReference = (pin: SplitPin, values: StringRecord, splitDefaults: SplitDefaults): SplitReference => {
  const repositoryKey = `${pin.prefix}_REPOSITORY`;

  const repository = readEnvironmentValue(values, repositoryKey)
    ?? readOwnValue(splitDefaults.repositories, pin.prefix);

  if (repository === undefined) {
    throw new Error(
      `Repository of "${pin.digestKey}" not found. Set "${repositoryKey}" or include a fragment that defines it.`,
    );
  }

  const tagSuffix = readOwnValue(splitDefaults.tagSuffixes, pin.prefix) ?? '';
  const tag = requireSplitValue(values, `${pin.prefix}_TAG`, pin);

  return {
    reference: `${repository}:${tag}${tagSuffix}@${pin.digest}`,
    suffix: tagSuffix,
    tagKey: `${pin.prefix}_TAG`,
  };
};

/**
 * @throws {Error}
 */
export const createSplitReference = (
  pin: SplitPin,
  values: StringRecord,
  splitDefaults: SplitDefaults,
): SplitReference => {
  if (pin.kind === 'fragment') {
    return createFragmentReference(pin, values, splitDefaults);
  }

  const role = readOwnValue(FORGE_IMAGE_ROLES, pin.prefix);

  return role === undefined
    ? createImageReference(pin, values, splitDefaults)
    : createForgeImageReference(
      pin,
      values,
      splitDefaults,
      role,
    );
};

/**
 * @throws {Error}
 */
export const replaceAssignment = (text: string, key: string, value: string, version = ''): string => text.replaceAll(
  createAssignmentPattern(key),
  (_match: string, ...captures: unknown[]) => {
    const groups = <StringRecord>captures.at(-1);
    const quote = readGroup(groups, 'quote');

    return `${readGroup(groups, 'head')}${quote}${value}${quote}${formatVersionComment(version)}`;
  },
);
