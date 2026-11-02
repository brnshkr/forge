import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FORGE_DIRECTORY } from '#src/shared/make';
import { GHCR } from '#src/shared/registry';
import { readArgumentNames, readBuildArguments, readImageTargets } from '#src/shared/release/images';
import { createDigest } from '#tests/support/digest';
import { toReference } from '#tests/support/dotenv';
import { createRepository } from '#tests/support/repository';

const DOCKERFILE = [
  'ARG BUN_VERSION',
  'ARG ACME_IMAGE',
  'ARG PHP_EXTENSIONS="intl \\',
  '  zip"',
  'ARG TARGETARCH',
  `FROM oven/bun:${toReference('BUN_VERSION')} AS bun`,
  'ARG BUN_VERSION',
].join('\n');

const BUILD_DIGEST = createDigest('a');
const RUNTIME_DIGEST = createDigest('b');

describe('the build arguments of a Dockerfile', () => {
  it('are named once each, in declaration order', () => {
    expect(readArgumentNames(DOCKERFILE)).toStrictEqual([
      'BUN_VERSION',
      'ACME_IMAGE',
      'PHP_EXTENSIONS',
      'TARGETARCH',
    ]);
  });

  it.each([
    {
      name: 'leave a default and an automatic argument to Docker',
      extensions: undefined,
      passed: [],
    },
    {
      name: 'pass a value over the default',
      extensions: 'redis',
      passed: ['PHP_EXTENSIONS=redis'],
    },
    {
      name: 'pass an empty value as empty',
      extensions: '',
      passed: ['PHP_EXTENSIONS='],
    },
  ])('$name', (scenario) => {
    const argumentValues = {
      ACME_IMAGE: 'acme/user:1',
      BUN_VERSION: '1.0.0',
      ...scenario.extensions === undefined
        ? {}
        : {
          PHP_EXTENSIONS: scenario.extensions,
        },
    };

    expect(readBuildArguments(DOCKERFILE, argumentValues)).toStrictEqual([
      'BUN_VERSION=1.0.0',
      'ACME_IMAGE=acme/user:1',
      ...scenario.passed,
    ]);
  });

  it('refuse a declared argument that has no default and no value, naming it', () => {
    expect(() => readBuildArguments(DOCKERFILE, {
      BUN_VERSION: '1.0.0',
    })).toThrow('Build argument "ACME_IMAGE" has no default and no value.');
  });
});

describe('the image targets of a repository', () => {
  it('are the stages that name an image, each with its Dockerfile\'s arguments', async () => {
    const directory = await createRepository({
      '.env': 'ACME_VERSION=1.0.0\nACME_MINOR=1.0\n',
      '.env.dev': 'APP_DEBUG=1\n',
      '.env.prod': `IMAGE_NAME=acme-user\nIMAGE_TARGET=prod\nIMAGE_ALIASES=v${toReference('ACME_MINOR')} latest\n`,
      '.env.prod.local': 'APP_DEBUG=1\n',
      'docker/acme-user.Dockerfile': [
        'ARG ACME_VERSION',
        'ARG USER_UID=1000',
        'ARG TARGETARCH',
        `FROM acme/base:${toReference('ACME_VERSION')}`,
      ].join('\n'),
    });

    await expect(readImageTargets(directory)).resolves.toStrictEqual([
      {
        aliases: [
          'v1.0',
          'latest',
        ],
        arguments: ['ACME_VERSION=1.0.0'],
        dockerfile: 'docker/acme-user.Dockerfile',
        name: 'acme-user',
        suffix: '',
        target: 'prod',
      },
    ]);
  });

  it.each([
    {
      name: 'the stage it names',
      environmentText: 'IMAGE_NAME=acme-user\nIMAGE_TARGET=prod\n',
      target: 'prod',
    },
    {
      name: 'the last stage where it names none',
      environmentText: 'IMAGE_NAME=acme-user\n',
      target: '',
    },
  ])('build $name of their Dockerfile', async (scenario) => {
    const directory = await createRepository({
      '.env': '',
      '.env.prod': scenario.environmentText,
      'docker/acme-user.Dockerfile': 'FROM acme/base AS prod\n',
    });

    await expect(readImageTargets(directory)).resolves.toMatchObject([
      {
        target: scenario.target,
      },
    ]);
  });

  it('take the Dockerfile in the config directory over the one in the root', async () => {
    const directory = await createRepository({
      '.env': '',
      '.env.prod': 'IMAGE_NAME=acme-user\nIMAGE_TARGET=prod\n',
      'conf/docker/acme-user.Dockerfile': 'FROM acme/base\n',
      'docker/acme-user.Dockerfile': 'FROM acme/other\n',
    });

    await expect(readImageTargets(directory)).resolves.toMatchObject([
      {
        dockerfile: 'conf/docker/acme-user.Dockerfile',
      },
    ]);
  });

  it('build a stage without a Dockerfile of its own from forge\'s generic one', async () => {
    const directory = await createRepository({
      '.env': '',
      '.env.prod': [
        'IMAGE_NAME=acme-user',
        'IMAGE_TARGET=prod',
        `FORGE_BUILD_IMAGE=${GHCR}/brnshkr/forge-app:1.0-dev`,
        `FORGE_RUNTIME_IMAGE=${GHCR}/brnshkr/forge-app:1.0`,
        '',
      ].join('\n'),
    });

    const [imageTarget] = await readImageTargets(directory);

    expect(imageTarget?.dockerfile).toBe(path.relative(directory, path.join(FORGE_DIRECTORY, 'docker/app/Dockerfile')));

    expect(imageTarget?.arguments).toStrictEqual([
      `FORGE_BUILD_IMAGE=${GHCR}/brnshkr/forge-app:1.0-dev`,
      `FORGE_RUNTIME_IMAGE=${GHCR}/brnshkr/forge-app:1.0`,
    ]);
  });

  it.each([
    {
      name: 'from their digests and the forge release .env pins',
      environmentText: '',
      arguments: [
        `FORGE_BUILD_IMAGE=${GHCR}/brnshkr/forge-app:1-dev@${BUILD_DIGEST}`,
        `FORGE_RUNTIME_IMAGE=${GHCR}/brnshkr/forge-app:1@${RUNTIME_DIGEST}`,
      ],
    },
    {
      name: 'from a full reference over its digest',
      environmentText: `FORGE_RUNTIME_IMAGE=${GHCR}/acme/runtime:1.0\n`,
      arguments: [
        `FORGE_BUILD_IMAGE=${GHCR}/brnshkr/forge-app:1-dev@${BUILD_DIGEST}`,
        `FORGE_RUNTIME_IMAGE=${GHCR}/acme/runtime:1.0`,
      ],
    },
  ])('compose forge\'s images $name', async (scenario) => {
    const directory = await createRepository({
      '.env': 'FORGE_TAG=1\n',
      '.env.prod': [
        'IMAGE_NAME=acme-user',
        'IMAGE_TARGET=prod',
        `FORGE_BUILD_IMAGE_DIGEST=${BUILD_DIGEST}`,
        `FORGE_RUNTIME_IMAGE_DIGEST=${RUNTIME_DIGEST}`,
        scenario.environmentText,
      ].join('\n'),
    });

    const [imageTarget] = await readImageTargets(directory);

    expect(imageTarget?.arguments).toStrictEqual(scenario.arguments);
  });

  it.each([
    {
      suffix: '-dev',
      buildImages: [
        `FORGE_BUILD_IMAGE=${GHCR}/brnshkr/forge-app:1-dev@${BUILD_DIGEST}`,
      ],
    },
    {
      suffix: '',
      buildImages: [],
    },
  ])('build on the application image a project develops on only where its suffix is -dev: "$suffix"', async (scenario) => {
    const directory = await createRepository({
      '.env': `FORGE_TAG=1\nFORGE_APP_IMAGE_SUFFIX=${scenario.suffix}\nFORGE_APP_IMAGE_DIGEST=${BUILD_DIGEST}\n`,
      '.env.prod': `IMAGE_NAME=acme-user\nIMAGE_TARGET=prod\nFORGE_RUNTIME_IMAGE_DIGEST=${RUNTIME_DIGEST}\n`,
      'docker/acme-user.Dockerfile': 'ARG FORGE_BUILD_IMAGE=""\nARG FORGE_RUNTIME_IMAGE\nFROM acme/base AS prod\n',
    });

    const [imageTarget] = await readImageTargets(directory);

    expect(imageTarget?.arguments).toStrictEqual([
      ...scenario.buildImages,
      `FORGE_RUNTIME_IMAGE=${GHCR}/brnshkr/forge-app:1@${RUNTIME_DIGEST}`,
    ]);
  });

  it('refuse a forge image digest without the forge release', async () => {
    const directory = await createRepository({
      '.env': '',
      '.env.prod': `IMAGE_NAME=acme-user\nFORGE_BUILD_IMAGE_DIGEST=${BUILD_DIGEST}\nFORGE_RUNTIME_IMAGE=${GHCR}/acme/runtime:1.0\n`,
    });

    await expect(readImageTargets(directory))
      .rejects
      .toThrow('Variable "FORGE_TAG" not found, but "FORGE_BUILD_IMAGE_DIGEST" requires it.');
  });

  it('refuse a stage on forge\'s generic Dockerfile that pins neither image', async () => {
    const directory = await createRepository({
      '.env': '',
      '.env.prod': 'IMAGE_NAME=acme-user\nIMAGE_TARGET=prod\n',
    });

    await expect(readImageTargets(directory)).rejects.toThrow([
      'Build argument "FORGE_BUILD_IMAGE" has no default and no value.',
      'Build argument "FORGE_RUNTIME_IMAGE" has no default and no value.',
    ].join('\n'));
  });

  it('refuse a stage whose Dockerfile declares an argument nothing sets', async () => {
    const directory = await createRepository({
      '.env': '',
      '.env.prod': 'IMAGE_NAME=acme-user\nIMAGE_TARGET=prod\n',
      'docker/acme-user.Dockerfile': `ARG ACME_VERSION\nFROM acme/base:${toReference('ACME_VERSION')}\n`,
    });

    await expect(readImageTargets(directory)).rejects.toThrow('Build argument "ACME_VERSION" has no default and no value.');
  });
});
