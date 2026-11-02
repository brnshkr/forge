import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { onTestFinished } from 'vitest';

export const createDirectory = async (prefix: string, parentDirectory: string = tmpdir()): Promise<string> => {
  const directory = await mkdtemp(path.join(parentDirectory, prefix));

  onTestFinished(async () => {
    await rm(directory, {
      force: true,
      recursive: true,
    });
  });

  return directory;
};
