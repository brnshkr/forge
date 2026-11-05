import { describe, expect, it } from 'vitest';

import { GHCR } from '#src/shared/registry';

import {
  createGitTags,
  createImageTags,
  createWidestImageTag,
  findNewestRelease,
  findPredecessorTag,
  formatVersion,
  getDistributionTag,
  parseBranchVersion,
  readFragmentFiles,
} from '#src/shared/release/versions';

import { createRepository } from '#tests/support/repository';

import type { ReleaseVersion } from '#src/shared/release/versions';

const IMAGE = `${GHCR}/acme/user`;

const RELEASE = <const>{
  kind: 'release',
  major: 1,
  minor: 2,
  patch: 3,
} satisfies ReleaseVersion;

const PRERELEASE = <const>{
  ...RELEASE,
  prerelease: 'rc.1',
} satisfies ReleaseVersion;

const TAGS = [
  'v1',
  'v1.2',
  'v1.1.1',
  'v1.2.0',
  'v1.2.2',
  'v1.2.3-beta.2',
  'v1.2.3-rc.1',
  'v2.0.0-alpha',
];

describe('the version a branch names', () => {
  it.each([
    {
      reference: 'dev/1.2',
      version: {
        kind: 'dev',
        major: 1,
        minor: 2,
      },
    },
    {
      reference: 'dev/1.x',
      version: {
        kind: 'dev',
        major: 1,
      },
    },
    {
      reference: 'refs/heads/release/1.2.3',
      version: RELEASE,
    },
    {
      reference: 'release/1.2.3-rc.1',
      version: PRERELEASE,
    },
  ])('is read from $reference', async (scenario) => {
    await expect(parseBranchVersion(scenario.reference)).resolves.toStrictEqual(scenario.version);
  });

  it.each([
    {
      prerelease: 'alpha',
    },
    {
      prerelease: 'alpha.1',
    },
    {
      prerelease: 'beta.2',
    },
    {
      prerelease: 'rc.1',
    },
  ])('accepts the prerelease $prerelease', async (scenario) => {
    await expect(parseBranchVersion(`release/1.2.3-${scenario.prerelease}`)).resolves.toMatchObject({
      prerelease: scenario.prerelease,
    });
  });

  it.each([
    {
      reference: '',
    },
    {
      reference: 'master',
    },
    {
      reference: 'Dev/1.2',
    },
    {
      reference: 'feature/add-diagrams',
    },
    {
      reference: 'refs/tags/v1.2.3',
    },
    {
      reference: 'prefixdev/1.2',
    },
  ])('is none for $reference', async (scenario) => {
    await expect(parseBranchVersion(scenario.reference)).resolves.toBeUndefined();
  });

  it.each([
    {
      reference: 'dev/1',
    },
    {
      reference: 'dev/1.2.3',
    },
    {
      reference: 'dev/01.2',
    },
    {
      reference: 'dev/v1.2',
    },
    {
      reference: 'dev/1.2-rc.1',
    },
    {
      reference: 'dev/1.X',
    },
    {
      reference: 'dev/x.2',
    },
    {
      reference: 'release/1.2',
    },
    {
      reference: 'release/1.2.03',
    },
    {
      reference: 'release/1.2.3/hotfix',
    },
    {
      reference: 'release/1.2.3-',
    },
    {
      reference: 'release/1.2.3-rc1',
    },
    {
      reference: 'release/1.2.3-rc.01',
    },
    {
      reference: 'release/1.2.3-snapshot',
    },
    {
      reference: 'release/1.2.3+build',
    },
  ])('refuses $reference', async (scenario) => {
    await expect(parseBranchVersion(scenario.reference))
      .rejects
      .toThrow(`Invalid branch "${scenario.reference}". Expected "release/<version>" or "dev/<major>.<minor>".`);
  });

  it.each([
    {
      version: RELEASE,
      formattedVersion: '1.2.3',
    },
    {
      version: PRERELEASE,
      formattedVersion: '1.2.3-rc.1',
    },
  ])('is written as $formattedVersion', (scenario) => {
    expect(formatVersion(scenario.version)).toBe(scenario.formattedVersion);
  });
});

describe('the release a release must contain', () => {
  it.each([
    {
      version: RELEASE,
      predecessor: 'v1.2.3-rc.1',
    },
    {
      version: PRERELEASE,
      predecessor: 'v1.2.3-beta.2',
    },
    {
      version: {
        ...RELEASE,
        prerelease: 'rc.2',
      },
      predecessor: 'v1.2.3-rc.1',
    },
    {
      version: {
        ...RELEASE,
        minor: 1,
        patch: 2,
      },
      predecessor: 'v1.1.1',
    },
    {
      version: {
        ...RELEASE,
        major: 2,
      },
      predecessor: 'v2.0.0-alpha',
    },
  ])('is the highest version tag below $version.major.$version.minor.$version.patch', async (scenario) => {
    await expect(findPredecessorTag(scenario.version, TAGS)).resolves.toBe(scenario.predecessor);
  });

  it.each([
    {
      name: 'a release above each of its prereleases',
      version: PRERELEASE,
      tags: [
        'v1.2.3',
        'v1.2.2',
      ],
      predecessor: 'v1.2.2',
    },
    {
      name: 'a numbered prerelease above its bare word',
      version: {
        ...RELEASE,
        prerelease: 'alpha.1',
      },
      tags: ['v1.2.3-alpha'],
      predecessor: 'v1.2.3-alpha',
    },
    {
      name: 'a bare word below its numbered prerelease',
      version: {
        ...RELEASE,
        prerelease: 'alpha',
      },
      tags: ['v1.2.3-alpha.1'],
      predecessor: undefined,
    },
  ])('ranks $name', async (scenario) => {
    await expect(findPredecessorTag(scenario.version, scenario.tags)).resolves.toBe(scenario.predecessor);
  });

  it('is none for the first release', async () => {
    const firstRelease = <const>{
      ...RELEASE,
      minor: 0,
      patch: 0,
    } satisfies ReleaseVersion;

    await expect(findPredecessorTag(firstRelease, TAGS)).resolves.toBeUndefined();
  });
});

describe('the newest release of a repository', () => {
  it.each([
    {
      name: 'is its newest stable release, whatever prerelease follows it',
      tags: [
        'v1',
        'v1.2.2',
        'v1.2.3',
        'v1.3.0-rc.1',
        '',
      ],
      version: RELEASE,
    },
    {
      name: 'is its newest prerelease where it has no stable release',
      tags: [
        'v1.2.3-beta.2',
        'v1.2.3-rc.1',
      ],
      version: PRERELEASE,
    },
    {
      name: 'is none where it has no version tag',
      tags: [
        'v1',
        '',
      ],
      version: undefined,
    },
  ])('$name', async (scenario) => {
    await expect(findNewestRelease(scenario.tags)).resolves.toStrictEqual(scenario.version);
  });
});

describe('the tags a release takes', () => {
  it('move the major and minor and add every alias, each with the suffix', () => {
    expect(createImageTags({
      aliases: ['php8.5-bun1.4'],
      image: IMAGE,
      suffix: '-chromium',
      version: RELEASE,
    })).toStrictEqual([
      `${IMAGE}:1-chromium`,
      `${IMAGE}:1.2-chromium`,
      `${IMAGE}:1.2.3-chromium`,
      `${IMAGE}:php8.5-bun1.4-chromium`,
    ]);

    expect(createGitTags({
      isPackagistPackage: false,
      version: RELEASE,
    })).toStrictEqual([
      'v1',
      'v1.2',
      'v1.2.3',
    ]);
  });

  it('keep the git tags of a Composer package to the full version, which Composer would read as versions', () => {
    expect(createGitTags({
      isPackagistPackage: true,
      version: RELEASE,
    })).toStrictEqual(['v1.2.3']);

    expect(createGitTags({
      isPackagistPackage: true,
      version: {
        ...RELEASE,
        major: 0,
      },
    })).toStrictEqual(['v0.2.3']);
  });

  it('leave what an earlier release points at alone for a prerelease', () => {
    expect(createImageTags({
      aliases: ['php8.5-bun1.4'],
      image: IMAGE,
      suffix: '-chromium',
      version: PRERELEASE,
    })).toStrictEqual([`${IMAGE}:1.2.3-rc.1-chromium`]);

    expect(createGitTags({
      isPackagistPackage: false,
      version: PRERELEASE,
    })).toStrictEqual(['v1.2.3-rc.1']);
  });

  it('stop at the minor below 1.0.0, where a minor may break', () => {
    expect(createGitTags({
      isPackagistPackage: false,
      version: {
        ...RELEASE,
        major: 0,
      },
    })).toStrictEqual([
      'v0.2',
      'v0.2.3',
    ]);
  });

  it.each([
    {
      name: 'the major of a release',
      version: RELEASE,
      tag: `${IMAGE}:1-chromium`,
    },
    {
      name: 'the minor of a release below 1.0.0',
      version: {
        ...RELEASE,
        major: 0,
      },
      tag: `${IMAGE}:0.2-chromium`,
    },
    {
      name: 'the full version of a prerelease',
      version: PRERELEASE,
      tag: `${IMAGE}:1.2.3-rc.1-chromium`,
    },
  ])('are widest at $name', (scenario) => {
    expect(createWidestImageTag({
      image: IMAGE,
      suffix: '-chromium',
      version: scenario.version,
    })).toBe(scenario.tag);
  });

  it.each([
    {
      prerelease: undefined,
      distributionTag: 'latest',
    },
    {
      prerelease: 'alpha',
      distributionTag: 'alpha',
    },
    {
      prerelease: 'beta.2',
      distributionTag: 'beta',
    },
  ])('publish to npm under $distributionTag', (scenario) => {
    expect(getDistributionTag({
      ...RELEASE,
      prerelease: scenario.prerelease,
    })).toBe(scenario.distributionTag);
  });
});

describe('the fragments of a release', () => {
  it('are those of the config directory and the root that run an image, not a base they extend', async () => {
    const directory = await createRepository({
      'compose/base.yaml': 'services:\n  base:\n    read_only: true\n',
      'compose/user.yaml': 'services:\n  user:\n    image: acme/user\n',
      'compose/user.yml': 'services:\n  user:\n    image: acme/user\n',
      'conf/compose/email.yaml': 'services:\n  email:\n    image: acme/email\n',
    });

    await expect(readFragmentFiles(directory)).resolves.toStrictEqual([
      'conf/compose/email.yaml',
      'compose/user.yaml',
    ]);
  });
});
