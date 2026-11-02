import { readStringArguments } from '#src/shared/utils/arguments';
import { requireEnvironmentValue } from '#src/shared/utils/environment';
import { readGroup } from '#src/shared/utils/pattern';
import { createShell } from '#src/shared/utils/shell';

import type { Environment } from '#src/shared/utils/environment';
import type { Shell, ShellContext } from '#src/shared/utils/shell';

interface StagedFile {
  readonly blob: string;
  readonly mode: string;
  readonly path: string;
  readonly previousMode: string;
  readonly status: string;
}

interface FileChanges {
  readonly additions: readonly {
    readonly contents: string;
    readonly path: string;
  }[];
  readonly deletions: readonly {
    readonly path: string;
  }[];
}

interface CommitTarget {
  readonly branch: string;
  readonly message: string;
}

interface CommitContext extends ShellContext {
  readonly repository: string;
}

const REGULAR_FILE_MODE = '100644';
const ADDED_STATUS = 'A';
const DELETED_STATUS = 'D';

const COMMIT_MUTATION = [
  'mutation ($input: CreateCommitOnBranchInput!) {',
  '  createCommitOnBranch(input: $input) { commit { oid } }',
  '}',
].join('\n');

const COMMIT_OID_QUERY = '.data.createCommitOnBranch.commit.oid';
const createRawDiffPattern = (): RegExp => /:(?<previousMode>\d+) (?<mode>\d+) [\da-f]+ (?<blob>[\da-f]+) (?<status>[A-Z])\d*\0(?<path>[^\0]+)\0/gv;

/**
 * @rejects {Error}
 */
const readStagedFiles = async (shell: Shell): Promise<StagedFile[]> => {
  const rawDiff = await shell`git diff --cached --raw -z --no-renames --no-abbrev`.text();

  return Array.from(rawDiff.matchAll(createRawDiffPattern()), (match) => ({
    blob: readGroup(match.groups, 'blob'),
    mode: readGroup(match.groups, 'mode'),
    path: readGroup(match.groups, 'path'),
    previousMode: readGroup(match.groups, 'previousMode'),
    status: readGroup(match.groups, 'status'),
  }));
};

/**
 * @throws {Error}
 */
const requireRegularFile = (stagedFile: StagedFile): void => {
  const modes = stagedFile.status === ADDED_STATUS ? [stagedFile.mode] : [stagedFile.previousMode, stagedFile.mode];
  const otherMode = modes.find((mode) => mode !== REGULAR_FILE_MODE);

  if (otherMode === undefined) {
    return;
  }

  throw new Error(
    `Unable to commit file "${stagedFile.path}": only regular files are supported, mode "${otherMode}" given.`,
  );
};

/**
 * @rejects {Error}
 */
const readBlob = async (shell: Shell, blob: string): Promise<string> => {
  const blobContents = await shell`git cat-file blob ${blob}`.quiet().arrayBuffer();

  return Buffer.from(blobContents).toString('base64');
};

/**
 * @rejects {Error}
 */
const readFileChanges = async (shell: Shell, stagedFiles: readonly StagedFile[]): Promise<FileChanges> => {
  const deletedFiles = stagedFiles.filter((stagedFile) => stagedFile.status === DELETED_STATUS);
  const writtenFiles = stagedFiles.filter((stagedFile) => stagedFile.status !== DELETED_STATUS);

  for (const writtenFile of writtenFiles) {
    requireRegularFile(writtenFile);
  }

  return {
    additions: await Promise.all(writtenFiles.map(async (writtenFile) => ({
      contents: await readBlob(shell, writtenFile.blob),
      path: writtenFile.path,
    }))),
    deletions: deletedFiles.map((deletedFile) => ({
      path: deletedFile.path,
    })),
  };
};

/**
 * @rejects {Error}
 */
const commitChanges = async (target: CommitTarget, context: CommitContext): Promise<string> => {
  const shell = createShell(context);
  const headListing = await shell`git rev-parse HEAD`.text();
  const head = headListing.trim();
  const stagedFiles = await readStagedFiles(shell);

  if (stagedFiles.length === 0) {
    return head;
  }

  const request = JSON.stringify({
    query: COMMIT_MUTATION,
    variables: {
      input: {
        branch: {
          branchName: target.branch,
          repositoryNameWithOwner: context.repository,
        },
        expectedHeadOid: head,
        fileChanges: await readFileChanges(shell, stagedFiles),
        message: {
          headline: target.message,
        },
      },
    },
  });

  const commit = await shell`gh api graphql --input - --jq ${COMMIT_OID_QUERY} <${new Response(request)}`.text();

  return commit.trim();
};

/**
 * @rejects {Error}
 */
export const main = async (argv: readonly string[], environment: Environment, directory: string): Promise<number> => {
  const options = readStringArguments(argv, [
    'branch',
    'message',
  ]);

  const target = <const>{
    branch: options.branch,
    message: options.message,
  } satisfies CommitTarget;

  const context = <const>{
    directory,
    environment,
    repository: requireEnvironmentValue(environment, 'GITHUB_REPOSITORY'),
  } satisfies CommitContext;

  process.stdout.write(`${await commitChanges(target, context)}\n`);

  return 0;
};
