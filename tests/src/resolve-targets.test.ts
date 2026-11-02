import { describe, expect, it } from 'vitest';

import { main } from '#src/resolve-targets';
import { GHCR } from '#src/shared/registry';
import { objectFromEntries } from '#src/shared/utils/object';
import { captureWrites } from '#tests/support/output';
import { createRepository } from '#tests/support/repository';

const REPOSITORY_FILES = {
  '.env': '',
  '.env.prod': 'IMAGE_NAME=acme-user\nIMAGE_TARGET=prod\nIMAGE_ALIASES=latest\n',
  'compose/user.yaml': '',
  'composer.json': '{"name": "acme/user"}',
  'docker/acme-user.Dockerfile': 'FROM acme/base\n',
};

const IMAGE = {
  arguments: '',
  dockerfile: 'docker/acme-user.Dockerfile',
  name: 'acme-user',
  target: 'prod',
};

interface RefusedDeployScenario {
  readonly argument: string;
  readonly files: Readonly<Record<string, string>>;
  readonly message: string;
}

const readOutputs = (standardOutputWrites: readonly string[]): unknown => objectFromEntries(standardOutputWrites
  .join('')
  .trimEnd()
  .split('\n')
  .map((line) => {
    const separator = line.indexOf('=');

    return [line.slice(0, separator), JSON.parse(line.slice(separator + 1))];
  }));

describe('the resolve-targets script', () => {
  it('names every tag, merge target and package of a prerelease', async () => {
    const directory = await createRepository(REPOSITORY_FILES);
    const standardOutputWrites = captureWrites(process.stdout);

    const argv = [
      '--namespace=acme',
      '--reference=refs/heads/release/1.2.3-rc.1',
      `--registry=${GHCR}`,
    ];

    await expect(main(argv, directory)).resolves.toBe(0);

    expect(readOutputs(standardOutputWrites)).toStrictEqual({
      deploy: {},
      images: [{
        ...IMAGE,
        tags: `${GHCR}/acme/acme-user:1.2.3-rc.1`,
      }],
      release: {
        distributionTag: 'rc',
        fragments: 'compose/user.yaml',
        gitTags: 'v1.2.3-rc.1',
        isPrerelease: true,
        mergeTargets: 'dev/1.2 dev/1.x',
        npm: '',
        packagist: 'acme/user',
        version: '1.2.3-rc.1',
      },
      staging: [],
    });
  });

  it('keeps the git tags of a Composer package to the full version while its images move', async () => {
    const directory = await createRepository(REPOSITORY_FILES);
    const standardOutputWrites = captureWrites(process.stdout);

    const argv = [
      '--namespace=acme',
      '--reference=refs/heads/release/1.2.3',
      `--registry=${GHCR}`,
    ];

    await expect(main(argv, directory)).resolves.toBe(0);

    expect(readOutputs(standardOutputWrites)).toMatchObject({
      images: [{
        tags: [
          `${GHCR}/acme/acme-user:1`,
          `${GHCR}/acme/acme-user:1.2`,
          `${GHCR}/acme/acme-user:1.2.3`,
          `${GHCR}/acme/acme-user:latest`,
        ].join('\n'),
      }],
      release: {
        gitTags: 'v1.2.3',
        packagist: 'acme/user',
      },
    });
  });

  it('builds without tags on a branch that releases nothing', async () => {
    const directory = await createRepository(REPOSITORY_FILES);
    const standardOutputWrites = captureWrites(process.stdout);

    await expect(main(['--reference=refs/heads/dev/1.2'], directory)).resolves.toBe(0);

    expect(readOutputs(standardOutputWrites)).toStrictEqual({
      deploy: {},
      images: [{
        ...IMAGE,
        tags: '',
      }],
      release: {
        distributionTag: '',
        fragments: 'compose/user.yaml',
        gitTags: '',
        isPrerelease: false,
        mergeTargets: '',
        npm: '',
        packagist: 'acme/user',
        version: '',
      },
      staging: [],
    });
  });

  it.each([
    {
      deployTargets: '',
      deployedTargets: [
        'production',
        'qa',
        'staging',
      ],
      stagingTargets: [
        'qa',
        'staging',
      ],
    },
    {
      deployTargets: 'testing staging',
      deployedTargets: [
        'testing',
        'staging',
      ],
      stagingTargets: [
        'staging',
      ],
    },
  ])('deploys the image its stage names to $deployedTargets', async (scenario) => {
    const directory = await createRepository({
      ...REPOSITORY_FILES,
      '.env.production': 'DEPLOY_HOSTS=deploy@203.0.113.10\nDEPLOY_IMAGE=prod\n',
      '.env.qa': 'DEPLOY_HOSTS=deploy@203.0.113.30\nDEPLOY_IMAGE=prod\n',
      '.env.staging': 'DEPLOY_HOSTS="deploy@203.0.113.20 deploy@203.0.113.21"\nDEPLOY_IMAGE=prod\n',
      '.env.testing': 'DEPLOY_IMAGE=prod\n',
    });

    const standardOutputWrites = captureWrites(process.stdout);

    const argv = [
      `--deploy-targets=${scenario.deployTargets}`,
      '--namespace=acme',
      '--reference=refs/heads/dev/1.2',
      `--registry=${GHCR}`,
    ];

    await expect(main(argv, directory)).resolves.toBe(0);

    expect(readOutputs(standardOutputWrites)).toHaveProperty('deploy', objectFromEntries(scenario.deployedTargets.map(
      (target) => [
        target,
        {
          digestKey: 'acme-user-prod',
        },
      ],
    )));

    expect(readOutputs(standardOutputWrites)).toHaveProperty('staging', scenario.stagingTargets.map((target) => ({
      digestKey: 'acme-user-prod',
      target,
    })));
  });

  it.each<RefusedDeployScenario>([
    {
      argument: '--deploy-targets=qa',
      message: 'Unknown deploy target "qa".',
      files: {},
    },
    {
      argument: '--deploy-targets=',
      message: 'Stage "production" sets no "IMAGE_NAME", so "production" has no image to deploy.',
      files: {
        '.env.production': 'DEPLOY_HOSTS=deploy@203.0.113.10\n',
      },
    },
  ])('refuses a deploy target it cannot serve: $message', async (scenario) => {
    const directory = await createRepository({
      ...REPOSITORY_FILES,
      ...scenario.files,
    });

    const argv = [
      scenario.argument,
      '--namespace=acme',
      '--reference=refs/heads/dev/1.2',
      `--registry=${GHCR}`,
    ];

    await expect(main(argv, directory)).rejects.toThrow(scenario.message);
  });

  it('fails and prints why where the manifests are not ready for a release', async () => {
    const directory = await createRepository({
      ...REPOSITORY_FILES,
      'composer.json': '{"version": "1.0.0"}',
    });

    const standardErrorWrites = captureWrites(process.stderr);

    await expect(main([], directory)).resolves.toBe(1);

    expect(standardErrorWrites)
      .toStrictEqual(['Version in "composer.json" must be "0.0.0-dev", "1.0.0" given.\n']);
  });
});
