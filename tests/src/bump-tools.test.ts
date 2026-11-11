import { $, file } from 'bun';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { main } from '#src/bump-tools';
import { shortenDigest } from '#src/shared/pins/digests';
import { DOCKER_HUB } from '#src/shared/registry';
import { GITHUB_REPOSITORIES } from '#src/shared/tools/sources';
import { createUpstreamReferences, getVersionName, readUpstreamReference } from '#src/shared/tools/versions';
import { STATUS_CODE } from '#src/shared/utils/http';

import {
  objectEntries,
  objectFromEntries,
  objectKeys,
  objectValues,
  readOwnValue,
} from '#src/shared/utils/object';

import { createDigest } from '#tests/support/digest';
import { toReference } from '#tests/support/dotenv';
import { captureWrites } from '#tests/support/output';
import { createDigestResponse, serveRegistry } from '#tests/support/registry';
import { createRepository } from '#tests/support/repository';
import { readSeenReferences } from '#tests/support/seen';
import { serve } from '#tests/support/server';
import { createVersions } from '#tests/support/versions';

import type { VersionSources } from '#src/shared/tools/sources';

interface UpstreamAnswers {
  readonly gitHubVersions: ReadonlyMap<string, readonly string[]>;
  readonly phpVersions: readonly string[];
  readonly unpublishedTags?: ReadonlySet<string>;
}

interface FakeUpstream {
  readonly authorizations: string[];
  readonly sources: VersionSources;
}

const ASSET = 'acme';
const NO_AUTHORIZATION = 'no authorization';
const PHP_TAGS_PATH = '/v2/repositories/library/php/tags';
const RELEASES_SUFFIX = '/releases';
const REPOSITORIES_PREFIX = '/repos/';

const CHECKSUM = `sha256:${createHash('sha256')
  .update(ASSET)
  .digest('hex')}`;

const DIGEST = createDigest('a');
const STALE_PIN = createDigest('b');
const WEEK_MILLISECONDS = 604_800_000;

const NO_RELEASE_AGE = {
  MINIMUM_RELEASE_AGE: '0',
};

const createPinsText = (stalePins: Readonly<Record<string, string>>): string => objectEntries({
  ...createVersions(DIGEST, CHECKSUM),
  BUN_VERSION: `${toReference('BUN_MINOR')}.0`,
  PHP_VERSION: `${toReference('PHP_MINOR')}.0`,
  ...stalePins,
})
  .map(([name, value]) => `${name}=${value}\n`)
  .join('');

const listPublishedTags = (
  registryPath: string,
  releasesByRepository: ReadonlyMap<string, readonly string[]>,
  unpublishedTags: ReadonlySet<string>,
): string[] => {
  const repository = registryPath.slice('/v2/'.length, registryPath.indexOf('/tags/list'));
  const versions = createVersions(DIGEST, CHECKSUM);

  return objectKeys(createUpstreamReferences(versions))
    .filter((digestName) => readUpstreamReference(versions, digestName).repository === repository)
    .flatMap((digestName) => {
      const versionName = getVersionName(digestName);
      const releaseRepository = readOwnValue(<Readonly<Record<string, string>>>GITHUB_REPOSITORIES, versionName) ?? '';
      const releases = releasesByRepository.get(releaseRepository) ?? [];

      return releases.map((release) => readUpstreamReference({
        ...versions,
        [versionName]: release.replace(/^(?:bun-)?v/v, ''),
      }, digestName).tag);
    })
    .filter((tag) => !unpublishedTags.has(tag));
};

const serveUpstream = (answers: UpstreamAnswers): FakeUpstream => {
  const authorizations: string[] = [];

  const releasesByRepository = new Map<string, readonly string[]>([
    ...objectValues(GITHUB_REPOSITORIES).map((repository) => <const>[repository, []]),
    ...answers.gitHubVersions,
  ]);

  const url = serve((request) => {
    const requestUrl = new URL(request.url);

    if (requestUrl.pathname.endsWith(RELEASES_SUFFIX)) {
      const repository = requestUrl.pathname.slice(REPOSITORIES_PREFIX.length, -RELEASES_SUFFIX.length);
      const versions = releasesByRepository.get(repository);

      if (versions === undefined) {
        throw new Error(`No request for the releases of "${repository}" is planned.`);
      }

      authorizations.push(request.headers.get('Authorization') ?? NO_AUTHORIZATION);

      return Response.json(versions.map((version) => objectFromEntries([['tag_name', version]])));
    }

    if (requestUrl.pathname === PHP_TAGS_PATH) {
      return Response.json({
        results: answers.phpVersions.map((version) => ({
          name: `${version}-cli-acme`,
        })),
      });
    }

    if (requestUrl.pathname.includes('/releases/download/')) {
      return new Response(ASSET);
    }

    return new Response(undefined, {
      status: STATUS_CODE.NOT_FOUND,
    });
  });

  return {
    authorizations,
    sources: {
      dockerHubUrl: url.origin,
      gitHubApiUrl: url.origin,
      gitHubUrl: url.origin,
      registries: serveRegistry((registryPath) => (registryPath.includes('/tags/list')
        ? Response.json({
          tags: listPublishedTags(registryPath, releasesByRepository, answers.unpublishedTags ?? new Set()),
        })
        : createDigestResponse(DIGEST))).registries,
    },
  };
};

describe('the bump-tools script', () => {
  it('leaves pins that are still the latest alone and asks GitHub without a token where it has none', async () => {
    const pinsText = createPinsText({});

    const upstream = serveUpstream({
      gitHubVersions: new Map([
        [
          'rhysd/actionlint',
          ['v1.0.0'],
        ],
      ]),
      phpVersions: ['1.0.0'],
    });

    const directory = await createRepository({
      '.env': pinsText,
    });

    const pinsFile = path.join(directory, '.env');
    const standardOutputWrites = captureWrites(process.stdout);

    await expect(main(
      [],
      {},
      pinsFile,
      upstream.sources,
    )).resolves.toBe(0);

    await expect(file(pinsFile).text()).resolves.toBe(pinsText);

    expect(standardOutputWrites).toStrictEqual([]);
    expect(new Set(upstream.authorizations)).toStrictEqual(new Set([NO_AUTHORIZATION]));
  });

  it.each([
    {
      name: 'one line per move for a human',
      format: 'human',
      moves: [
        'ACTIONLINT_VERSION: 1.0.0 -> 1.1.0\n',
        'BUN_DIGEST: sha256:bbbbbbbbbbbb -> sha256:aaaaaaaaaaaa\n',
        'BUN_VERSION: 1.0.0 -> 1.0.1\n',
        `HADOLINT_CHECKSUM: sha256:bbbbbbbbbbbb -> ${shortenDigest(CHECKSUM)}\n`,
        'PHP_VERSION: 1.0.0 -> 1.0.1\n',
      ],
    },
    {
      name: 'tab-separated rows on request',
      format: 'tsv',
      moves: [
        'ACTIONLINT_VERSION\t1.0.0\t1.1.0\n',
        'BUN_DIGEST\tsha256:bbbbbbbbbbbb\tsha256:aaaaaaaaaaaa\n',
        'BUN_VERSION\t1.0.0\t1.0.1\n',
        `HADOLINT_CHECKSUM\tsha256:bbbbbbbbbbbb\t${shortenDigest(CHECKSUM)}\n`,
        'PHP_VERSION\t1.0.0\t1.0.1\n',
      ],
    },
  ])('moves every pin that fell behind and prints $name', async (scenario) => {
    const upstream = serveUpstream({
      gitHubVersions: new Map([
        [
          'oven-sh/bun',
          [
            'bun-v1.1.0',
            'bun-v1.0.1',
          ],
        ],
        [
          'rhysd/actionlint',
          [
            'v2.0.0',
            'v1.1.0',
          ],
        ],
      ]),
      phpVersions: [
        '1.1.0',
        '1.0.1',
      ],
    });

    const directory = await createRepository({
      '.env': createPinsText({
        BUN_DIGEST: STALE_PIN,
        HADOLINT_CHECKSUM: STALE_PIN,
      }),
    });

    const pinsFile = path.join(directory, '.env');
    const standardOutputWrites = captureWrites(process.stdout);

    const environment = {
      ...NO_RELEASE_AGE,
      GITHUB_TOKEN: 'acme-token',
    };

    await expect(main(
      [`--format=${scenario.format}`],
      environment,
      pinsFile,
      upstream.sources,
    )).resolves.toBe(0);

    await expect(file(pinsFile).text()).resolves.toBe(createPinsText({
      ACTIONLINT_VERSION: '1.1.0',
      BUN_VERSION: `${toReference('BUN_MINOR')}.1`,
      PHP_VERSION: `${toReference('PHP_MINOR')}.1`,
    }));

    expect(standardOutputWrites).toStrictEqual(scenario.moves);

    expect(new Set(upstream.authorizations)).toStrictEqual(new Set(['Bearer acme-token']));
  });

  it('moves an image pin only to the newest version its registry publishes', async () => {
    const upstream = serveUpstream({
      gitHubVersions: new Map([
        [
          'nodejs/node',
          [
            'v1.1.0',
            'v1.0.1',
          ],
        ],
      ]),
      phpVersions: [],
      unpublishedTags: new Set(['1.1.0-acme']),
    });

    const directory = await createRepository({
      '.env': createPinsText({}),
    });

    const pinsFile = path.join(directory, '.env');
    const standardOutputWrites = captureWrites(process.stdout);

    await expect(main(
      [],
      NO_RELEASE_AGE,
      pinsFile,
      upstream.sources,
    )).resolves.toBe(0);

    await expect(file(pinsFile).text()).resolves.toBe(createPinsText({
      NODE_VERSION: '1.0.1',
    }));

    expect(standardOutputWrites).toStrictEqual(['NODE_VERSION: 1.0.0 -> 1.0.1\n']);
  });

  it('fails, naming the file, where it cannot write the pins', async () => {
    const upstream = serveUpstream({
      gitHubVersions: new Map(),
      phpVersions: [],
    });

    const directory = await createRepository({
      '.env': createPinsText({
        BUN_DIGEST: STALE_PIN,
      }),
    });

    const pinsFile = path.join(directory, '.env');
    const standardErrorWrites = captureWrites(process.stderr);

    await $`chmod 444 ${pinsFile}`;

    await expect(main(
      [],
      NO_RELEASE_AGE,
      pinsFile,
      upstream.sources,
    )).resolves.toBe(1);

    expect(standardErrorWrites.join('')).toMatch(/^Unable to write file "\.env": .+\n$/v);
  });

  it('fails, naming the format, for a format it does not know', async () => {
    const upstream = serveUpstream({
      gitHubVersions: new Map(),
      phpVersions: [],
    });

    await expect(main(
      ['--format=markdown'],
      {},
      '/nonexistent/.env',
      upstream.sources,
    )).rejects.toThrow('Unsupported format "markdown".');
  });

  it('refuses a bump that outgrows the pin it references', async () => {
    const pinsText = createPinsText({
      ACTIONLINT_MINOR: '1.0',
      ACTIONLINT_VERSION: `${toReference('ACTIONLINT_MINOR')}.0`,
    });

    const directory = await createRepository({
      '.env': pinsText,
    });

    const upstream = serveUpstream({
      gitHubVersions: new Map([
        [
          'rhysd/actionlint',
          ['v1.1.0'],
        ],
      ]),
      phpVersions: [],
    });

    const message = `"1.1.0" of "ACTIONLINT_VERSION" must start with "${toReference('ACTIONLINT_MINOR')}"`;

    await expect(main(
      [],
      NO_RELEASE_AGE,
      path.join(directory, '.env'),
      upstream.sources,
    )).rejects.toThrow(`Bumped value ${message}.`);
  });

  it('moves a pin only to a candidate seen for the minimum release age, whatever pins it', async () => {
    const seenLastWeek = new Date(Date.now() - WEEK_MILLISECONDS).toISOString();

    const directory = await createRepository({
      '.cache/bump.cache.json': JSON.stringify({
        'bump-tools': {
          [`${DOCKER_HUB}/library/node:0.9.0-acme@${DIGEST}`]: '1970-01-01T00:00:00.000Z',
          [`${DOCKER_HUB}/semgrep/semgrep:1.1.0-nonroot@${DIGEST}`]: seenLastWeek,
        },
      }),
      '.env': createPinsText({
        BUN_DIGEST: STALE_PIN,
        HADOLINT_CHECKSUM: STALE_PIN,
        MINIMUM_RELEASE_AGE: '604800',
      }),
    });

    const upstream = serveUpstream({
      gitHubVersions: new Map([
        [
          'composer/composer',
          ['1.0.1'],
        ],
        [
          'nodejs/node',
          ['v1.1.0'],
        ],
        [
          'rhysd/actionlint',
          ['v1.1.0'],
        ],
        [
          'semgrep/semgrep',
          ['v1.1.0'],
        ],
      ]),
      phpVersions: [],
    });

    const pinsFile = path.join(directory, '.env');
    const seenFile = path.join(directory, '.cache/bump.cache.json');
    const standardOutputWrites = captureWrites(process.stdout);

    await expect(main(
      [`--seen-file=${seenFile}`],
      NO_RELEASE_AGE,
      pinsFile,
      upstream.sources,
    )).resolves.toBe(0);

    await expect(file(pinsFile).text()).resolves.toBe(createPinsText({
      BUN_DIGEST: STALE_PIN,
      HADOLINT_CHECKSUM: STALE_PIN,
      MINIMUM_RELEASE_AGE: '604800',
      SEMGREP_VERSION: '1.1.0',
    }));

    expect(standardOutputWrites).toStrictEqual(['SEMGREP_VERSION: 1.0.0 -> 1.1.0\n']);

    await expect(readSeenReferences(seenFile)).resolves.toStrictEqual({
      'bump-tools': new Set([
        `${DOCKER_HUB}/library/node:1.1.0-acme@${DIGEST}`,
        `${DOCKER_HUB}/oven/bun:1.0.0-debian@${DIGEST}`,
        `${DOCKER_HUB}/semgrep/semgrep:1.1.0-nonroot@${DIGEST}`,
        `hadolint/hadolint/releases/download/v1.0.0/hadolint-Linux-x86_64@${CHECKSUM}`,
        `rhysd/actionlint/releases/download/v1.1.0/actionlint_1.1.0_linux_amd64.tar.gz@${CHECKSUM}`,
        'composer/composer:1.0.1',
      ]),
    });
  });
});
