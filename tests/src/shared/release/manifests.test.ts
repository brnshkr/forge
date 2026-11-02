import { describe, expect, it } from 'vitest';

import {
  findManifestIssues,
  findSecretIssues,
  readManifests,
  readPackageTargets,
} from '#src/shared/release/manifests';

import { createDirectory } from '#tests/support/directory';
import { writeFiles } from '#tests/support/repository';

const USER_PACKAGE = {
  description: 'Users',
  homepage: 'https://example.com/acme/user',
  license: 'MIT',
  name: 'acme/user',
};

describe('the secrets a release needs', () => {
  it.each([
    {
      name: 'a first npm release without a token',
      state: {
        hasNpmToken: false,
        npmState: <const>'new',
      },
      issues: ['The first npm release of "@acme/user" requires "NPM_CONFIG_TOKEN".'],
    },
    {
      name: 'a known npm package with a leftover token',
      state: {
        hasNpmToken: true,
        npmState: <const>'known',
      },
      issues: ['Package "@acme/user" already exists on npm. Remove "NPM_CONFIG_TOKEN" to publish from this workflow.'],
    },
    {
      name: 'a rerun after npm published',
      state: {
        hasNpmToken: true,
        npmState: <const>'published',
      },
      issues: [],
    },
  ])('are refused for $name', (scenario) => {
    expect(findSecretIssues({
      ...scenario.state,
      hasPackagistCredentials: true,
      npm: '@acme/user',
      packagist: 'acme/user',
    })).toStrictEqual(scenario.issues);
  });

  it('include Packagist credentials for a Composer package', () => {
    expect(findSecretIssues({
      hasNpmToken: false,
      hasPackagistCredentials: false,
      npm: '',
      npmState: 'new',
      packagist: 'acme/user',
    })).toStrictEqual(['Packagist requires "PACKAGIST_USERNAME" and "PACKAGIST_TOKEN" for "acme/user".']);
  });
});

describe('the manifests of a release', () => {
  it.each([
    {
      name: 'one manifest at the development version',
      manifests: {
        composer: undefined,
        npm: {
          version: '0.0.0-dev',
        },
      },
      issues: [],
    },
    {
      name: 'two manifests of one package',
      manifests: {
        composer: USER_PACKAGE,
        npm: {
          ...USER_PACKAGE,
          name: '@acme/user',
        },
      },
      issues: [],
    },
    {
      name: 'manifests naming a release',
      manifests: {
        composer: {
          ...USER_PACKAGE,
          version: '1.0.0',
        },
        npm: {
          ...USER_PACKAGE,
          name: '@acme/user',
        },
      },
      issues: ['Version in "composer.json" must be "0.0.0-dev", "1.0.0" given.'],
    },
    {
      name: 'manifests that disagree',
      manifests: {
        composer: USER_PACKAGE,
        npm: {
          ...USER_PACKAGE,
          description: 'Emails',
          name: '@acme/email',
        },
      },
      issues: [
        'Field "description" differs between "composer.json" and "package.json".',
        'Name in "package.json" must be "@" followed by the name in "composer.json".',
      ],
    },
  ])('report the issues of $name', (scenario) => {
    expect(findManifestIssues(scenario.manifests)).toStrictEqual(scenario.issues);
  });

  it('read a missing one as none and refuse one that holds no JSON', async () => {
    const validDirectory = await createDirectory('forge-manifests-');
    const brokenDirectory = await createDirectory('forge-manifests-');

    await writeFiles(validDirectory, {
      'package.json': '{"version": "1.0.0"}',
    });

    await writeFiles(brokenDirectory, {
      'composer.json': '{"version": ',
    });

    await expect(readManifests(validDirectory)).resolves.toStrictEqual({
      composer: undefined,
      npm: {
        version: '1.0.0',
      },
    });

    await expect(readManifests(brokenDirectory)).rejects.toThrow(SyntaxError);
  });

  it.each([
    {
      name: 'a library',
      composer: {
        name: 'acme/user',
      },
      npm: {
        name: '@acme/user',
      },
      packages: {
        npm: '@acme/user',
        packagist: 'acme/user',
      },
    },
    {
      name: 'a private package',
      composer: undefined,
      npm: {
        name: '@acme/shop',
        private: true,
      },
      packages: {
        npm: '',
        packagist: '',
      },
    },
    {
      name: 'a Composer project',
      composer: {
        name: 'acme/shop',
        type: 'project',
      },
      npm: undefined,
      packages: {
        npm: '',
        packagist: '',
      },
    },
  ])('name the packages $name publishes', (scenario) => {
    expect(readPackageTargets({
      composer: scenario.composer,
      npm: scenario.npm,
    })).toStrictEqual(scenario.packages);
  });
});
