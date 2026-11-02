import { splitWords } from '#src/shared/make';
import { readStringArguments } from '#src/shared/utils/arguments';
import { getErrorMessage } from '#src/shared/utils/error';
import { readRejectionMessages } from '#src/shared/utils/promise';
import { createApiFields, createShell, readRemoteContext } from '#src/shared/utils/shell';
import { before } from '#src/shared/utils/string';

import type { Environment } from '#src/shared/utils/environment';
import type { RemoteContext, Shell } from '#src/shared/utils/shell';

interface ReleaseTags {
  readonly commit: string;
  readonly tags: readonly string[];
}

const FULL_VERSION_PART_COUNT = 3;

/**
 * @rejects {Error}
 */
const readRemoteCommit = async (shell: Shell, remote: string, tag: string): Promise<string> => {
  const remoteTagListing = await shell`git ls-remote --tags ${remote} refs/tags/${tag} 'refs/tags/${tag}^{}'`.text();
  const trimmedRemoteTagListing = remoteTagListing.trim();

  return before(trimmedRemoteTagListing.slice(trimmedRemoteTagListing.lastIndexOf('\n') + 1), '\t');
};

/**
 * @rejects {Error}
 */
const createVersionTag = async (shell: Shell, repository: string, commit: string, tag: string): Promise<void> => {
  const tagFields = createApiFields([
    `tag=${tag}`,
    `message=${tag.slice(1)}`,
    `object=${commit}`,
    'type=commit',
  ]);

  const tagObjectSha = await shell`gh api repos/${repository}/git/tags ${tagFields} --jq .sha`.text();

  await shell`gh api repos/${repository}/git/refs -f 'ref=refs/tags/${tag}' -f 'sha=${tagObjectSha.trim()}'`.quiet();
};

/**
 * @rejects {Error}
 */
const moveFloatingTag = async (shell: Shell, remote: string, commit: string, tag: string): Promise<void> => {
  await shell`git tag --force ${tag} ${commit}`.quiet();
  await shell`git push --quiet --force ${remote} 'refs/tags/${tag}'`;
};

/**
 * @rejects {Error}
 */
const pushTag = async (tag: string, push: () => Promise<void>): Promise<void> => {
  try {
    await push();
  } catch (error) {
    throw new Error(`Unable to push tag "${tag}": ${getErrorMessage(error)}`, {
      cause: error,
    });
  }
};

/**
 * @rejects {Error}
 */
const pushTags = async (release: ReleaseTags, context: RemoteContext): Promise<string[]> => {
  const shell = createShell(context);
  const versionTags = release.tags.filter((tag) => tag.split('.').length >= FULL_VERSION_PART_COUNT);
  const floatingTags = release.tags.filter((tag) => !versionTags.includes(tag));

  const remoteTags = await Promise.all(versionTags.map(async (tag) => ({
    commit: await readRemoteCommit(shell, context.remote, tag),
    tag,
  })));

  const misplacedTagIssues = remoteTags
    .filter((remoteTag) => !['', release.commit].includes(remoteTag.commit))
    .map(
      (remoteTag) => `Tag "${
        remoteTag.tag
      }" already exists and points at "${
        remoteTag.commit
      }", not "${
        release.commit
      }".`,
    );

  if (misplacedTagIssues.length > 0) {
    return misplacedTagIssues;
  }

  const missingVersionTags = remoteTags
    .filter((remoteTag) => remoteTag.commit === '')
    .map((remoteTag) => remoteTag.tag);

  const tagResults = await Promise.allSettled([
    ...missingVersionTags.map(async (tag) => pushTag(tag, async () => createVersionTag(
      shell,
      context.repository,
      release.commit,
      tag,
    ))),
    ...floatingTags.map(async (tag) => pushTag(tag, async () => moveFloatingTag(
      shell,
      context.remote,
      release.commit,
      tag,
    ))),
  ]);

  return readRejectionMessages(tagResults);
};

/**
 * @rejects {Error}
 */
export const main = async (argv: readonly string[], environment: Environment, directory: string): Promise<number> => {
  const options = readStringArguments(argv, [
    'commit',
    'tags',
  ]);

  const release = <const>{
    commit: options.commit,
    tags: splitWords(options.tags),
  } satisfies ReleaseTags;

  const issues = await pushTags(release, readRemoteContext(environment, directory));

  if (issues.length === 0) {
    return 0;
  }

  process.stderr.write(`${issues.join('\n')}\n`);

  return 1;
};
