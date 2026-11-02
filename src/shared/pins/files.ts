import { file, write } from 'bun';
import path from 'node:path';

import { getErrorMessage } from '#src/shared/utils/error';
import { readRejectionMessages } from '#src/shared/utils/promise';

import type { PinSyntax } from '#src/shared/pins/references';
import type { Maybe } from '#src/shared/types/core';

export interface PinnedFile {
  readonly filePath: string;
  readonly syntax: PinSyntax;
  readonly text: string;
}

export const readPinnedFiles = async (
  directory: string,
  filePaths: readonly string[],
  syntax: PinSyntax,
): Promise<PinnedFile[]> => {
  const existingFilePaths = await Promise.all(filePaths.map(async (filePath) => (
    await file(path.resolve(directory, filePath)).exists() ? [filePath] : []
  )));

  return Promise.all(existingFilePaths.flat().map(async (filePath) => ({
    filePath,
    syntax,
    text: await file(path.resolve(directory, filePath)).text(),
  })));
};

export const readDotenvText = (pinnedFiles: readonly PinnedFile[], dotenvFile: Maybe<string>): string => pinnedFiles
  .find((pinnedFile) => pinnedFile.filePath === dotenvFile)
  ?.text ?? '';

/**
 * @rejects {Error}
 */
const writePinnedFile = async (directory: string, pinnedFile: PinnedFile): Promise<void> => {
  try {
    await write(path.resolve(directory, pinnedFile.filePath), pinnedFile.text);
  } catch (error) {
    throw new Error(`Unable to write file "${pinnedFile.filePath}": ${getErrorMessage(error)}`, {
      cause: error,
    });
  }
};

/**
 * @rejects {Error}
 */
export const writeChangedFiles = async (
  readFiles: readonly PinnedFile[],
  bumpedFiles: readonly PinnedFile[],
  directory: string,
): Promise<string[]> => {
  const readTexts = new Map(readFiles.map((readFile) => <const>[readFile.filePath, readFile.text]));

  const writeResults = await Promise.allSettled(bumpedFiles
    .filter((bumpedFile) => readTexts.get(bumpedFile.filePath) !== bumpedFile.text)
    .map(async (bumpedFile) => writePinnedFile(directory, bumpedFile)));

  return readRejectionMessages(writeResults);
};
