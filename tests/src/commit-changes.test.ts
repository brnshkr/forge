import { file, write } from 'bun';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { main } from '#src/commit-changes';

import {
  commit,
  createClone,
  git,
  GIT_ENVIRONMENT,
} from '#tests/support/git';

import { captureWrites } from '#tests/support/output';
import { installStubs } from '#tests/support/stubs';

import type { Environment } from '#src/shared/utils/environment';
import type { Clone } from '#tests/support/git';

interface ApiContext {
  readonly environment: Environment;
  readonly requestFile: string;
  readonly readCalls: () => Promise<string[]>;
}

const COMMIT_OID = '0123456789abcdef0123456789abcdef01234567';
const GRAPHQL_CALL = 'gh api graphql --input - --jq .data.createCommitOnBranch.commit.oid';
const REPOSITORY = 'acme/user';

const ARGV = [
  '--branch=dev/1.x',
  '--message=chore(hygiene): apply fixes',
];

/**
 * @rejects {Error}
 */
const createApiContext = async (clone: Clone): Promise<ApiContext> => {
  const requestFile = path.join(clone.root, 'request.json');

  const stubs = await installStubs({
    gh: `cat >'${requestFile}'\nprintf '%s\\n' ${COMMIT_OID}`,
  });

  return {
    environment: {
      ...GIT_ENVIRONMENT,
      ...stubs.environment,
    },
    requestFile,
    readCalls: stubs.readCalls,
  };
};

/**
 * @rejects {Error}
 */
const commitStaged = async (clone: Clone, api: ApiContext): Promise<string> => {
  const standardOutputWrites = captureWrites(process.stdout);

  const environment = {
    ...api.environment,
    GITHUB_REPOSITORY: REPOSITORY,
  };

  await main(ARGV, environment, clone.work);

  return standardOutputWrites.join('').trim();
};

const toBase64 = (text: string): string => Buffer.from(text).toString('base64');

describe('the commit-changes script', () => {
  it('sends every staged change as one commit through the API, expecting the head it started from', async () => {
    const clone = await createClone();
    const api = await createApiContext(clone);

    await commit(clone.work, 'changed.txt', 'old');
    await commit(clone.work, 'gone.txt', 'gone');
    await write(path.join(clone.work, 'changed.txt'), 'new');
    await write(path.join(clone.work, 'added.txt'), 'added');
    await git(clone.work, 'rm --quiet gone.txt');
    await git(clone.work, 'add changed.txt added.txt');

    const head = await git(clone.work, 'rev-parse HEAD');

    await expect(commitStaged(clone, api)).resolves.toBe(COMMIT_OID);
    await expect(api.readCalls()).resolves.toStrictEqual([GRAPHQL_CALL]);

    const request = <{ variables: { input: unknown } }>JSON.parse(await file(api.requestFile).text());

    expect(request.variables.input).toStrictEqual({
      branch: {
        branchName: 'dev/1.x',
        repositoryNameWithOwner: REPOSITORY,
      },
      expectedHeadOid: head,
      fileChanges: {
        additions: [
          {
            contents: toBase64('added'),
            path: 'added.txt',
          },
          {
            contents: toBase64('new'),
            path: 'changed.txt',
          },
        ],
        deletions: [
          {
            path: 'gone.txt',
          },
        ],
      },
      message: {
        headline: 'chore(hygiene): apply fixes',
      },
    });
  });

  it('calls nothing and names the head where nothing is staged', async () => {
    const clone = await createClone();
    const api = await createApiContext(clone);

    await commit(clone.work, 'kept.txt', 'kept');
    await write(path.join(clone.work, 'unstaged.txt'), 'unstaged');

    await expect(commitStaged(clone, api)).resolves.toBe(await git(clone.work, 'rev-parse HEAD'));
    await expect(api.readCalls()).resolves.toStrictEqual([]);
  });

  it.each([
    {
      name: 'an executable it adds',
      prepare: async (clone: Clone): Promise<void> => {
        await write(path.join(clone.work, 'tool.sh'), 'exit 0');
        await git(clone.work, 'add tool.sh');
        await git(clone.work, 'update-index --chmod=+x tool.sh');
      },
    },
    {
      name: 'an executable it changes',
      prepare: async (clone: Clone): Promise<void> => {
        await commit(clone.work, 'tool.sh', 'exit 0');
        await git(clone.work, 'update-index --chmod=+x tool.sh');
        await git(clone.work, 'commit --quiet -m chore(test):make-executable');
        await write(path.join(clone.work, 'tool.sh'), 'exit 1');
        await git(clone.work, 'add tool.sh');
      },
    },
    {
      name: 'a file it makes executable',
      prepare: async (clone: Clone): Promise<void> => {
        await commit(clone.work, 'tool.sh', 'exit 0');
        await git(clone.work, 'update-index --chmod=+x tool.sh');
      },
    },
  ])('refuses $name, since the API only writes regular files', async (scenario) => {
    const clone = await createClone();
    const api = await createApiContext(clone);

    await scenario.prepare(clone);

    await expect(commitStaged(clone, api)).rejects.toThrow(
      'Unable to commit file "tool.sh": only regular files are supported, mode "100755" given.',
    );

    await expect(api.readCalls()).resolves.toStrictEqual([]);
  });

  it('prints the new commit for the workflow', async () => {
    const clone = await createClone();
    const api = await createApiContext(clone);
    const standardOutputWrites = captureWrites(process.stdout);

    await write(path.join(clone.work, 'added.txt'), 'added');
    await git(clone.work, 'add added.txt');

    const argv = [
      '--branch=dev/1.x',
      '--message=chore(hygiene): apply fixes',
    ];

    const environment = {
      ...api.environment,
      GITHUB_REPOSITORY: REPOSITORY,
    };

    await expect(main(argv, environment, clone.work)).resolves.toBe(0);

    expect(standardOutputWrites).toStrictEqual([`${COMMIT_OID}\n`]);
  });
});
