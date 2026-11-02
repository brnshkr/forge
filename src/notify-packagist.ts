import { fetchOk, isListedOnRegistry, RETRY_DELAYS_MILLISECONDS } from '#src/shared/registry';
import { readStringArguments } from '#src/shared/utils/arguments';
import { requireEnvironmentValue } from '#src/shared/utils/environment';

import type { Environment } from '#src/shared/utils/environment';

export interface PackagistRegistry {
  readonly url: string;
  readonly retryDelaysMilliseconds: readonly number[];
}

interface PackagistNotice {
  readonly name: string;
  readonly repositoryUrl: string;
  readonly username: string;
  readonly token: string;
}

export const PACKAGIST_REGISTRY = <const>{
  url: 'https://packagist.org',
  retryDelaysMilliseconds: RETRY_DELAYS_MILLISECONDS,
} satisfies PackagistRegistry;

/**
 * @rejects {Error}
 */
const notifyPackagist = async (notice: PackagistNotice, registry: PackagistRegistry): Promise<void> => {
  const isListed = await isListedOnRegistry(
    `${registry.url}/packages/${notice.name}.json`,
    registry.retryDelaysMilliseconds,
  );

  await fetchOk(`${registry.url}/api/${isListed ? 'update-package' : 'create-package'}`, {
    method: 'POST',
    headers: [
      ['Authorization', `Bearer ${notice.username}:${notice.token}`],
      ['Content-Type', 'application/json'],
    ],
    body: JSON.stringify({
      repository: {
        url: notice.repositoryUrl,
      },
    }),
  });
};

/**
 * @rejects {Error}
 */
export const main = async (
  argv: readonly string[],
  environment: Environment,
  registry: PackagistRegistry,
): Promise<number> => {
  const options = readStringArguments(argv, [
    'name',
    'repository-url',
  ]);

  await notifyPackagist({
    name: options.name,
    repositoryUrl: options['repository-url'],
    username: requireEnvironmentValue(environment, 'PACKAGIST_USERNAME'),
    token: requireEnvironmentValue(environment, 'PACKAGIST_TOKEN'),
  }, registry);

  return 0;
};
