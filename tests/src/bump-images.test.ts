import { $, file } from 'bun';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { main } from '#src/bump-images';
import { DOCKER_HUB, GHCR } from '#src/shared/registry';
import { STATUS_CODE } from '#src/shared/utils/http';
import { packageOrganization } from '#src/shared/utils/package-json';
import { createDigest } from '#tests/support/digest';
import { captureWrites } from '#tests/support/output';
import { createDigestResponse, serveRegistry } from '#tests/support/registry';
import { createRepository } from '#tests/support/repository';
import { readSeenReferences } from '#tests/support/seen';

import type { Registries } from '#src/shared/registry';

const OLD_DIGEST = createDigest('0');
const NEW_DIGEST = createDigest('1');
const OTHER_DIGEST = createDigest('2');
const DAY_MILLISECONDS = 86_400_000;
const SEEN_FILE = '.cache/bump.cache.json';
const TOOLS_SIGHTING = `${DOCKER_HUB}/library/node:1.0.0-acme@${NEW_DIGEST}`;

const NO_RELEASE_AGE = {
  MINIMUM_RELEASE_AGE: '0',
};

const TAG_LISTS = new Map([
  [
    '/v2/acme/forge-compose-mailpit/tags/list',
    ['1'],
  ],
  [
    '/v2/acme/forge/tags/list',
    [
      '1-cli',
      '1.2-cli',
      '1.2.3-cli',
    ],
  ],
  [
    '/v2/acme/layered-app/tags/list',
    [
      '1.2-app',
      '1.2-app-dev',
      '1.2-cli',
      '1.3-app',
      '1.3-app-dev',
      '1.3-cli',
    ],
  ],
  [
    '/v2/acme/layered/tags/list',
    [
      '1.2-cli',
      '1.3-cli',
    ],
  ],
  [
    '/v2/library/postgres/tags/list',
    [
      '1.1-acme',
      '1.2-acme',
      '1.2.1-acme',
      '2.0-acme',
    ],
  ],
  [
    '/v2/valkey/valkey/tags/list',
    [
      '1.0-acme',
      '1.1-acme',
    ],
  ],
  [
    `/v2/${packageOrganization}/forge/tags/list`,
    [
      '1-cli',
      '1.2-cli',
    ],
  ],
]);

const DIGESTS = new Map([
  [
    '/v2/acme/forge-compose-mailpit/manifests/1',
    OLD_DIGEST,
  ],
  [
    '/v2/acme/forge/manifests/1-cli',
    NEW_DIGEST,
  ],
  [
    '/v2/acme/forge/manifests/1.2-cli',
    NEW_DIGEST,
  ],
  [
    '/v2/acme/forge/manifests/1.2.3-cli',
    OTHER_DIGEST,
  ],
  [
    '/v2/acme/layered-app/manifests/1.3-app-dev',
    OTHER_DIGEST,
  ],
  [
    '/v2/acme/layered-app/manifests/1.3-app',
    NEW_DIGEST,
  ],
  [
    '/v2/acme/layered-app/manifests/1.3-cli',
    OTHER_DIGEST,
  ],
  [
    '/v2/acme/layered/manifests/1.3-cli',
    NEW_DIGEST,
  ],
  [
    '/v2/library/postgres/manifests/1.2-acme',
    NEW_DIGEST,
  ],
  [
    '/v2/library/postgres/manifests/1.2.1-acme',
    NEW_DIGEST,
  ],
  [
    '/v2/valkey/valkey/manifests/1.1-acme',
    NEW_DIGEST,
  ],
  [
    `/v2/${packageOrganization}/forge/manifests/1-cli`,
    NEW_DIGEST,
  ],
  [
    `/v2/${packageOrganization}/forge/manifests/1.2-cli`,
    NEW_DIGEST,
  ],
]);

const PROJECT_FILES = {
  '.env': [
    `FORGE_NAMESPACE=${GHCR}/acme`,
    'FORGE_TAG=1',
    `FORGE_MAILPIT_FRAGMENT_DIGEST=${OLD_DIGEST}`,
    `POSTGRES_IMAGE=postgres:1.1-acme@${OLD_DIGEST}`,
    '',
  ].join('\n'),
  '.env.dev': 'APP_DEBUG=1\n',
  '.env.prod': `FORGE_CLI_IMAGE_DIGEST=${OLD_DIGEST}\n`,
  'compose.yaml': [
    'services:',
    '  database:',
    `    image: postgres:1.1-acme@${OLD_DIGEST}`,
    '  mailpit:',
    '    image: acme/mailpit',
    '',
  ].join('\n'),
};

const createRegistries = (): Registries => serveRegistry((requestPath) => {
  const tags = TAG_LISTS.get(requestPath);

  if (tags !== undefined) {
    return Response.json({
      tags,
    });
  }

  const digest = DIGESTS.get(requestPath);

  return digest === undefined
    ? new Response(undefined, {
      status: STATUS_CODE.NOT_FOUND,
    })
    : createDigestResponse(digest);
}).registries;

describe('the bump-images script', () => {
  it.each([
    {
      name: 'one line per move for a human',
      argv: [],
      moves: [
        'postgres in .env: 1.1-acme -> 1.2-acme\n',
        'postgres in compose.yaml: 1.1-acme -> 1.2-acme\n',
        `${GHCR}/acme/forge in .env.prod: sha256:000000000000 -> sha256:111111111111\n`,
      ],
    },
    {
      name: 'tab-separated rows on request',
      argv: ['--format=tsv'],
      moves: [
        'postgres in .env\t1.1-acme\t1.2-acme\n',
        'postgres in compose.yaml\t1.1-acme\t1.2-acme\n',
        `${GHCR}/acme/forge in .env.prod\tsha256:000000000000\tsha256:111111111111\n`,
      ],
    },
  ])('moves every pinned and split reference to its newest tag and prints $name', async (scenario) => {
    const directory = await createRepository(PROJECT_FILES);
    const standardOutputWrites = captureWrites(process.stdout);

    await expect(main(
      scenario.argv,
      NO_RELEASE_AGE,
      directory,
      createRegistries(),
    )).resolves.toBe(0);

    await expect(file(path.join(directory, '.env')).text()).resolves.toBe([
      `FORGE_NAMESPACE=${GHCR}/acme`,
      'FORGE_TAG=1',
      `FORGE_MAILPIT_FRAGMENT_DIGEST=${OLD_DIGEST} # 1`,
      `POSTGRES_IMAGE=postgres:1.2-acme@${NEW_DIGEST} # 1.2.1`,
      '',
    ].join('\n'));

    await expect(file(path.join(directory, '.env.dev')).text()).resolves.toBe('APP_DEBUG=1\n');

    await expect(file(path.join(directory, '.env.prod')).text())
      .resolves
      .toBe(`FORGE_CLI_IMAGE_DIGEST=${NEW_DIGEST} # 1.2\n`);

    await expect(file(path.join(directory, 'compose.yaml')).text())
      .resolves
      .toBe(`services:\n  database:\n    image: postgres:1.2-acme@${NEW_DIGEST} # 1.2.1\n`
        + '  mailpit:\n    image: acme/mailpit\n');

    expect(standardOutputWrites).toStrictEqual(scenario.moves);
  });

  it('resolves a split pin from its own file over .env and writes a moved tag where its value came from', async () => {
    const directory = await createRepository({
      '.env': `FORGE_NAMESPACE=${GHCR}/acme\nFORGE_CLI_IMAGE_NAME=layered\nFORGE_TAG=1.2\nFORGE_CLI_IMAGE_DIGEST=${OLD_DIGEST}\n`,
      '.env.prod': `FORGE_CLI_IMAGE_NAME=layered-app\nFORGE_CLI_IMAGE_DIGEST=${OLD_DIGEST}\n`,
    });

    const standardOutputWrites = captureWrites(process.stdout);

    await expect(main(
      [],
      NO_RELEASE_AGE,
      directory,
      createRegistries(),
    )).resolves.toBe(0);

    await expect(file(path.join(directory, '.env')).text())
      .resolves
      .toBe([
        `FORGE_NAMESPACE=${GHCR}/acme\n`,
        'FORGE_CLI_IMAGE_NAME=layered\n',
        'FORGE_TAG=1.3\n',
        `FORGE_CLI_IMAGE_DIGEST=${NEW_DIGEST} # 1.3\n`,
      ].join(''));

    await expect(file(path.join(directory, '.env.prod')).text())
      .resolves
      .toBe(`FORGE_CLI_IMAGE_NAME=layered-app\nFORGE_CLI_IMAGE_DIGEST=${OTHER_DIGEST} # 1.3\n`);

    expect(standardOutputWrites).toStrictEqual([
      `${GHCR}/acme/layered in .env: 1.2-cli -> 1.3-cli\n`,
      `${GHCR}/acme/layered-app in .env.prod: 1.2-cli -> 1.3-cli\n`,
    ]);
  });

  it.each([
    {
      name: 'the base the Makefile names',
      dotenv: 'conf/.env',
      configText: `POSTGRES_IMAGE=postgres:1.2-acme@${NEW_DIGEST} # 1.2.1\n`,
      moves: ['postgres in conf/.env: 1.1-acme -> 1.2-acme\n'],
    },
    {
      name: 'none where the Makefile turns them off',
      dotenv: '0',
      configText: `POSTGRES_IMAGE=postgres:1.1-acme@${OLD_DIGEST}\n`,
      moves: [],
    },
  ])('reads the dotenv files at $name', async (scenario) => {
    const directory = await createRepository({
      '.env': `POSTGRES_IMAGE=postgres:1.1-acme@${OLD_DIGEST}\n`,
      'conf/.env': `POSTGRES_IMAGE=postgres:1.1-acme@${OLD_DIGEST}\n`,
      makefile: `DOTENV := ${scenario.dotenv}\ninclude Makefile\n`,
    });

    const standardOutputWrites = captureWrites(process.stdout);

    await expect(main(
      [],
      NO_RELEASE_AGE,
      directory,
      createRegistries(),
    )).resolves.toBe(0);

    await expect(file(path.join(directory, '.env')).text())
      .resolves
      .toBe(`POSTGRES_IMAGE=postgres:1.1-acme@${OLD_DIGEST}\n`);

    await expect(file(path.join(directory, 'conf/.env')).text())
      .resolves
      .toBe(scenario.configText);

    expect(standardOutputWrites).toStrictEqual(scenario.moves);
  });

  it('moves the application images a stage builds and runs on together with the forge release .env pins', async () => {
    const directory = await createRepository({
      '.env': `FORGE_NAMESPACE=${GHCR}/acme\nFORGE_CLI_IMAGE_NAME=layered\nFORGE_IMAGE_NAME=layered-app\nFORGE_TAG=1.2\nFORGE_CLI_IMAGE_DIGEST=${OLD_DIGEST}\n`,
      '.env.prod': `FORGE_APP_DEV_IMAGE_DIGEST=${OLD_DIGEST}\nFORGE_APP_IMAGE_DIGEST=${OLD_DIGEST}\n`,
    });

    const standardOutputWrites = captureWrites(process.stdout);

    await expect(main(
      [],
      NO_RELEASE_AGE,
      directory,
      createRegistries(),
    )).resolves.toBe(0);

    await expect(file(path.join(directory, '.env')).text())
      .resolves
      .toBe([
        `FORGE_NAMESPACE=${GHCR}/acme\n`,
        'FORGE_CLI_IMAGE_NAME=layered\n',
        'FORGE_IMAGE_NAME=layered-app\n',
        'FORGE_TAG=1.3\n',
        `FORGE_CLI_IMAGE_DIGEST=${NEW_DIGEST} # 1.3\n`,
      ].join(''));

    await expect(file(path.join(directory, '.env.prod')).text())
      .resolves
      .toBe(`FORGE_APP_DEV_IMAGE_DIGEST=${OTHER_DIGEST} # 1.3\nFORGE_APP_IMAGE_DIGEST=${NEW_DIGEST} # 1.3\n`);

    expect(standardOutputWrites).toStrictEqual([
      `${GHCR}/acme/layered in .env: 1.2-cli -> 1.3-cli\n`,
      `${GHCR}/acme/layered-app in .env.prod: 1.2-app-dev -> 1.3-app-dev\n`,
      `${GHCR}/acme/layered-app in .env.prod: 1.2-app -> 1.3-app\n`,
    ]);
  });

  it('changes nothing in a project that pins nothing', async () => {
    const directory = await createRepository({
      'compose.yaml': 'services: {}\n',
    });

    const standardOutputWrites = captureWrites(process.stdout);

    await expect(main(
      [],
      {},
      directory,
      createRegistries(),
    )).resolves.toBe(0);

    await expect(file(path.join(directory, 'compose.yaml')).text()).resolves.toBe('services: {}\n');

    expect(standardOutputWrites).toStrictEqual([]);
  });

  it('fails, naming the format, for a format it does not know', async () => {
    await expect(main(
      ['--format=markdown'],
      {},
      '/nonexistent',
      new Map(),
    )).rejects.toThrow('Unsupported format "markdown".');
  });

  it('writes every file it can and fails, naming each one it cannot', async () => {
    const directory = await createRepository(PROJECT_FILES);
    const standardErrorWrites = captureWrites(process.stderr);

    await $`chmod 444 .env compose.yaml`.cwd(directory);

    await expect(main(
      [],
      NO_RELEASE_AGE,
      directory,
      createRegistries(),
    )).resolves.toBe(1);

    await expect(file(path.join(directory, '.env.prod')).text())
      .resolves
      .toBe(`FORGE_CLI_IMAGE_DIGEST=${NEW_DIGEST} # 1.2\n`);

    expect(standardErrorWrites.join(''))
      .toMatch(/^Unable to write file "\.env": .+\nUnable to write file "compose\.yaml": .+\n$/v);
  });

  it('holds back a move of another organization until its candidate is old enough, pinned or split', async () => {
    const seenYesterday = new Date(Date.now() - DAY_MILLISECONDS).toISOString();

    const directory = await createRepository({
      [SEEN_FILE]: JSON.stringify({
        'bump-images': {
          [`postgres:1.2-acme@${NEW_DIGEST}`]: seenYesterday,
          [`postgres:1.9-acme@${OTHER_DIGEST}`]: '1970-01-01T00:00:00.000Z',
        },
        'bump-tools': {
          [TOOLS_SIGHTING]: '1970-01-01T00:00:00.000Z',
        },
      }),
      '.env': [
        `FORGE_NAMESPACE=${GHCR}/${packageOrganization}`,
        'FORGE_TAG=1',
        `FORGE_CLI_IMAGE_DIGEST=${OLD_DIGEST}`,
        'MINIMUM_RELEASE_AGE=86400',
        `POSTGRES_IMAGE=postgres:1.1-acme@${OLD_DIGEST}`,
        `CACHE_IMAGE=valkey/valkey:1.0-acme@${OLD_DIGEST}`,
        'VALKEY_TAG=1.0-acme',
        `VALKEY_IMAGE_DIGEST=${OLD_DIGEST}`,
        '',
      ].join('\n'),
    });

    const standardOutputWrites = captureWrites(process.stdout);
    const seenFile = path.join(directory, SEEN_FILE);

    await expect(main(
      [`--seen-file=${seenFile}`],
      NO_RELEASE_AGE,
      directory,
      createRegistries(),
    )).resolves.toBe(0);

    await expect(file(path.join(directory, '.env')).text()).resolves.toBe([
      `FORGE_NAMESPACE=${GHCR}/${packageOrganization}`,
      'FORGE_TAG=1',
      `FORGE_CLI_IMAGE_DIGEST=${NEW_DIGEST} # 1.2`,
      'MINIMUM_RELEASE_AGE=86400',
      `POSTGRES_IMAGE=postgres:1.2-acme@${NEW_DIGEST} # 1.2.1`,
      `CACHE_IMAGE=valkey/valkey:1.0-acme@${OLD_DIGEST}`,
      'VALKEY_TAG=1.0-acme',
      `VALKEY_IMAGE_DIGEST=${OLD_DIGEST}`,
      '',
    ].join('\n'));

    expect(standardOutputWrites).toStrictEqual([
      'postgres in .env: 1.1-acme -> 1.2-acme\n',
      `${GHCR}/${packageOrganization}/forge in .env: sha256:000000000000 -> sha256:111111111111\n`,
    ]);

    await expect(readSeenReferences(seenFile)).resolves.toStrictEqual({
      'bump-images': new Set([`valkey/valkey:1.1-acme@${NEW_DIGEST}`]),
      'bump-tools': new Set([TOOLS_SIGHTING]),
    });
  });
});
