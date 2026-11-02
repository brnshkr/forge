import path from 'node:path';

import { FORGE_DIRECTORY, resolveReferences } from '#src/shared/make';
import { DIGEST_SOURCE } from '#src/shared/pins/digests';
import { ENVIRONMENT_FILE } from '#src/shared/pins/dotenv';
import { compareNumbers, readVersionNumbers } from '#src/shared/pins/version-tags';
import { DOCKER_HUB, GHCR } from '#src/shared/registry';
import { createExactVersionPattern } from '#src/shared/release/versions';
import { readOwnValue, writeOwnValue } from '#src/shared/utils/object';
import { compileLinearPattern } from '#src/shared/utils/pattern';
import { before } from '#src/shared/utils/string';

import type { RegistryRepository } from '#src/shared/registry';
import type { StringRecord } from '#src/shared/types/core';

export const PIN_NAMES = <const>[
  'ACTIONLINT_CHECKSUM',
  'ACTIONLINT_VERSION',
  'BUILDKIT_DIGEST',
  'BUILDKIT_VERSION',
  'BUN_DIGEST',
  'BUN_MINOR',
  'BUN_VERSION',
  'COMPOSER_VERSION',
  'DEBIAN_SUITE',
  'FRANKENPHP_DIGEST',
  'FRANKENPHP_VERSION',
  'GITLEAKS_DIGEST',
  'GITLEAKS_VERSION',
  'HADOLINT_CHECKSUM',
  'HADOLINT_VERSION',
  'NODE_DIGEST',
  'NODE_VERSION',
  'OSV_SCANNER_DIGEST',
  'OSV_SCANNER_VERSION',
  'PHP_DIGEST',
  'PHP_EXTENSION_INSTALLER_DIGEST',
  'PHP_EXTENSION_INSTALLER_VERSION',
  'PHP_MINOR',
  'PHP_VERSION',
  'SEMGREP_DIGEST',
  'SEMGREP_VERSION',
  'SHELLCHECK_CHECKSUM',
  'SHELLCHECK_VERSION',
];

export type PinName = typeof PIN_NAMES[number];
export type Versions = Readonly<Record<PinName, string>>;
export type BumpLevel = 'minor' | 'patch';
export type DigestName = Extract<PinName, `${string}_DIGEST`>;

export interface UpstreamReference extends RegistryRepository {
  readonly tag: string;
}

export const PINS_FILE = path.join(FORGE_DIRECTORY, ENVIRONMENT_FILE);

const MINOR_PART_COUNT = 2;
const createVersionSuffixPattern = (): RegExp => /_(?:CHECKSUM|DIGEST|MINOR)$/v;

const PATCH_ONLY_PINS = new Set<PinName>([
  'BUN_VERSION',
  'PHP_VERSION',
]);

/**
 * @throws {Error}
 */
export const readPinValue = (pinnedVersions: Versions, name: PinName): string => Reflect.get(pinnedVersions, name);
export const getBumpLevel = (name: PinName): BumpLevel => (PATCH_ONLY_PINS.has(name) ? 'patch' : 'minor');
export const getVersionName = (name: PinName): PinName => <PinName>name.replace(createVersionSuffixPattern(), '_VERSION');

const getMinorVersion = (version: string): string => version
  .split('.', MINOR_PART_COUNT)
  .join('.');

/**
 * @throws {Error}
 */
export const requireAssignment = (assignments: StringRecord, name: string): string => {
  const value = readOwnValue(assignments, name);

  if (value === undefined) {
    throw new Error(`Variable "${name}" not found in ".env".`);
  }

  return value;
};

/**
 * @throws {Error}
 */
const requireResolvedValue = (assignments: StringRecord, name: string): string => resolveReferences(
  requireAssignment(assignments, name),
  assignments,
);

/**
 * @throws {Error}
 */
const getPinExpectation = (
  name: PinName,
  value: string,
  assignments: StringRecord,
  exactVersionPattern: RegExp,
): string => {
  if (name === 'DEBIAN_SUITE') {
    return /^[a-z]+$/v.test(value) ? '' : 'a Debian suite name';
  }

  if (name.endsWith('_MINOR')) {
    const versionName = getVersionName(name);

    return value === getMinorVersion(requireResolvedValue(assignments, versionName))
      ? ''
      : `the minor of "${versionName}"`;
  }

  if (name.endsWith('_VERSION')) {
    return exactVersionPattern.test(value)
      ? ''
      : 'an exact version';
  }

  return compileLinearPattern(`^${DIGEST_SOURCE}$`, 'v').test(value)
    ? ''
    : 'a sha256 digest';
};

/**
 * @rejects {Error}
 */
export const parseVersions = async (assignments: StringRecord): Promise<Versions> => {
  const exactVersionPattern = await createExactVersionPattern();
  const pinValues: Partial<Record<PinName, string>> = {};

  for (const name of PIN_NAMES) {
    const value = requireResolvedValue(assignments, name);

    const pinExpectation = getPinExpectation(
      name,
      value,
      assignments,
      exactVersionPattern,
    );

    if (pinExpectation !== '') {
      throw new Error(`Variable "${name}" in ".env" must be ${pinExpectation}, "${value}" given.`);
    }

    writeOwnValue(pinValues, name, value);
  }

  return <Versions>pinValues;
};

/**
 * @rejects {Error}
 */
export const getLatestVersion = async (
  currentVersion: string,
  availableVersions: readonly string[],
  level: BumpLevel,
): Promise<string> => {
  const exactVersionPattern = await createExactVersionPattern();
  const isExactVersion = (version: string): boolean => exactVersionPattern.test(version);

  if (!isExactVersion(currentVersion)) {
    throw new Error(`Version must be exact, "${currentVersion}" given.`);
  }

  const isPatchOnly = level === 'patch' || currentVersion.startsWith('0.');
  const versionPrefix = isPatchOnly ? getMinorVersion(currentVersion) : before(currentVersion, '.');
  let latestVersion = currentVersion;

  for (const candidateVersion of availableVersions) {
    const isNewerVersion = candidateVersion.startsWith(`${versionPrefix}.`)
      && isExactVersion(candidateVersion)
      && compareNumbers(readVersionNumbers(candidateVersion), readVersionNumbers(latestVersion)) > 0;

    if (isNewerVersion) {
      latestVersion = candidateVersion;
    }
  }

  return latestVersion;
};

export const createUpstreamReferences = (pinnedVersions: Versions): Record<DigestName, UpstreamReference> => ({
  BUILDKIT_DIGEST: {
    registry: DOCKER_HUB,
    repository: 'moby/buildkit',
    tag: `v${pinnedVersions.BUILDKIT_VERSION}`,
  },
  BUN_DIGEST: {
    registry: DOCKER_HUB,
    repository: 'oven/bun',
    tag: `${pinnedVersions.BUN_VERSION}-debian`,
  },
  FRANKENPHP_DIGEST: {
    registry: DOCKER_HUB,
    repository: 'dunglas/frankenphp',
    tag: `${pinnedVersions.FRANKENPHP_VERSION}-php${pinnedVersions.PHP_MINOR}-${pinnedVersions.DEBIAN_SUITE}`,
  },
  GITLEAKS_DIGEST: {
    registry: GHCR,
    repository: 'gitleaks/gitleaks',
    tag: `v${pinnedVersions.GITLEAKS_VERSION}`,
  },
  NODE_DIGEST: {
    registry: DOCKER_HUB,
    repository: 'library/node',
    tag: `${pinnedVersions.NODE_VERSION}-${pinnedVersions.DEBIAN_SUITE}`,
  },
  OSV_SCANNER_DIGEST: {
    registry: GHCR,
    repository: 'google/osv-scanner',
    tag: `v${pinnedVersions.OSV_SCANNER_VERSION}`,
  },
  PHP_DIGEST: {
    registry: DOCKER_HUB,
    repository: 'library/php',
    tag: `${pinnedVersions.PHP_VERSION}-cli-${pinnedVersions.DEBIAN_SUITE}`,
  },
  PHP_EXTENSION_INSTALLER_DIGEST: {
    registry: DOCKER_HUB,
    repository: 'mlocati/php-extension-installer',
    tag: pinnedVersions.PHP_EXTENSION_INSTALLER_VERSION,
  },
  SEMGREP_DIGEST: {
    registry: DOCKER_HUB,
    repository: 'semgrep/semgrep',
    tag: `${pinnedVersions.SEMGREP_VERSION}-nonroot`,
  },
});

export const readUpstreamReference = (pinnedVersions: Versions, name: DigestName): UpstreamReference => Reflect.get(
  createUpstreamReferences(pinnedVersions),
  name,
);

export const formatUpstreamReference = (upstreamReference: UpstreamReference, digest: string): string => {
  const imageName = `${upstreamReference.registry}/${upstreamReference.repository}`;

  return `${imageName}:${upstreamReference.tag}@${digest}`;
};

export const getVersionsWithMinors = (resolvedVersions: Versions): Versions => ({
  ...resolvedVersions,
  BUN_MINOR: getMinorVersion(resolvedVersions.BUN_VERSION),
  PHP_MINOR: getMinorVersion(resolvedVersions.PHP_VERSION),
});
