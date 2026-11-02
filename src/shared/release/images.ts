import { file } from 'bun';
import path from 'node:path';

import {
  FORGE_DIRECTORY,
  readMakeAssignments,
  readMakeList,
  readMakeVariables,
  requireMakeVariable,
  splitWords,
} from '#src/shared/make';

import {
  FORGE_IMAGE_ROLES,
  formatForgeImage,
  getForgeRepositoryOwner,
  readForgeImageSuffix,
} from '#src/shared/pins/split-pins';

import { objectFromEntries, readOwnValue } from '#src/shared/utils/object';
import { readGroup } from '#src/shared/utils/pattern';
import { findFirstPassing } from '#src/shared/utils/promise';

import type { MakeVariableNames } from '#src/shared/make';
import type { ForgeImageRole } from '#src/shared/pins/split-pins';
import type { Maybe } from '#src/shared/types/core';

const GENERIC_DOCKERFILE = path.join(FORGE_DIRECTORY, 'docker/app/Dockerfile');

export interface ImageLocation {
  readonly namespace: string;
  readonly registry: string;
}

export interface ImageTarget {
  readonly aliases: readonly string[];
  readonly arguments: readonly string[];
  readonly dockerfile: string;
  readonly name: string;
  readonly suffix: string;
  readonly target: string;
}

const STAGE_VARIABLE_NAMES = <const>{
  required: [
    'CONFIG_DIR',
  ],
  optional: [
    'IMAGE_ALIASES',
    'IMAGE_NAME',
    'IMAGE_SUFFIX',
    'IMAGE_TARGET',
  ],
} satisfies MakeVariableNames<string, string>;

const AUTOMATIC_ARGUMENTS = new Set([
  'BUILDARCH',
  'BUILDOS',
  'BUILDPLATFORM',
  'BUILDVARIANT',
  'TARGETARCH',
  'TARGETOS',
  'TARGETPLATFORM',
  'TARGETVARIANT',
]);

const FORGE_IMAGE_ARGUMENTS: ReadonlyMap<string, readonly string[]> = new Map([
  ['FORGE_BUILD_IMAGE', [
    'FORGE_BUILD',
    'FORGE_APP',
  ]],
  ['FORGE_RUNTIME_IMAGE', [
    'FORGE_RUNTIME',
  ]],
]);

const createArgumentPattern = (): RegExp => /^ARG[\t ]+(?<name>[A-Z_a-z]\w*)(?<assignment>=?)/gmv;

export const getImageName = (location: ImageLocation, imageTarget: ImageTarget): string => [
  location.registry,
  location.namespace,
  imageTarget.name,
].join('/');

/**
 * @throws {Error}
 */
export const readArgumentNames = (dockerfileText: string): string[] => [
  ...new Set(dockerfileText.matchAll(createArgumentPattern()).map((match) => readGroup(match.groups, 'name'))),
];

/**
 * @throws {Error}
 */
export const readBuildArguments = (
  dockerfileText: string,
  argumentValues: Readonly<Record<string, string>>,
): string[] => {
  const argumentNames = readArgumentNames(dockerfileText);

  const defaultedArgumentNames = new Set(
    dockerfileText
      .matchAll(createArgumentPattern())
      .filter((match) => readGroup(match.groups, 'assignment') === '=')
      .map((match) => readGroup(match.groups, 'name')),
  );

  const missingArgumentNames = argumentNames.filter((name) => readOwnValue(argumentValues, name) === undefined
    && !defaultedArgumentNames.has(name)
    && !AUTOMATIC_ARGUMENTS.has(name));

  if (missingArgumentNames.length > 0) {
    throw new Error(missingArgumentNames
      .map((name) => `Build argument "${name}" has no default and no value.`)
      .join('\n'));
  }

  return argumentNames.flatMap((name) => {
    const value = readOwnValue(argumentValues, name);

    return value === undefined ? [] : [`${name}=${value}`];
  });
};

/**
 * @throws {Error}
 */
const requireForgeImageRole = (prefix: string): ForgeImageRole => {
  const role = readOwnValue(FORGE_IMAGE_ROLES, prefix);

  if (role === undefined) {
    throw new Error(`Image role "${prefix}" not found.`);
  }

  return role;
};

/**
 * @throws {Error}
 */
const resolveForgeImage = (
  assignments: Readonly<Record<string, string>>,
  argumentName: string,
  prefixes: readonly string[],
): Maybe<string> => {
  const role = requireForgeImageRole(argumentName.replace(/_IMAGE$/v, ''));

  const pinPrefix = prefixes.find((prefix) => readOwnValue(assignments, `${prefix}_IMAGE_DIGEST`) !== undefined
    && readForgeImageSuffix(requireForgeImageRole(prefix), assignments) === role.suffix);

  if (pinPrefix === undefined || readOwnValue(assignments, argumentName) !== undefined) {
    return undefined;
  }

  const digestKey = `${pinPrefix}_IMAGE_DIGEST`;
  const tag = readOwnValue(assignments, 'FORGE_TAG');

  if (tag === undefined) {
    throw new Error(`Variable "FORGE_TAG" not found, but "${digestKey}" requires it.`);
  }

  const forgeRepositoryOwner = readOwnValue(assignments, 'FORGE_REPOSITORY_OWNER')
    ?? getForgeRepositoryOwner(requireMakeVariable(assignments, 'FORGE_REPOSITORY'));

  return `${formatForgeImage(role, assignments, forgeRepositoryOwner)}:${tag}${role.suffix}@${
    requireMakeVariable(assignments, digestKey)
  }`;
};

/**
 * @rejects {Error}
 */
const readArgumentValues = async (
  directory: string,
  argumentNames: readonly string[],
  stage: string,
): Promise<Record<string, string>> => {
  const forgeImages = [...FORGE_IMAGE_ARGUMENTS].filter(([name]) => argumentNames.includes(name));

  if (forgeImages.length === 0) {
    return readMakeAssignments(directory, argumentNames, stage);
  }

  const roles = [...FORGE_IMAGE_ROLES].filter(
    ([prefix]) => forgeImages.some(([, prefixes]) => prefixes.includes(prefix)),
  );

  const assignments = await readMakeAssignments(directory, [
    ...argumentNames,
    ...roles.flatMap(([prefix, role]) => [
      `${prefix}_IMAGE_DIGEST`,
      role.nameKey,
      ...role.suffixKey === undefined ? [] : [role.suffixKey],
    ]),
    'FORGE_REPOSITORY',
    'FORGE_REPOSITORY_OWNER',
    'FORGE_TAG',
  ], stage);

  const resolvedImages = forgeImages.flatMap(([name, prefixes]) => {
    const resolvedImage = resolveForgeImage(assignments, name, prefixes);

    return resolvedImage === undefined ? [] : [<const>[name, resolvedImage]];
  });

  return {
    ...assignments,
    ...objectFromEntries(resolvedImages),
  };
};

/**
 * @rejects {Error}
 */
const readStageImageTargets = async (directory: string, stage: string): Promise<ImageTarget[]> => {
  const stageVariables = await readMakeVariables(directory, STAGE_VARIABLE_NAMES, stage);
  const imageName = stageVariables.IMAGE_NAME;

  if (imageName === '') {
    return [];
  }

  const dockerfileCandidates = [
    path.join(stageVariables.CONFIG_DIR, 'docker', `${imageName}.Dockerfile`),
    path.join('docker', `${imageName}.Dockerfile`),
  ];

  const projectDockerfilePath = await findFirstPassing(
    dockerfileCandidates,
    async (candidate) => file(path.join(directory, candidate)).exists(),
  );

  const dockerfilePath = projectDockerfilePath ?? path.relative(directory, GENERIC_DOCKERFILE);
  const dockerfileText = await file(path.join(directory, dockerfilePath)).text();
  const argumentValues = await readArgumentValues(directory, readArgumentNames(dockerfileText), stage);

  return [
    {
      aliases: splitWords(stageVariables.IMAGE_ALIASES),
      arguments: readBuildArguments(dockerfileText, argumentValues),
      dockerfile: dockerfilePath,
      name: imageName,
      suffix: stageVariables.IMAGE_SUFFIX,
      target: stageVariables.IMAGE_TARGET,
    },
  ];
};

/**
 * @rejects {Error}
 */
export const readImageTargetsByStage = async (directory: string): Promise<Map<string, ImageTarget>> => {
  const stages = await readMakeList(directory, 'DOTENV_STAGES');

  const stageImageTargets = await Promise.all(stages.map(async (stage) => {
    const imageTargets = await readStageImageTargets(directory, stage);

    return imageTargets.map((imageTarget) => <const>[stage, imageTarget]);
  }));

  return new Map(stageImageTargets.flat());
};

/**
 * @rejects {Error}
 */
export const readImageTargets = async (directory: string): Promise<ImageTarget[]> => {
  const imageTargetsByStage = await readImageTargetsByStage(directory);

  return imageTargetsByStage.values().toArray();
};
