import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { main } from '#src/push-tags';

import {
  commit,
  createClone,
  git,
  GIT_ENVIRONMENT,
} from '#tests/support/git';

import { captureWrites } from '#tests/support/output';
import { installStubs } from '#tests/support/stubs';

interface ReleaseTags {
  readonly commit: string;
  readonly tags: readonly string[];
}

interface Tagging {
  readonly push: (release: ReleaseTags) => Promise<string[]>;
  readonly readCalls: () => Promise<string[]>;
}

const RELEASE_TAGS = [
  'v1',
  'v1.2',
  'v1.2.3',
];

/**
 * @rejects {Error}
 */
const createTagging = async (
  work: string,
  remote: string,
  ghBody: string,
): Promise<Tagging> => {
  const stubs = await installStubs({
    gh: ghBody,
  });

  const environment = {
    ...GIT_ENVIRONMENT,
    ...stubs.environment,
    GITHUB_REPOSITORY: 'acme/user',
    REMOTE: remote,
  };

  return {
    push: async (release): Promise<string[]> => {
      const standardErrorWrites = captureWrites(process.stderr);

      const argv = [
        `--commit=${release.commit}`,
        `--tags=${release.tags.join(' ')}`,
      ];

      await main(argv, environment, work);

      return standardErrorWrites
        .join('')
        .split('\n')
        .filter((line) => line !== '');
    },
    readCalls: stubs.readCalls,
  };
};

describe('the tags of a release', () => {
  it('move the major and minor, leaving a full version already at the commit alone', async () => {
    const clone = await createClone();
    const released = await git(clone.work, 'rev-parse HEAD');
    const tagging = await createTagging(clone.work, clone.remote, 'exit 1');

    await git(clone.work, 'tag --annotate --message 1.2.3 v1.2.3');
    await git(clone.work, 'push --quiet origin v1.2.3');

    const release = {
      commit: released,
      tags: RELEASE_TAGS,
    };

    await expect(tagging.push(release)).resolves.toStrictEqual([]);
    await expect(git(clone.remote, 'rev-parse v1^0')).resolves.toBe(released);
    await expect(git(clone.remote, 'rev-parse v1.2^0')).resolves.toBe(released);
    await expect(tagging.readCalls()).resolves.toStrictEqual([]);
  });

  it('are refused, moving nothing, while the full version points elsewhere', async () => {
    const clone = await createClone();
    const tagging = await createTagging(clone.work, clone.remote, 'exit 1');

    await git(clone.work, 'tag v1.2.3');
    await git(clone.work, 'push --quiet origin v1.2.3');

    const taggedCommit = await git(clone.work, 'rev-parse HEAD');

    await commit(clone.work, 'changelog.md', '1.2.3');

    const release = {
      commit: await git(clone.work, 'rev-parse HEAD'),
      tags: RELEASE_TAGS,
    };

    await expect(tagging.push(release))
      .resolves
      .toStrictEqual([
        `Tag "v1.2.3" already exists and points at "${taggedCommit}", not "${release.commit}".`,
      ]);

    await expect(git(clone.remote, 'tag --list v1 v1.2')).resolves.toBe('');
  });

  it.each([
    {
      tag: 'v1.2.3',
    },
    {
      tag: 'v1.2.3-rc.1',
    },
  ])('create $tag through the API, so GitHub signs it as the bot', async (scenario) => {
    const clone = await createClone();
    const tagging = await createTagging(clone.work, clone.remote, 'echo acme-tag-object');

    const release = {
      commit: await git(clone.work, 'rev-parse HEAD'),
      tags: [scenario.tag],
    };

    await expect(tagging.push(release)).resolves.toStrictEqual([]);

    await expect(tagging.readCalls()).resolves.toStrictEqual([
      `gh api repos/acme/user/git/tags -f tag=${scenario.tag} -f message=${scenario.tag.slice(1)}`
      + ` -f object=${release.commit} -f type=commit --jq .sha`,
      `gh api repos/acme/user/git/refs -f ref=refs/tags/${scenario.tag} -f sha=acme-tag-object`,
    ]);
  });

  it('finish every push and report each failure, naming its tag', async () => {
    const clone = await createClone();
    const tagging = await createTagging(clone.work, clone.remote, 'exit 1');

    const release = {
      commit: await git(clone.work, 'rev-parse HEAD'),
      tags: [
        'v1',
        'v1.2.3',
        'v1.2.3-rc.1',
      ],
    };

    await expect(tagging.push(release)).resolves.toStrictEqual([
      'Unable to push tag "v1.2.3": Failed with exit code 1',
      'Unable to push tag "v1.2.3-rc.1": Failed with exit code 1',
    ]);

    await expect(git(clone.remote, 'rev-parse v1^0')).resolves.toBe(release.commit);
  });
});

describe('the push-tags script', () => {
  it('moves the tags it is given through origin', async () => {
    const clone = await createClone();
    const released = await git(clone.work, 'rev-parse HEAD');

    const argv = [
      `--commit=${released}`,
      '--tags=v1 v1.2',
    ];

    const environment = {
      ...GIT_ENVIRONMENT,
      GITHUB_REPOSITORY: 'acme/user',
    };

    await expect(main(argv, environment, clone.work)).resolves.toBe(0);
    await expect(git(clone.remote, 'rev-parse v1.2^0')).resolves.toBe(released);
  });

  it('moves the tags through the remote REMOTE names, leaving origin alone', async () => {
    const clone = await createClone();
    const released = await git(clone.work, 'rev-parse HEAD');
    const otherRemote = path.join(clone.root, 'other.git');

    await git(clone.root, `clone --quiet --bare ${clone.remote} ${otherRemote}`);

    const argv = [
      `--commit=${released}`,
      '--tags=v1 v1.2',
    ];

    const environment = {
      ...GIT_ENVIRONMENT,
      GITHUB_REPOSITORY: 'acme/user',
      REMOTE: otherRemote,
    };

    await expect(main(argv, environment, clone.work)).resolves.toBe(0);
    await expect(git(otherRemote, 'rev-parse v1.2^0')).resolves.toBe(released);
    await expect(git(clone.remote, 'tag --list v1 v1.2')).resolves.toBe('');
  });

  it('fails and prints why when a full version points elsewhere', async () => {
    const clone = await createClone();
    const standardErrorWrites = captureWrites(process.stderr);

    await git(clone.work, 'tag v1.2.3');
    await git(clone.work, 'push --quiet origin v1.2.3');

    const taggedCommit = await git(clone.work, 'rev-parse HEAD');

    await commit(clone.work, 'changelog.md', '1.2.3');

    const released = await git(clone.work, 'rev-parse HEAD');

    const argv = [
      `--commit=${released}`,
      '--tags=v1.2.3',
    ];

    const environment = {
      ...GIT_ENVIRONMENT,
      GITHUB_REPOSITORY: 'acme/user',
      REMOTE: clone.remote,
    };

    await expect(main(argv, environment, clone.work)).resolves.toBe(1);

    expect(standardErrorWrites)
      .toStrictEqual([
        `Tag "v1.2.3" already exists and points at "${taggedCommit}", not "${released}".\n`,
      ]);
  });
});
