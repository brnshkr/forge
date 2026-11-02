import { createHash } from 'node:crypto';

import { fetchJson, fetchOk, REGISTRIES } from '#src/shared/registry';

import {
  getBumpLevel,
  getLatestVersion,
  getVersionsWithMinors,
  readPinValue,
} from '#src/shared/tools/versions';

import { objectEntries, objectFromEntries } from '#src/shared/utils/object';

import type { Registries } from '#src/shared/registry';
import type { PinName, Versions } from '#src/shared/tools/versions';

export interface VersionSources {
  readonly dockerHubUrl: string;
  readonly gitHubApiUrl: string;
  readonly gitHubUrl: string;
  readonly registries: Registries;
}

export interface SourceContext {
  readonly gitHubToken?: string;
  readonly sources: VersionSources;
}

interface GitHubRelease {
  // eslint-disable-next-line ts/naming-convention -- GitHub names the field like this
  readonly tag_name: string;
}

interface DockerHubTag {
  readonly name: string;
}

interface DockerHubTagPage {
  readonly results: readonly DockerHubTag[];
}

export const VERSION_SOURCES = <const>{
  dockerHubUrl: 'https://hub.docker.com',
  gitHubApiUrl: 'https://api.github.com',
  gitHubUrl: 'https://github.com',
  registries: REGISTRIES,
} satisfies VersionSources;

const PAGE_SIZE = 100;

export const GITHUB_REPOSITORIES = <const>{
  ACTIONLINT_VERSION: 'rhysd/actionlint',
  BUILDKIT_VERSION: 'moby/buildkit',
  BUN_VERSION: 'oven-sh/bun',
  COMPOSER_VERSION: 'composer/composer',
  FRANKENPHP_VERSION: 'dunglas/frankenphp',
  GITLEAKS_VERSION: 'gitleaks/gitleaks',
  HADOLINT_VERSION: 'hadolint/hadolint',
  NODE_VERSION: 'nodejs/node',
  OSV_SCANNER_VERSION: 'google/osv-scanner',
  PHP_EXTENSION_INSTALLER_VERSION: 'mlocati/docker-php-extension-installer',
  SEMGREP_VERSION: 'semgrep/semgrep',
  SHELLCHECK_VERSION: 'koalaman/shellcheck',
} satisfies Partial<Record<PinName, string>>;

/**
 * @rejects {Error}
 */
const fetchGitHubVersions = async (repository: string, context: SourceContext): Promise<string[]> => {
  const releases = <GitHubRelease[]>(await fetchJson(
    `${context.sources.gitHubApiUrl}/repos/${repository}/releases?per_page=${String(PAGE_SIZE)}`,
    {
      headers: context.gitHubToken === undefined
        ? []
        : [['Authorization', `Bearer ${context.gitHubToken}`]],
    },
  ));

  return releases.map((release) => release.tag_name.replace(/^(?:bun-)?v/v, ''));
};

/**
 * @rejects {Error}
 */
const fetchPhpVersions = async (suite: string, context: SourceContext): Promise<string[]> => {
  const tagPage = <DockerHubTagPage>(await fetchJson(
    `${context.sources.dockerHubUrl}/v2/repositories/library/php/tags?page_size=${String(PAGE_SIZE)}&name=cli-${suite}`,
  ));

  return tagPage.results.map((tag) => tag.name.replace(`-cli-${suite}`, ''));
};

/**
 * @rejects {Error}
 */
export const fetchChecksum = async (assetPath: string, context: SourceContext): Promise<string> => {
  const response = await fetchOk(`${context.sources.gitHubUrl}/${assetPath}`);
  const hash = createHash('sha256').update(new Uint8Array(await response.arrayBuffer()));

  return `sha256:${hash.digest('hex')}`;
};

/**
 * @rejects {Error}
 */
export const resolveVersions = async (pinnedVersions: Versions, context: SourceContext): Promise<Versions> => {
  const versionFetches = [
    <const>['PHP_VERSION', fetchPhpVersions(pinnedVersions.DEBIAN_SUITE, context)],
    ...objectEntries(GITHUB_REPOSITORIES).map(([name, repository]) => <const>[
      name,
      fetchGitHubVersions(repository, context),
    ]),
  ];

  const latestVersionEntries = await Promise.all(versionFetches.map(async ([name, versionFetch]) => <const>[
    name,
    await getLatestVersion(readPinValue(pinnedVersions, name), await versionFetch, getBumpLevel(name)),
  ]));

  return getVersionsWithMinors({
    ...pinnedVersions,
    ...objectFromEntries(latestVersionEntries),
  });
};
