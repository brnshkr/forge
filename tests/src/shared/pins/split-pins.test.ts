import { describe, expect, it } from 'vitest';

import {
  createSplitReference,
  findSplitPins,
  readRepositoryDefaults,
  replaceAssignment,
} from '#src/shared/pins/split-pins';

import { GHCR } from '#src/shared/registry';
import { createDigest } from '#tests/support/digest';

import type { SplitDefaults } from '#src/shared/pins/split-pins';

const DIGEST = createDigest('a');
const NEWER_DIGEST = createDigest('b');

const DEFAULTS = <const>{
  forgeRepository: `${GHCR}/acme/forge`,
  forgeRepositoryOwner: `${GHCR}/acme`,
  repositories: {
    POSTGRES: 'postgres',
  },
} satisfies SplitDefaults;

describe('the split pins a dotenv file holds', () => {
  it('are the image and fragment digests, each with the prefix its other keys share', () => {
    const text = [
      'FORGE_TAG=1',
      `FORGE_CLI_IMAGE_DIGEST=${DIGEST} # 1.0.0`,
      `CLI_FRAGMENT_DIGEST="${DIGEST}"`,
      `# POSTGRES_IMAGE_DIGEST=${DIGEST}`,
      'POSTGRES_IMAGE_DIGEST=sha256:short',
    ].join('\n');

    expect(findSplitPins(text)).toStrictEqual([
      {
        digest: DIGEST,
        digestKey: 'FORGE_CLI_IMAGE_DIGEST',
        kind: 'image',
        prefix: 'FORGE_CLI',
      },
      {
        digest: DIGEST,
        digestKey: 'CLI_FRAGMENT_DIGEST',
        kind: 'fragment',
        prefix: 'CLI',
      },
    ]);
  });

  it('read their default repositories from the fragments, one of forge\'s under its owner', () => {
    const fragments = [
      `image: \${POSTGRES_IMAGE:-\${POSTGRES_REPOSITORY:-postgres}:\${POSTGRES_TAG:?}}`,
      `image: \${PROXY_IMAGE:-\${PROXY_REPOSITORY:-\${FORGE_REPOSITORY_OWNER:?Set it.}/forge-app}:\${PROXY_TAG:?}}`,
    ];

    expect(readRepositoryDefaults(fragments, `${GHCR}/acme`)).toStrictEqual({
      POSTGRES: 'postgres',
      PROXY: `${GHCR}/acme/forge-app`,
    });
  });
});

describe('the reference a split pin stands for', () => {
  it.each([
    {
      name: 'builds the command line image under forge\'s owner',
      pin: {
        digest: DIGEST,
        digestKey: 'FORGE_CLI_IMAGE_DIGEST',
        kind: <const>'image',
        prefix: 'FORGE_CLI',
      },
      values: {
        FORGE_TAG: '1',
      },
      splitReference: {
        reference: `${GHCR}/acme/forge:1@${DIGEST}`,
        suffix: '',
        tagKey: 'FORGE_TAG',
      },
    },
    {
      name: 'takes the command line image\'s name and suffix where they are set',
      pin: {
        digest: DIGEST,
        digestKey: 'FORGE_CLI_IMAGE_DIGEST',
        kind: <const>'image',
        prefix: 'FORGE_CLI',
      },
      values: {
        FORGE_CLI_IMAGE_NAME: 'forge-php',
        FORGE_CLI_IMAGE_SUFFIX: '-chromium',
        FORGE_TAG: '1',
      },
      splitReference: {
        reference: `${GHCR}/acme/forge-php:1-chromium@${DIGEST}`,
        suffix: '-chromium',
        tagKey: 'FORGE_TAG',
      },
    },
    {
      name: 'builds the application image with its suffix',
      pin: {
        digest: DIGEST,
        digestKey: 'FORGE_APP_IMAGE_DIGEST',
        kind: <const>'image',
        prefix: 'FORGE_APP',
      },
      values: {
        FORGE_APP_IMAGE_SUFFIX: '-dev',
        FORGE_TAG: '1',
      },
      splitReference: {
        reference: `${GHCR}/acme/forge-app:1-dev@${DIGEST}`,
        suffix: '-dev',
        tagKey: 'FORGE_TAG',
      },
    },
    {
      name: 'builds the application image a project builds on, with the forge release and -dev',
      pin: {
        digest: DIGEST,
        digestKey: 'FORGE_BUILD_IMAGE_DIGEST',
        kind: <const>'image',
        prefix: 'FORGE_BUILD',
      },
      values: {
        FORGE_APP_IMAGE_SUFFIX: '',
        FORGE_TAG: '1',
      },
      splitReference: {
        reference: `${GHCR}/acme/forge-app:1-dev@${DIGEST}`,
        suffix: '-dev',
        tagKey: 'FORGE_TAG',
      },
    },
    {
      name: 'builds the application image a project runs on, under the application image\'s name',
      pin: {
        digest: DIGEST,
        digestKey: 'FORGE_RUNTIME_IMAGE_DIGEST',
        kind: <const>'image',
        prefix: 'FORGE_RUNTIME',
      },
      values: {
        FORGE_APP_IMAGE_NAME: 'forge-bun-app',
        FORGE_TAG: '1',
      },
      splitReference: {
        reference: `${GHCR}/acme/forge-bun-app:1@${DIGEST}`,
        suffix: '',
        tagKey: 'FORGE_TAG',
      },
    },
    {
      name: 'takes an upstream image from its fragment default unless the repository is set',
      pin: {
        digest: DIGEST,
        digestKey: 'POSTGRES_IMAGE_DIGEST',
        kind: <const>'image',
        prefix: 'POSTGRES',
      },
      values: {
        POSTGRES_TAG: '1.0-acme',
      },
      splitReference: {
        reference: `postgres:1.0-acme@${DIGEST}`,
        suffix: '',
        tagKey: 'POSTGRES_TAG',
      },
    },
    {
      name: 'tags a fragment with forge\'s release',
      pin: {
        digest: DIGEST,
        digestKey: 'CLI_FRAGMENT_DIGEST',
        kind: <const>'fragment',
        prefix: 'CLI',
      },
      values: {
        FORGE_TAG: '2',
      },
      splitReference: {
        reference: `${GHCR}/acme/forge/compose/cli:2@${DIGEST}`,
        suffix: '',
        tagKey: 'FORGE_TAG',
      },
    },
    {
      name: 'tags a fragment with its own tag where one is set',
      pin: {
        digest: DIGEST,
        digestKey: 'POSTGRES_FRAGMENT_DIGEST',
        kind: <const>'fragment',
        prefix: 'POSTGRES',
      },
      values: {
        FORGE_TAG: '2',
        POSTGRES_FRAGMENT_TAG: '1',
      },
      splitReference: {
        reference: `${GHCR}/acme/forge/compose/postgres:1@${DIGEST}`,
        suffix: '',
        tagKey: 'POSTGRES_FRAGMENT_TAG',
      },
    },
  ])('$name', (scenario) => {
    expect(createSplitReference(scenario.pin, scenario.values, DEFAULTS)).toStrictEqual(scenario.splitReference);
  });

  it.each([
    {
      name: 'refuses a digest without its tag',
      pin: {
        digest: DIGEST,
        digestKey: 'POSTGRES_IMAGE_DIGEST',
        kind: <const>'image',
        prefix: 'POSTGRES',
      },
      message: 'Variable "POSTGRES_TAG" not found, but "POSTGRES_IMAGE_DIGEST" requires it.',
    },
    {
      name: 'refuses an application image digest without the forge release',
      pin: {
        digest: DIGEST,
        digestKey: 'FORGE_BUILD_IMAGE_DIGEST',
        kind: <const>'image',
        prefix: 'FORGE_BUILD',
      },
      message: 'Variable "FORGE_TAG" not found, but "FORGE_BUILD_IMAGE_DIGEST" requires it.',
    },
    {
      name: 'refuses an image nothing names the repository of',
      pin: {
        digest: DIGEST,
        digestKey: 'ACME_IMAGE_DIGEST',
        kind: <const>'image',
        prefix: 'ACME',
      },
      message: 'Repository of "ACME_IMAGE_DIGEST" not found. '
        + 'Set "ACME_REPOSITORY" or include a fragment that defines it.',
    },
  ])('$name', (scenario) => {
    expect(() => createSplitReference(scenario.pin, {}, DEFAULTS)).toThrow(scenario.message);
  });
});

describe('a replaced assignment', () => {
  it.each([
    {
      name: 'writes the version behind a digest',
      line: `FORGE_CLI_IMAGE_DIGEST=${DIGEST}`,
      replacedLine: `FORGE_CLI_IMAGE_DIGEST=${NEWER_DIGEST} # 1.0.1`,
    },
    {
      name: 'replaces an old version and keeps the quotes and any other comment',
      line: `FORGE_CLI_IMAGE_DIGEST="${DIGEST}" # 1.0.0 # forge`,
      replacedLine: `FORGE_CLI_IMAGE_DIGEST="${NEWER_DIGEST}" # 1.0.1 # forge`,
    },
    {
      name: 'replaces the version of a prerelease',
      line: `FORGE_CLI_IMAGE_DIGEST=${DIGEST} # 1.0.1-rc.1`,
      replacedLine: `FORGE_CLI_IMAGE_DIGEST=${NEWER_DIGEST} # 1.0.1`,
    },
    {
      name: 'leaves a key that only starts with the name',
      line: `FORGE_CLI_IMAGE_DIGEST_OLD=${DIGEST}`,
      replacedLine: `FORGE_CLI_IMAGE_DIGEST_OLD=${DIGEST}`,
    },
  ])('$name', (scenario) => {
    expect(replaceAssignment(
      scenario.line,
      'FORGE_CLI_IMAGE_DIGEST',
      NEWER_DIGEST,
      '1.0.1',
    )).toBe(scenario.replacedLine);
  });

  it('drops an old version where it is given none', () => {
    expect(replaceAssignment('FORGE_TAG=1 # 1.0.0', 'FORGE_TAG', '2')).toBe('FORGE_TAG=2');
  });
});
