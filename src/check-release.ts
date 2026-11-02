import { isListedOnRegistry } from '#src/shared/registry';
import { findSecretIssues } from '#src/shared/release/manifests';
import { isSkipped, readSkippedNames } from '#src/shared/release/skip';

import {
  findPredecessorTag,
  formatVersion,
  listVersionTags,
  parseBranchVersion,
} from '#src/shared/release/versions';

import { readStringArguments } from '#src/shared/utils/arguments';
import { hasEnvironmentValue } from '#src/shared/utils/environment';
import { createShell } from '#src/shared/utils/shell';

import type { NpmState } from '#src/shared/release/manifests';
import type { ReleaseVersion } from '#src/shared/release/versions';
import type { Environment } from '#src/shared/utils/environment';
import type { Shell, ShellContext } from '#src/shared/utils/shell';

interface ReleasePackages {
  readonly npm: string;
  readonly packagist: string;
  readonly reference: string;
  readonly skippedNames: readonly string[];
}

export interface NpmRegistrySource {
  readonly url: string;
  readonly retryDelaysMilliseconds: readonly number[];
}

interface CheckContext extends ShellContext {
  readonly registry: NpmRegistrySource;
}

/**
 * @rejects {Error}
 */
const readNpmState = async (registry: NpmRegistrySource, name: string, version: string): Promise<NpmState> => {
  if (await isListedOnRegistry(`${registry.url}/${name}/${version}`, registry.retryDelaysMilliseconds)) {
    return 'published';
  }

  return await isListedOnRegistry(`${registry.url}/${name}`, registry.retryDelaysMilliseconds)
    ? 'known'
    : 'new';
};

/**
 * @rejects {Error}
 */
const findAncestryIssues = async (shell: Shell, release: ReleaseVersion, reference: string): Promise<string[]> => {
  const predecessorTag = await findPredecessorTag(release, await listVersionTags(shell));

  if (predecessorTag === undefined) {
    return [];
  }

  const ancestryCheck = await shell`git merge-base --is-ancestor ${predecessorTag} HEAD`.nothrow();

  if (ancestryCheck.exitCode === 0) {
    return [];
  }

  return [`Branch "${reference}" does not contain the previous release "${predecessorTag}".`];
};

/**
 * @rejects {Error}
 */
const checkRelease = async (packages: ReleasePackages, context: CheckContext): Promise<string[]> => {
  const branchVersion = await parseBranchVersion(packages.reference);

  if (branchVersion?.kind !== 'release') {
    return [];
  }

  const version = formatVersion(branchVersion);
  const npmPackage = isSkipped(packages.skippedNames, 'npm') ? '' : packages.npm;
  const packagistPackage = isSkipped(packages.skippedNames, 'packagist') ? '' : packages.packagist;

  const [npmState, ancestryIssues] = await Promise.all([
    npmPackage === '' ? <const>'new' : readNpmState(context.registry, npmPackage, version),
    findAncestryIssues(createShell(context), branchVersion, packages.reference),
  ]);

  const issues = [
    ...findSecretIssues({
      hasNpmToken: hasEnvironmentValue(context.environment, 'NPM_CONFIG_TOKEN'),
      hasPackagistCredentials: hasEnvironmentValue(context.environment, 'PACKAGIST_USERNAME')
        && hasEnvironmentValue(context.environment, 'PACKAGIST_TOKEN'),
      npm: npmPackage,
      npmState,
      packagist: packagistPackage,
    }),
    ...ancestryIssues,
  ];

  return issues.length === 0 ? [] : [`Unable to release "${version}":`, ...issues];
};

/**
 * @rejects {Error}
 */
export const main = async (
  argv: readonly string[],
  environment: Environment,
  directory: string,
  registry: NpmRegistrySource,
): Promise<number> => {
  const options = readStringArguments(argv, [
    'npm',
    'packagist',
    'reference',
    'skip',
  ]);

  const skippedNames = readSkippedNames(options.skip);

  const packages = <const>{
    npm: options.npm,
    packagist: options.packagist,
    reference: options.reference,
    skippedNames,
  } satisfies ReleasePackages;

  const issues = await checkRelease(packages, {
    directory,
    environment,
    registry,
  });

  if (issues.length === 0) {
    return 0;
  }

  process.stderr.write(`${issues.join('\n')}\n`);

  return 1;
};
