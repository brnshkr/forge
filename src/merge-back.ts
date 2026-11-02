import { splitWords } from '#src/shared/make';
import { readStringArguments } from '#src/shared/utils/arguments';
import { findFirstPassing } from '#src/shared/utils/promise';
import { createApiFields, createShell, readRemoteContext } from '#src/shared/utils/shell';

import type { Environment } from '#src/shared/utils/environment';
import type { RemoteContext, Shell } from '#src/shared/utils/shell';

interface ReleasedVersion {
  readonly releaseBranch: string;
  readonly targets: readonly string[];
  readonly version: string;
}

/**
 * @rejects {Error}
 */
const hasBranch = async (shell: Shell, remote: string, branch: string): Promise<boolean> => {
  const remoteBranchListing = await shell`git ls-remote --exit-code --heads ${remote} ${branch}`.quiet().nothrow();

  return remoteBranchListing.exitCode === 0;
};

/**
 * @rejects {Error}
 */
const mergeInto = async (
  shell: Shell,
  context: RemoteContext,
  release: ReleasedVersion,
  branch: string,
): Promise<void> => {
  await shell`git fetch --quiet ${context.remote} ${branch}`;

  const ancestryCheck = await shell`git merge-base --is-ancestor v${release.version} FETCH_HEAD`.nothrow();

  if (ancestryCheck.exitCode === 0) {
    return;
  }

  const releaseCommitListing = await shell`git rev-parse v${release.version}^{commit}`.text();

  const mergeFields = createApiFields([
    `base=${branch}`,
    `head=${releaseCommitListing.trim()}`,
    `commit_message=chore(release): merge v${release.version} into ${branch}`,
  ]);

  const mergeRun = await shell`gh api repos/${context.repository}/merges ${mergeFields}`.quiet().nothrow();

  if (mergeRun.exitCode !== 0) {
    throw new Error(`Unable to merge "v${release.version}" into "${branch}": ${mergeRun.stderr.toString().trim()}`);
  }
};

/**
 * @rejects {Error}
 */
const mergeBack = async (release: ReleasedVersion, context: RemoteContext): Promise<string> => {
  const shell = createShell(context);

  const mergeTarget = await findFirstPassing(release.targets, async (branch) => hasBranch(
    shell,
    context.remote,
    branch,
  ));

  if (mergeTarget !== undefined) {
    await mergeInto(
      shell,
      context,
      release,
      mergeTarget,
    );
  }

  if (await hasBranch(shell, context.remote, release.releaseBranch)) {
    await shell`git push --quiet ${context.remote} --delete ${release.releaseBranch}`;
  }

  return mergeTarget === undefined
    ? `Neither of \`${release.targets.join('`, `')}\` exists, so \`v${release.version}\` was not merged back.\n`
    : '';
};

/**
 * @rejects {Error}
 */
export const main = async (argv: readonly string[], environment: Environment, directory: string): Promise<number> => {
  const options = readStringArguments(argv, [
    'release-branch',
    'targets',
    'version',
  ]);

  const release = <const>{
    releaseBranch: options['release-branch'],
    targets: splitWords(options.targets),
    version: options.version,
  } satisfies ReleasedVersion;

  const skipNotice = await mergeBack(release, readRemoteContext(environment, directory));

  if (skipNotice !== '') {
    process.stdout.write(skipNotice);
  }

  return 0;
};
