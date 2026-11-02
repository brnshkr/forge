import { describe, expect, it } from 'vitest';

import { main } from '#src/check-release';
import { STATUS_CODE } from '#src/shared/utils/http';

import {
  commit,
  createClone,
  git,
  GIT_ENVIRONMENT,
} from '#tests/support/git';

import { serveNpmRegistry } from '#tests/support/npm';
import { captureWrites } from '#tests/support/output';
import { createUnreachableUrl, serve } from '#tests/support/server';

import type { NpmRegistrySource } from '#src/check-release';
import type { Environment } from '#src/shared/utils/environment';

interface CheckContext {
  readonly directory: string;
  readonly environment: Environment;
  readonly registry: NpmRegistrySource;
}

interface ReleasePackages {
  readonly npm: string;
  readonly packagist: string;
  readonly reference: string;
  readonly skippedNames: readonly string[];
}

const PACKAGES = {
  npm: '',
  packagist: '',
  reference: 'release/1.2.3',
  skippedNames: [],
};

const NO_DELAYS = [
  0,
  0,
];

const PACKAGIST_CREDENTIALS = {
  PACKAGIST_TOKEN: 'secret',
  PACKAGIST_USERNAME: 'acme',
};

const serveKnownPaths = (knownPaths: readonly string[]): string => serveNpmRegistry(
  (pathname) => knownPaths.includes(pathname),
);

/**
 * @rejects {Error}
 */
const createContext = async (environment: Environment, registryUrl: string): Promise<CheckContext> => {
  const clone = await createClone();

  return {
    directory: clone.work,
    environment: {
      ...GIT_ENVIRONMENT,
      ...environment,
    },
    registry: {
      retryDelaysMilliseconds: NO_DELAYS,
      url: registryUrl,
    },
  };
};

/**
 * @rejects {Error}
 */
const runCheck = async (packages: ReleasePackages, context: CheckContext): Promise<string[]> => {
  const standardErrorWrites = captureWrites(process.stderr);

  const argv = [
    `--npm=${packages.npm}`,
    `--packagist=${packages.packagist}`,
    `--reference=${packages.reference}`,
    `--skip=${JSON.stringify(packages.skippedNames)}`,
  ];

  await main(
    argv,
    context.environment,
    context.directory,
    context.registry,
  );

  return standardErrorWrites
    .join('')
    .split('\n')
    .filter((line) => line !== '');
};

describe('a release check', () => {
  it.each([
    {
      reference: 'dev/1.2',
    },
    {
      reference: 'main',
    },
  ])('passes $reference, which releases nothing', async (scenario) => {
    const context = await createContext({}, serveKnownPaths([]));

    const packages = {
      ...PACKAGES,
      packagist: 'acme/user',
      reference: scenario.reference,
    };

    await expect(runCheck(packages, context)).resolves.toStrictEqual([]);
  });

  it.each([
    {
      name: 'asks for the npm token of a package npm does not know yet',
      environment: {},
      knownPaths: [],
      issues: [
        'Unable to release "1.2.3":',
        'The first npm release of "@acme/user" requires "NPM_CONFIG_TOKEN".',
      ],
    },
    {
      name: 'refuses the npm token of a package npm knows',
      environment: {
        NPM_CONFIG_TOKEN: 'secret',
      },
      knownPaths: ['/@acme/user'],
      issues: [
        'Unable to release "1.2.3":',
        'Package "@acme/user" already exists on npm. Remove "NPM_CONFIG_TOKEN" to publish from this workflow.',
      ],
    },
    {
      name: 'passes a version npm already has, whatever the token',
      environment: {
        NPM_CONFIG_TOKEN: 'secret',
      },
      knownPaths: [
        '/@acme/user',
        '/@acme/user/1.2.3',
      ],
      issues: [],
    },
  ])('$name', async (scenario) => {
    const context = await createContext(scenario.environment, serveKnownPaths(scenario.knownPaths));

    const packages = {
      ...PACKAGES,
      npm: '@acme/user',
    };

    await expect(runCheck(packages, context)).resolves.toStrictEqual(scenario.issues);
  });

  it.each([
    {
      name: 'asks for the Packagist credentials that are missing',
      environment: {
        PACKAGIST_USERNAME: 'acme',
      },
      issues: [
        'Unable to release "1.2.3":',
        'Packagist requires "PACKAGIST_USERNAME" and "PACKAGIST_TOKEN" for "acme/user".',
      ],
    },
    {
      name: 'passes a Packagist package with both credentials',
      environment: PACKAGIST_CREDENTIALS,
      issues: [],
    },
  ])('$name', async (scenario) => {
    const context = await createContext(scenario.environment, serveKnownPaths([]));

    const packages = {
      ...PACKAGES,
      packagist: 'acme/user',
    };

    await expect(runCheck(packages, context)).resolves.toStrictEqual(scenario.issues);
  });

  it.each([
    {
      name: 'the npm job',
      skippedNames: ['npm'],
      issues: [
        'Unable to release "1.2.3":',
        'Packagist requires "PACKAGIST_USERNAME" and "PACKAGIST_TOKEN" for "acme/user".',
      ],
    },
    {
      name: 'the Packagist job',
      skippedNames: ['packagist'],
      issues: [
        'Unable to release "1.2.3":',
        'The first npm release of "@acme/user" requires "NPM_CONFIG_TOKEN".',
      ],
    },
    {
      name: 'the publish group',
      skippedNames: ['publish'],
      issues: [],
    },
  ])('leaves out the secrets of $name where it is skipped', async (scenario) => {
    const context = await createContext({}, serveKnownPaths([]));

    const packages = {
      ...PACKAGES,
      npm: '@acme/user',
      packagist: 'acme/user',
      skippedNames: scenario.skippedNames,
    };

    await expect(runCheck(packages, context)).resolves.toStrictEqual(scenario.issues);
  });

  it('fails, naming the registry, where npm is unreachable', async () => {
    const unreachableUrl = await createUnreachableUrl();
    const context = await createContext({}, unreachableUrl);

    const packages = {
      ...PACKAGES,
      npm: '@acme/user',
    };

    await expect(runCheck(packages, context)).rejects.toThrow(`Unable to reach "${unreachableUrl}": `);
  });

  it('fails, naming the address, where npm keeps failing', async () => {
    const registryUrl = serve(() => new Response(undefined, {
      status: STATUS_CODE.SERVICE_UNAVAILABLE,
    })).origin;

    const context = await createContext({}, registryUrl);

    const packages = {
      ...PACKAGES,
      npm: '@acme/user',
    };

    await expect(runCheck(packages, context))
      .rejects
      .toThrow(`Request to "${registryUrl}/@acme/user/1.2.3" failed with status 503.`);
  });

  it('passes a branch that contains the release below it', async () => {
    const context = await createContext({}, serveKnownPaths([]));

    await git(context.directory, 'tag v1.2.2');
    await commit(context.directory, 'changelog.md', '1.2.3');

    await expect(runCheck(PACKAGES, context)).resolves.toStrictEqual([]);
  });

  it('refuses a branch that misses the release below it', async () => {
    const context = await createContext({}, serveKnownPaths([]));

    await commit(context.directory, 'changelog.md', '1.2.2');
    await git(context.directory, 'tag v1.2.2');
    await git(context.directory, 'reset --quiet --hard HEAD~1');

    await expect(runCheck(PACKAGES, context)).resolves.toStrictEqual([
      'Unable to release "1.2.3":',
      'Branch "release/1.2.3" does not contain the previous release "v1.2.2".',
    ]);
  });
});

describe('the check-release script', () => {
  it('passes a release that is ready', async () => {
    const context = await createContext(PACKAGIST_CREDENTIALS, serveKnownPaths([]));

    const argv = [
      '--packagist=acme/user',
      '--reference=release/1.2.3',
    ];

    await expect(main(
      argv,
      context.environment,
      context.directory,
      context.registry,
    )).resolves.toBe(0);
  });

  it('fails and prints every issue of a release that is not', async () => {
    const context = await createContext({}, serveKnownPaths([]));
    const standardErrorWrites = captureWrites(process.stderr);

    const argv = [
      '--npm=@acme/user',
      '--packagist=acme/user',
      '--reference=release/1.2.3',
    ];

    await expect(main(
      argv,
      context.environment,
      context.directory,
      context.registry,
    )).resolves.toBe(1);

    expect(standardErrorWrites).toStrictEqual([
      [
        'Unable to release "1.2.3":',
        'Packagist requires "PACKAGIST_USERNAME" and "PACKAGIST_TOKEN" for "acme/user".',
        'The first npm release of "@acme/user" requires "NPM_CONFIG_TOKEN".',
        '',
      ].join('\n'),
    ]);
  });

  it('fails, naming it, for a skip name it does not know', async () => {
    const context = await createContext(PACKAGIST_CREDENTIALS, serveKnownPaths([]));

    const argv = [
      '--reference=release/1.2.3',
      '--skip=["npm","lint"]',
    ];

    await expect(main(
      argv,
      context.environment,
      context.directory,
      context.registry,
    )).rejects.toThrow('Unknown skip name "lint".');
  });
});
