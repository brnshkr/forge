import { $, env, write } from 'bun';
import path from 'node:path';

import { createDirectory } from '#tests/support/directory';

export interface Clone {
  readonly remote: string;
  readonly root: string;
  readonly work: string;
}

export const GIT_ENVIRONMENT = {
  HOME: env['HOME'],
  PATH: env['PATH'],
  GIT_AUTHOR_EMAIL: 'bot@acme.test',
  GIT_AUTHOR_NAME: 'Acme Bot',
  GIT_COMMITTER_EMAIL: 'bot@acme.test',
  GIT_COMMITTER_NAME: 'Acme Bot',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

/**
 * @rejects {Error}
 */
export const git = async (directory: string, command: string): Promise<string> => {
  const output = await $`git ${command.split(' ')}`
    .cwd(directory)
    .env(GIT_ENVIRONMENT)
    .quiet()
    .text();

  return output.trim();
};

/**
 * @rejects {Error}
 */
export const commit = async (directory: string, fileName: string, text: string): Promise<void> => {
  await write(path.join(directory, fileName), text);
  await git(directory, `add ${fileName}`);

  await $`git commit --quiet --message 'chore(test): write ${fileName}'`
    .cwd(directory)
    .env(GIT_ENVIRONMENT)
    .quiet();
};

/**
 * @rejects {Error}
 */
export const createClone = async (): Promise<Clone> => {
  const root = await createDirectory('forge-git-');
  const remote = path.join(root, 'remote.git');
  const work = path.join(root, 'work');

  await git(root, `init --quiet --bare --initial-branch=main ${remote}`);
  await git(root, `clone --quiet ${remote} ${work}`);
  await commit(work, 'README.md', 'acme');

  return {
    remote,
    root,
    work,
  };
};
