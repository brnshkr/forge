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
  FORGE_IMAGE_NAME_KEY,
  FORGE_IMAGE_ROLES,
  formatForgeImage,
  readForgeImageNamespace,
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
  readonly base: string;
  readonly dockerfile: string;
  readonly name: string;
  readonly suffix: string;
  readonly target: string;
}

interface ForgeImageArgument {
  readonly name: string;
  readonly prefix: string;
  readonly role: ForgeImageRole;
}

const STAGE_VARIABLE_NAMES = <const>{
  required: [
    'CONFIG_DIR',
  ],
  optional: [
    'IMAGE_ALIASES',
    'IMAGE_DOCKERFILE',
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

const createArgumentPattern = (): RegExp => /^ARG[\t ]+(?<name>[A-Z_a-z]\w*)(?<assignment>=?)/gmv;
const createStagePattern = (): RegExp => /^from[\t ]+(?:--\S+[\t ]+)*(?<reference>\S+)(?:[\t ]+as[\t ]+(?<name>\S+))?/gimv;

const foldLines = (value: string): string => value
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '')
  .join(' ');

const resolveStageBase = (reference: string, parentByStage: ReadonlyMap<string, string>): string => {
  const parent = parentByStage.get(reference);

  return parent === undefined ? reference : resolveStageBase(parent, parentByStage);
};

/**
 * @throws {Error}
 */
export const readTargetBase = (dockerfileText: string, target: string): string => {
  const stages = dockerfileText
    .matchAll(createStagePattern())
    .map((match) => ({
      name: match.groups?.['name'],
      reference: readGroup(match.groups, 'reference'),
    }))
    .toArray();

  const parentByStage = new Map(stages.flatMap((stage) => (stage.name === undefined
    ? []
    : [<const>[stage.name, stage.reference]])));

  const reference = parentByStage.get(target) ?? stages.at(-1)?.reference;

  if (reference === undefined) {
    throw new Error(`Dockerfile has no "FROM" instruction, so target "${target}" has no base.`);
  }

  return resolveStageBase(reference, parentByStage);
};

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

    return value === undefined ? [] : [`${name}=${foldLines(value)}`];
  });
};

const readForgeImageArgument = (name: string): Maybe<ForgeImageArgument> => {
  const prefix = name.replace(/_IMAGE$/v, '');
  const role = readOwnValue(FORGE_IMAGE_ROLES, prefix);

  if (prefix === name || role === undefined) {
    return undefined;
  }

  return {
    name,
    prefix,
    role,
  };
};

/**
 * @throws {Error}
 */
const resolveForgeImage = (
  assignments: Readonly<Record<string, string>>,
  forgeImageArgument: ForgeImageArgument,
): Maybe<string> => {
  const digestKey = `${forgeImageArgument.prefix}_IMAGE_DIGEST`;

  if (readOwnValue(assignments, digestKey) === undefined
    || readOwnValue(assignments, forgeImageArgument.name) !== undefined) {
    return undefined;
  }

  const tag = readOwnValue(assignments, 'FORGE_TAG');

  if (tag === undefined) {
    throw new Error(`Variable "FORGE_TAG" not found, but "${digestKey}" requires it.`);
  }

  const image = formatForgeImage(forgeImageArgument.role, assignments, readForgeImageNamespace(assignments));

  return `${image}:${tag}${forgeImageArgument.role.suffix}@${requireMakeVariable(assignments, digestKey)}`;
};

/**
 * @rejects {Error}
 */
const readArgumentValues = async (
  directory: string,
  argumentNames: readonly string[],
  stage: string,
): Promise<Record<string, string>> => {
  const forgeImageArguments = argumentNames.flatMap((name) => {
    const forgeImageArgument = readForgeImageArgument(name);

    return forgeImageArgument === undefined ? [] : [forgeImageArgument];
  });

  if (forgeImageArguments.length === 0) {
    return readMakeAssignments(directory, argumentNames, stage);
  }

  const assignments = await readMakeAssignments(directory, [
    ...argumentNames,
    ...forgeImageArguments.flatMap((forgeImageArgument) => [
      `${forgeImageArgument.prefix}_IMAGE_DIGEST`,
      forgeImageArgument.role.nameKey,
    ]),
    FORGE_IMAGE_NAME_KEY,
    'FORGE_NAMESPACE',
    'FORGE_IMAGE_NAMESPACE',
    'FORGE_TAG',
  ], stage);

  const resolvedImages = forgeImageArguments.flatMap((forgeImageArgument) => {
    const resolvedImage = resolveForgeImage(assignments, forgeImageArgument);

    return resolvedImage === undefined ? [] : [<const>[forgeImageArgument.name, resolvedImage]];
  });

  return {
    ...assignments,
    ...objectFromEntries(resolvedImages),
  };
};

/**
 * @rejects {Error}
 */
const findDockerfile = async (
  directory: string,
  stageVariables: Readonly<Record<'CONFIG_DIR' | 'IMAGE_DOCKERFILE', string>>,
  imageName: string,
): Promise<string> => {
  if (stageVariables.IMAGE_DOCKERFILE !== '') {
    const namedDockerfilePath = path.normalize(stageVariables.IMAGE_DOCKERFILE);

    if (!await file(path.join(directory, namedDockerfilePath)).exists()) {
      throw new Error(`The file "${namedDockerfilePath}" does not exist.`);
    }

    return namedDockerfilePath;
  }

  const dockerfileCandidates = [
    path.join(stageVariables.CONFIG_DIR, 'docker', `${imageName}.Dockerfile`),
    path.join('docker', `${imageName}.Dockerfile`),
  ];

  const projectDockerfilePath = await findFirstPassing(
    dockerfileCandidates,
    async (candidate) => file(path.join(directory, candidate)).exists(),
  );

  return projectDockerfilePath ?? path.relative(directory, GENERIC_DOCKERFILE);
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

  const dockerfilePath = await findDockerfile(directory, stageVariables, imageName);
  const dockerfileText = await file(path.join(directory, dockerfilePath)).text();
  const argumentValues = await readArgumentValues(directory, readArgumentNames(dockerfileText), stage);

  return [
    {
      aliases: splitWords(stageVariables.IMAGE_ALIASES),
      arguments: readBuildArguments(dockerfileText, argumentValues),
      base: readTargetBase(dockerfileText, stageVariables.IMAGE_TARGET),
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
