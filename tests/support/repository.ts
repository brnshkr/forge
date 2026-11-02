import { file, Glob, write } from 'bun';
import { copyFile } from 'node:fs/promises';
import path from 'node:path';

import { FORGE_DIRECTORY, SHARED_MAKEFILE } from '#src/shared/make';
import { objectEntries } from '#src/shared/utils/object';
import { createDirectory } from '#tests/support/directory';
import { settleAll } from '#tests/support/promise';

const STARTER_MAKEFILE = path.join(path.dirname(SHARED_MAKEFILE), 'Makefile.dist');

/**
 * @rejects {Error}
 */
export const writeFiles = async (directory: string, files: Readonly<Record<string, string>>): Promise<void> => {
  await settleAll(objectEntries(files).map(async ([fileName, text]) => write(path.join(directory, fileName), text)));
};

/**
 * @rejects {Error}
 */
export const createRepository = async (files: Readonly<Record<string, string>>): Promise<string> => {
  const directory = await createDirectory('forge-');

  await copyFile(STARTER_MAKEFILE, path.join(directory, 'Makefile'));
  await writeFiles(directory, files);

  return directory;
};

export const readRepositoryFile = async (filePath: string): Promise<string> => file(
  path.join(FORGE_DIRECTORY, filePath),
).text();

/**
 * @rejects {ENOTDIR}
 */
export const listRepositoryFiles = async (pattern: string): Promise<string[]> => Array.fromAsync(
  new Glob(pattern).scan({
    cwd: FORGE_DIRECTORY,
    dot: true,
  }),
);

export const compareText = (left: string, right: string): number => left.localeCompare(right);
