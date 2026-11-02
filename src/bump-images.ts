import path from 'node:path';

import { bumpPinnedReferences } from '#src/shared/bump/bump-references';
import { bumpSplitPins } from '#src/shared/bump/bump-split-pins';
import { readMoveFormat, writeMoves } from '#src/shared/bump/moves';
import { readMinimumReleaseAge, readReleaseAge, writeSightings } from '#src/shared/bump/release-age';

import {
  readMakeList,
  readMakeVariables,
  splitWords,
} from '#src/shared/make';

import { readDotenvFile } from '#src/shared/pins/dotenv';

import {
  readDotenvText,
  readPinnedFiles,
  writeChangedFiles,
} from '#src/shared/pins/files';

import { readStringArguments } from '#src/shared/utils/arguments';

import type { BumpContext } from '#src/shared/bump/bump-references';
import type { PinnedFile } from '#src/shared/pins/files';
import type { Registries } from '#src/shared/registry';
import type { Maybe } from '#src/shared/types/core';
import type { Environment } from '#src/shared/utils/environment';

const RELEASE_AGE_SCOPE = 'bump-images';

/**
 * @rejects {Error}
 */
const readComposeFiles = async (directory: string, stages: readonly string[]): Promise<string[]> => {
  const composeFileLists = await Promise.all([...new Set(stages)].map(async (stage) => readMakeList(
    directory,
    'COMPOSE_FILES',
    stage,
  )));

  return [
    ...new Set(composeFileLists.flat().map((composeFile) => path.relative(
      directory,
      path.resolve(directory, composeFile),
    ))),
  ];
};

/**
 * @rejects {Error}
 */
const readBumpFiles = async (directory: string, dotenvFile: Maybe<string>): Promise<PinnedFile[]> => {
  const makeVariables = await readMakeVariables(directory, {
    required: [
      'DOTENV_DEFAULT_ENV',
      'DOTENV_STAGES',
    ],
  });

  const stages = splitWords(makeVariables.DOTENV_STAGES);

  const environmentFileNames = dotenvFile === undefined
    ? []
    : [
      dotenvFile,
      ...stages.map((stage) => `${dotenvFile}.${stage}`),
    ];

  const composeFileNames = await readComposeFiles(directory, [
    makeVariables.DOTENV_DEFAULT_ENV,
    ...stages,
  ]);

  const pinnedFileGroups = await Promise.all([
    readPinnedFiles(directory, environmentFileNames, 'environment'),
    readPinnedFiles(directory, composeFileNames, 'compose'),
  ]);

  return pinnedFileGroups.flat();
};

/**
 * @rejects {Error}
 * @rejects {ENOTDIR}
 */
export const main = async (
  argv: readonly string[],
  environment: Environment,
  directory: string,
  registries: Registries,
): Promise<number> => {
  const options = readStringArguments(argv, [
    'format',
    'seen-file',
  ]);

  const format = readMoveFormat(options.format);
  const dotenvFile = await readDotenvFile(directory);
  const pinnedFiles = await readBumpFiles(directory, dotenvFile);
  const minimumReleaseAge = readMinimumReleaseAge(readDotenvText(pinnedFiles, dotenvFile), environment);

  const context = <const>{
    directory,
    dotenvFile,
    registries,
    releaseAge: await readReleaseAge(options['seen-file'], RELEASE_AGE_SCOPE, minimumReleaseAge),
  } satisfies BumpContext;

  const referenceBump = await bumpPinnedReferences(pinnedFiles, context);
  const splitPinBump = await bumpSplitPins(referenceBump.files, context);
  const writeIssues = await writeChangedFiles(pinnedFiles, splitPinBump.files, directory);

  const sightings = [
    ...referenceBump.sightings,
    ...splitPinBump.sightings,
  ];

  await writeSightings(sightings, context.releaseAge);

  if (writeIssues.length > 0) {
    process.stderr.write(`${writeIssues.join('\n')}\n`);

    return 1;
  }

  const moves = [
    ...referenceBump.moves,
    ...splitPinBump.moves,
  ];

  writeMoves(moves, format);

  return 0;
};
