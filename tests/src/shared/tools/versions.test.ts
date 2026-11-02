import { describe, expect, it } from 'vitest';

import {
  createUpstreamReferences,
  getLatestVersion,
  getVersionName,
  parseVersions,
  PIN_NAMES,
  readUpstreamReference,
} from '#src/shared/tools/versions';

import { objectKeys } from '#src/shared/utils/object';
import { createDigest } from '#tests/support/digest';
import { toReference } from '#tests/support/dotenv';
import { createVersions } from '#tests/support/versions';

import type { Versions } from '#src/shared/tools/versions';

const VERSIONS = createVersions(createDigest('a'), createDigest('b'));

describe('the pins .env holds', () => {
  it.each([
    {
      name: 'DEBIAN_SUITE',
      value: 'Acme',
      expectation: 'a Debian suite name',
    },
    {
      name: 'DEBIAN_SUITE',
      value: 'acme-backports',
      expectation: 'a Debian suite name',
    },
    {
      name: 'PHP_VERSION',
      value: '1.0',
      expectation: 'an exact version',
    },
    {
      name: 'PHP_VERSION',
      value: '1.0.0-rc1',
      expectation: 'an exact version',
    },
    {
      name: 'PHP_MINOR',
      value: '1.1',
      expectation: 'the minor of "PHP_VERSION"',
    },
    {
      name: 'BUN_DIGEST',
      value: 'sha256:abc',
      expectation: 'a sha256 digest',
    },
    {
      name: 'HADOLINT_CHECKSUM',
      value: '',
      expectation: 'a sha256 digest',
    },
  ])('refuse $name=$value', async (scenario) => {
    await expect(parseVersions({
      ...VERSIONS,
      [scenario.name]: scenario.value,
    })).rejects.toThrow(
      `Variable "${scenario.name}" in ".env" must be ${scenario.expectation}, "${scenario.value}" given.`,
    );
  });

  it.each(PIN_NAMES.map((name) => ({
    name,
  })))('refuse a missing $name', async (scenario) => {
    await expect(parseVersions({
      ...VERSIONS,
      [scenario.name]: undefined,
    })).rejects.toThrow(`Variable "${scenario.name}" not found in ".env".`);
  });

  it('resolve a pin composed from another', async () => {
    const composed = <const>{
      ...VERSIONS,
      PHP_VERSION: `${toReference('PHP_MINOR')}.1`,
    } satisfies Versions;

    await expect(parseVersions(composed)).resolves.toMatchObject({
      PHP_VERSION: '1.0.1',
    });
  });

  it('keep only the pins', async () => {
    const pinnedVersions = await parseVersions({
      ...VERSIONS,
      COMPOSE_PROJECT_NAME: 'acme',
    });

    expect(objectKeys(pinnedVersions)).toStrictEqual(PIN_NAMES);
  });

  it.each(<const>[
    {
      name: 'BUN_MINOR',
      versionName: 'BUN_VERSION',
    },
    {
      name: 'HADOLINT_CHECKSUM',
      versionName: 'HADOLINT_VERSION',
    },
    {
      name: 'NODE_DIGEST',
      versionName: 'NODE_VERSION',
    },
    {
      name: 'NODE_VERSION',
      versionName: 'NODE_VERSION',
    },
  ])('name the version $name derives from', (scenario) => {
    expect(getVersionName(scenario.name)).toBe(scenario.versionName);
  });
});

describe('the newest version a bump picks', () => {
  it.each(<const>[
    {
      name: 'the highest patch, compared numerically',
      level: 'patch',
      available: [
        '1.0.7',
        '1.0.10',
        '1.0.9',
      ],
      latestVersion: '1.0.10',
    },
    {
      name: 'no newer minor on a patch bump',
      level: 'patch',
      available: ['1.1.0'],
      latestVersion: '1.0.9',
    },
    {
      name: 'the highest patch of the highest minor on a minor bump',
      level: 'minor',
      available: [
        '1.1.0',
        '1.1.3',
        '1.2.0',
      ],
      latestVersion: '1.2.0',
    },
    {
      name: 'no major on a minor bump',
      level: 'minor',
      available: ['2.0.0'],
      latestVersion: '1.0.9',
    },
    {
      name: 'nothing that is no exact version',
      level: 'patch',
      available: [
        '1.0.10RC1',
        '1.0.10-beta.1',
        'latest',
      ],
      latestVersion: '1.0.9',
    },
  ])('is $name', async (scenario) => {
    await expect(getLatestVersion('1.0.9', scenario.available, scenario.level)).resolves.toBe(scenario.latestVersion);
  });

  it('is only the highest patch of a zero major, even on a minor bump', async () => {
    const available = [
      '0.11.1',
      '0.12.0',
      '1.0.0',
    ];

    await expect(getLatestVersion('0.11.0', available, 'minor')).resolves.toBe('0.11.1');
  });

  it('refuses a current version that is no exact version', async () => {
    await expect(getLatestVersion('1.0', [], 'patch'))
      .rejects
      .toThrow('Version must be exact, "1.0" given.');
  });
});

describe('the upstream images forge pins', () => {
  it('take FrankenPHP by the PHP minor, so a PHP patch bump cannot outrun its publishing', () => {
    const versionsWithNewPatch = <const>{
      ...VERSIONS,
      PHP_VERSION: '1.0.999',
    } satisfies Versions;

    const versionsWithNewMinor = <const>{
      ...VERSIONS,
      PHP_MINOR: '1.1',
      PHP_VERSION: '1.1.0',
    } satisfies Versions;

    expect(createUpstreamReferences(versionsWithNewPatch).FRANKENPHP_DIGEST).toStrictEqual(
      createUpstreamReferences(VERSIONS).FRANKENPHP_DIGEST,
    );

    expect(createUpstreamReferences(versionsWithNewMinor).FRANKENPHP_DIGEST.tag).toContain('-php1.1-');
  });

  it.each(<const>[
    {
      image: 'FRANKENPHP_DIGEST',
    },
    {
      image: 'NODE_DIGEST',
    },
    {
      image: 'PHP_DIGEST',
    },
  ])('take $image from the Debian suite .env pins', (scenario) => {
    expect(readUpstreamReference(VERSIONS, scenario.image).tag).toContain(VERSIONS.DEBIAN_SUITE);
  });
});
