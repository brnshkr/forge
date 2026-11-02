import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { main } from '#src/merge-back';

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

const ARGV = [
  '--release-branch=release/1.2.3',
  '--targets=dev/1.2',
  '--version=1.2.3',
];

const BOTH_LINES_ARGV = [
  '--release-branch=release/1.2.3',
  '--targets=dev/1.2 dev/1.x',
  '--version=1.2.3',
];

const MERGE_SUBJECT = 'chore(release): merge v1.2.3 into dev/1.2';
const REPOSITORY = 'acme/user';
const NOTICE = 'Neither of `dev/1.2` exists, so `v1.2.3` was not merged back.\n';

/**
 * @rejects {Error}
 */
const createReleasedClone = async (lines: readonly string[]): Promise<Clone> => {
  const clone = await createClone();

  await commit(clone.work, 'changelog.md', '1.2.3');
  await git(clone.work, 'tag v1.2.3');

  const refspecs = [
    'HEAD:refs/heads/release/1.2.3',
    'v1.2.3',
    ...lines.map((line) => `HEAD~1:refs/heads/${line}`),
  ];

  await git(clone.work, `push --quiet origin ${refspecs.join(' ')}`);

  return clone;
};

/**
 * @rejects {Error}
 */
const createGitHubEnvironment = async (clone: Clone, remote = clone.remote): Promise<Environment> => {
  const mergesEndpoint = [
    'for field; do',
    '  case $field in',
    '    base=*)',
    `      base=\${field#base=}`,
    '      ;;',
    '    head=*)',
    `      head=\${field#head=}`,
    '      ;;',
    '    commit_message=*)',
    `      message=\${field#commit_message=}`,
    '      ;;',
    '  esac',
    'done',
    `work=$(mktemp -d '${clone.root}/merge.XXXXXX')`,
    `git clone --quiet --branch "$base" '${remote}' "$work"`,
    'cd "$work" || exit 1',
    'if ! git merge --quiet --no-ff -m "$message" "$head" >/dev/null 2>&1; then',
    '  echo \'gh: Merge conflict (HTTP 409)\' >&2',
    '  exit 1',
    'fi',
    'git push --quiet origin "HEAD:$base"',
  ].join('\n');

  const stubs = await installStubs({
    gh: mergesEndpoint,
  });

  return {
    ...GIT_ENVIRONMENT,
    ...stubs.environment,
    GITHUB_REPOSITORY: REPOSITORY,
  };
};

/**
 * @rejects {Error}
 */
const mergeReleaseBack = async (clone: Clone): Promise<string> => {
  const standardOutputWrites = captureWrites(process.stdout);

  await main(BOTH_LINES_ARGV, await createGitHubEnvironment(clone), clone.work);

  return standardOutputWrites.join('');
};

/**
 * @rejects {Error}
 */
const listBranches = async (remote: string): Promise<string[]> => {
  const listing = await git(remote, 'branch --format=%(refname:short)');

  return listing === '' ? [] : listing.split('\n');
};

describe('a released version', () => {
  it('merges into the major line where its minor line is missing, then drops its branch', async () => {
    const clone = await createReleasedClone(['dev/1.x']);

    await expect(mergeReleaseBack(clone)).resolves.toBe('');

    await expect(git(clone.remote, 'log -1 --format=%s dev/1.x'))
      .resolves
      .toBe('chore(release): merge v1.2.3 into dev/1.x');

    await expect(listBranches(clone.remote)).resolves.toStrictEqual(['dev/1.x']);
  });

  it('prefers its minor line', async () => {
    const clone = await createReleasedClone([
      'dev/1.2',
      'dev/1.x',
    ]);

    await expect(mergeReleaseBack(clone)).resolves.toBe('');
    await expect(git(clone.remote, 'log -1 --format=%s dev/1.2')).resolves.toBe(MERGE_SUBJECT);
    await expect(git(clone.remote, 'log -1 --format=%s dev/1.x')).resolves.toBe('chore(test): write README.md');
  });

  it('merges only once when the job runs again', async () => {
    const clone = await createReleasedClone(['dev/1.x']);

    await mergeReleaseBack(clone);
    await git(clone.work, 'push --quiet origin v1.2.3:refs/heads/release/1.2.3');

    const developmentBranchHead = await git(clone.remote, 'rev-parse dev/1.x');

    await expect(mergeReleaseBack(clone)).resolves.toBe('');
    await expect(git(clone.remote, 'rev-parse dev/1.x')).resolves.toBe(developmentBranchHead);
    await expect(listBranches(clone.remote)).resolves.toStrictEqual(['dev/1.x']);
  });

  it('finishes a rerun that finds its branch already gone', async () => {
    const clone = await createReleasedClone(['dev/1.x']);

    await mergeReleaseBack(clone);

    await expect(mergeReleaseBack(clone)).resolves.toBe('');
    await expect(listBranches(clone.remote)).resolves.toStrictEqual(['dev/1.x']);
  });

  it('keeps its branch for a merge by hand when the merge conflicts', async () => {
    const clone = await createReleasedClone(['dev/1.x']);

    await git(clone.work, 'switch --quiet --detach origin/dev/1.x');
    await commit(clone.work, 'changelog.md', 'edited on dev');
    await git(clone.work, 'push --quiet origin HEAD:refs/heads/dev/1.x');

    await expect(mergeReleaseBack(clone))
      .rejects
      .toThrow('Unable to merge "v1.2.3" into "dev/1.x": gh: Merge conflict (HTTP 409)');

    await expect(listBranches(clone.remote)).resolves.toContain('release/1.2.3');
  });

  it('notes the skip and still drops its branch where no line exists', async () => {
    const clone = await createReleasedClone([]);

    await expect(mergeReleaseBack(clone))
      .resolves
      .toBe('Neither of `dev/1.2`, `dev/1.x` exists, so `v1.2.3` was not merged back.\n');

    await expect(listBranches(clone.remote)).resolves.toStrictEqual([]);
  });
});

describe('the merge-back script', () => {
  it('merges into the line it is given through origin, printing nothing', async () => {
    const clone = await createReleasedClone(['dev/1.2']);
    const standardOutputWrites = captureWrites(process.stdout);

    await expect(main(ARGV, await createGitHubEnvironment(clone), clone.work)).resolves.toBe(0);
    await expect(git(clone.remote, 'log -1 --format=%s dev/1.2')).resolves.toBe(MERGE_SUBJECT);

    expect(standardOutputWrites).toStrictEqual([]);
  });

  it('merges through the remote REMOTE names, leaving origin alone', async () => {
    const clone = await createReleasedClone(['dev/1.2']);
    const otherRemote = path.join(clone.root, 'other.git');

    await git(clone.root, `clone --quiet --bare ${clone.remote} ${otherRemote}`);

    const originHead = await git(clone.remote, 'rev-parse dev/1.2');

    const environment = {
      ...await createGitHubEnvironment(clone, otherRemote),
      REMOTE: otherRemote,
    };

    await expect(main(ARGV, environment, clone.work)).resolves.toBe(0);
    await expect(git(otherRemote, 'log -1 --format=%s dev/1.2')).resolves.toBe(MERGE_SUBJECT);
    await expect(git(clone.remote, 'rev-parse dev/1.2')).resolves.toBe(originHead);
  });

  it('prints its notice where no line exists', async () => {
    const clone = await createReleasedClone([]);
    const standardOutputWrites = captureWrites(process.stdout);

    await expect(main(ARGV, await createGitHubEnvironment(clone), clone.work)).resolves.toBe(0);

    expect(standardOutputWrites).toStrictEqual([NOTICE]);
  });
});
