import { sleep, spawn } from 'bun';

import { isListedOnRegistry, RETRY_DELAYS_MILLISECONDS } from '#src/shared/registry';
import { readStringArguments } from '#src/shared/utils/arguments';

import type { Environment } from '#src/shared/utils/environment';

export const PUBLISH_MAX_ATTEMPTS = 3;

interface NpmRelease {
  readonly distributionTag: string;
  readonly name: string;
  readonly tarball: string;
  readonly version: string;
}

export interface NpmRegistry {
  readonly backoffMilliseconds: number;
  readonly retryDelaysMilliseconds: readonly number[];
  readonly timeoutMilliseconds: number;
  readonly url: string;
}

interface PublishSteps {
  readonly backoffMilliseconds: number;
  readonly doesPublish: () => Promise<boolean>;
  readonly isPublished: () => Promise<boolean>;
}

export const NPM_REGISTRY = <const>{
  url: 'https://registry.npmjs.org',
  backoffMilliseconds: 10_000,
  timeoutMilliseconds: 300_000,
  retryDelaysMilliseconds: RETRY_DELAYS_MILLISECONDS,
} satisfies NpmRegistry;

/**
 * @rejects {Error}
 */
const hasPublishedWithRetries = async (steps: PublishSteps, attempt = 1): Promise<boolean> => {
  if (await steps.isPublished()) {
    return true;
  }

  if (attempt > PUBLISH_MAX_ATTEMPTS) {
    return false;
  }

  if (await steps.doesPublish()) {
    return true;
  }

  await sleep(attempt * steps.backoffMilliseconds);

  return hasPublishedWithRetries(steps, attempt + 1);
};

/**
 * @rejects {Error}
 */
const doesPublishToNpm = async (
  release: NpmRelease,
  registry: NpmRegistry,
  environment: Environment,
): Promise<boolean> => {
  const publishCommand = await isListedOnRegistry(`${registry.url}/${release.name}`, registry.retryDelaysMilliseconds)
    ? [
      'npm',
      'publish',
      '--provenance',
    ]
    : [
      'bun',
      'publish',
    ];

  const doesPublish = async (): Promise<boolean> => {
    const publishProcess = spawn([
      ...publishCommand,
      release.tarball,
      '--access',
      'public',
      '--tag',
      release.distributionTag,
    ], {
      env: environment,
      stderr: 'inherit',
      stdout: 'inherit',
      timeout: registry.timeoutMilliseconds,
    });

    return await publishProcess.exited === 0;
  };

  /**
   * @rejects {Error}
   */
  const isPublished = async (): Promise<boolean> => isListedOnRegistry(
    `${registry.url}/${release.name}/${release.version}`,
    registry.retryDelaysMilliseconds,
  );

  return hasPublishedWithRetries({
    backoffMilliseconds: registry.backoffMilliseconds,
    doesPublish,
    isPublished,
  });
};

/**
 * @rejects {Error}
 */
export const main = async (
  argv: readonly string[],
  environment: Environment,
  registry: NpmRegistry,
): Promise<number> => {
  const options = readStringArguments(argv, [
    'distribution-tag',
    'name',
    'tarball',
    'version',
  ]);

  const release = <const>{
    distributionTag: options['distribution-tag'],
    name: options.name,
    tarball: options.tarball,
    version: options.version,
  } satisfies NpmRelease;

  if (await doesPublishToNpm(release, registry, environment)) {
    return 0;
  }

  process.stderr.write(`Unable to publish "${release.name}@${release.version}" to npm.\n`);

  return 1;
};
