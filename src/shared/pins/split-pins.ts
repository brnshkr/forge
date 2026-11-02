import path from 'node:path';

import { DIGEST_SOURCE } from '#src/shared/pins/digests';
import { formatVersionComment, VERSION_COMMENT_SOURCE } from '#src/shared/pins/references';
import { readEnvironmentValue } from '#src/shared/utils/environment';
import { objectFromEntries, readOwnValue } from '#src/shared/utils/object';
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
  readonly forgeRepository: string;
  readonly forgeRepositoryOwner: string;
  readonly repositories: Readonly<Record<string, string>>;
}

export interface ForgeImageRole {
  readonly defaultName: string;
  readonly nameKey: string;
  readonly suffix: string;
  readonly suffixKey?: string;
}

const FORGE_APP_ROLE = <const>{
  defaultName: 'forge-app',
  nameKey: 'FORGE_APP_IMAGE_NAME',
  suffix: '',
} satisfies ForgeImageRole;

export const FORGE_IMAGE_ROLES: ReadonlyMap<string, ForgeImageRole> = new Map([
  ['FORGE_APP', {
    ...FORGE_APP_ROLE,
    suffixKey: 'FORGE_APP_IMAGE_SUFFIX',
  }],
  ['FORGE_BUILD', {
    ...FORGE_APP_ROLE,
    suffix: '-dev',
  }],
  ['FORGE_CLI', {
    defaultName: 'forge',
    nameKey: 'FORGE_CLI_IMAGE_NAME',
    suffix: '',
    suffixKey: 'FORGE_CLI_IMAGE_SUFFIX',
  }],
  ['FORGE_RUNTIME', FORGE_APP_ROLE],
]);

const SPLIT_PIN_SOURCE = String.raw`^(?<digestKey>(?<prefix>[A-Z][\dA-Z_]*?)_(?<kind>IMAGE|FRAGMENT)_DIGEST)=["']?`;

/**
 * @throws {Error}
 */
const createRepositoryDefaultPattern = (): RegExp => compileLinearPattern(
  [
    String.raw`\$\{(?<prefix>[A-Z][\dA-Z_]*)_REPOSITORY:-`,
    String.raw`(?<owner>\$\{FORGE_REPOSITORY_OWNER:\?[^\}]*\})?(?<repository>[^\}]+)\}`,
  ].join(''),
  'gv',
);

/**
 * @throws {Error}
 */
const createAssignmentPattern = (key: string): RegExp => compileLinearPattern(
  String.raw`^(?<head>${key}=)(?<quote>["']?)[^\s"'#]*\k<quote>${VERSION_COMMENT_SOURCE}`,
  'gmv',
);

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
  forgeRepositoryOwner: string,
): Record<string, string> => objectFromEntries(
  fragmentTexts.flatMap((text) => Array.from(text.matchAll(createRepositoryDefaultPattern()), (match) => <const>[
    readGroup(match.groups, 'prefix'),
    `${match.groups?.['owner'] === undefined ? '' : forgeRepositoryOwner}${readGroup(match.groups, 'repository')}`,
  ])),
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
  const fragmentTagKey = `${pin.prefix}_FRAGMENT_TAG`;
  const tagKey = readEnvironmentValue(values, fragmentTagKey) === undefined ? 'FORGE_TAG' : fragmentTagKey;
  const fragmentName = pin.prefix.toLowerCase().replaceAll('_', '-');
  const tag = requireSplitValue(values, tagKey, pin);

  return {
    reference: `${splitDefaults.forgeRepository}/compose/${fragmentName}:${tag}@${pin.digest}`,
    suffix: '',
    tagKey,
  };
};

export const getForgeRepositoryOwner = (forgeRepository: string): string => path.posix.dirname(forgeRepository);

export const formatForgeImage = (
  role: ForgeImageRole,
  values: StringRecord,
  forgeRepositoryOwner: string,
): string => {
  const name = readEnvironmentValue(values, role.nameKey) ?? role.defaultName;

  return `${forgeRepositoryOwner}/${name}`;
};

export const readForgeImageSuffix = (
  role: ForgeImageRole,
  values: StringRecord,
): string => (role.suffixKey === undefined
  ? role.suffix
  : (readEnvironmentValue(values, role.suffixKey) ?? role.suffix));

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
  const suffix = readForgeImageSuffix(role, values);
  const repository = formatForgeImage(role, values, splitDefaults.forgeRepositoryOwner);

  return {
    reference: `${repository}:${tag}${suffix}@${pin.digest}`,
    suffix,
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

  const imageSuffix = readEnvironmentValue(values, `${pin.prefix}_IMAGE_SUFFIX`) ?? '';
  const tag = requireSplitValue(values, `${pin.prefix}_TAG`, pin);

  return {
    reference: `${repository}:${tag}${imageSuffix}@${pin.digest}`,
    suffix: imageSuffix,
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
