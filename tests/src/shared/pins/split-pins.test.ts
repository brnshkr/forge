import { describe, expect, it } from 'vitest';

import {
  createSplitReference,
  findSplitPins,
  readForgeFragmentNamespace,
  readForgeImageNamespace,
  readRepositoryDefaults,
  readTagSuffixes,
  replaceAssignment,
} from '#src/shared/pins/split-pins';

import { GHCR } from '#src/shared/registry';
import { packageName, packageOrganization } from '#src/shared/utils/package-json';
import { createDigest } from '#tests/support/digest';

import type { SplitDefaults } from '#src/shared/pins/split-pins';

const DIGEST = createDigest('a');
const NEWER_DIGEST = createDigest('b');

const DEFAULTS = <const>{
  forgeFragmentNamespace: `${GHCR}/acme`,
  forgeImageNamespace: `${GHCR}/acme`,
  repositories: {
    POSTGRES: 'postgres',
    PROXY: `${GHCR}/acme/forge-php`,
  },
  tagSuffixes: {
    POSTGRES: '',
    PROXY: '-app',
  },
} satisfies SplitDefaults;

describe('the split pins a dotenv file holds', () => {
  it('are the image and fragment digests, each with the prefix its other keys share', () => {
    const text = [
      'FORGE_TAG=1',
      `FORGE_CLI_IMAGE_DIGEST=${DIGEST} # 1.0.0`,
      `FORGE_CLI_FRAGMENT_DIGEST="${DIGEST}"`,
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
        digestKey: 'FORGE_CLI_FRAGMENT_DIGEST',
        kind: 'fragment',
        prefix: 'FORGE_CLI',
      },
    ]);
  });

  it('read their default repositories from the fragments, one of forge\'s under its owner', () => {
    const fragments = [
      `image: \${POSTGRES_IMAGE:-\${POSTGRES_REPOSITORY:-postgres}:\${POSTGRES_TAG:?}}`,
      [
        `image: "\${PROXY_IMAGE:-\\`,
        `  \${PROXY_REPOSITORY:-\\`,
        `  \${FORGE_IMAGE_NAMESPACE:-\\`,
        `  \${FORGE_NAMESPACE:?Set it.}}/forge-php}\\`,
        `  :\${PROXY_TAG:?}}"`,
      ].join('\n'),
    ];

    expect(readRepositoryDefaults(fragments, `${GHCR}/acme`)).toStrictEqual({
      POSTGRES: 'postgres',
      PROXY: `${GHCR}/acme/forge-php`,
    });
  });

  it('read the suffix each fragment writes after its tag', () => {
    const fragments = [
      `image: \${POSTGRES_IMAGE:-postgres:\${POSTGRES_TAG:?Set it.}@\${POSTGRES_IMAGE_DIGEST:?Set it.}}`,
      [
        `image: "\${PROXY_IMAGE:-${packageName}-php\\`,
        `  :\${PROXY_TAG:?Set it.}-app\\`,
        `  @\${PROXY_IMAGE_DIGEST:?Set it.}}"`,
      ].join('\n'),
    ];

    expect(readTagSuffixes(fragments)).toStrictEqual({
      POSTGRES: '',
      PROXY: '-app',
    });
  });
});

describe('the namespace forge\'s images are pulled from', () => {
  it('is the one the project names', () => {
    expect(readForgeImageNamespace({
      FORGE_IMAGE_NAMESPACE: `${GHCR}/images`,
      FORGE_NAMESPACE: `${GHCR}/acme`,
    })).toBe(`${GHCR}/images`);
  });

  it('is the shared one where the project names no image namespace', () => {
    expect(readForgeImageNamespace({
      FORGE_FRAGMENT_NAMESPACE: `${GHCR}/fragments`,
      FORGE_NAMESPACE: `${GHCR}/acme`,
    })).toBe(`${GHCR}/acme`);
  });

  it('is Docker Hub where the project names none', () => {
    expect(readForgeImageNamespace({})).toBe(`docker.io/${packageOrganization}`);
  });
});

describe('the namespace forge\'s fragments are pulled from', () => {
  it('is the one the project names', () => {
    expect(readForgeFragmentNamespace({
      FORGE_FRAGMENT_NAMESPACE: `${GHCR}/fragments`,
      FORGE_NAMESPACE: `${GHCR}/acme`,
    })).toBe(`${GHCR}/fragments`);
  });

  it('is the shared one where the project names no fragment namespace', () => {
    expect(readForgeFragmentNamespace({
      FORGE_IMAGE_NAMESPACE: `${GHCR}/images`,
      FORGE_NAMESPACE: `${GHCR}/acme`,
    })).toBe(`${GHCR}/acme`);
  });

  it('is Docker Hub where the project names none', () => {
    expect(readForgeFragmentNamespace({})).toBe(`docker.io/${packageOrganization}`);
  });
});

describe('the reference a split pin stands for', () => {
  it.each([
    {
      name: 'builds the command line image under forge\'s owner, tagged with its role',
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
        reference: `${GHCR}/acme/forge:1-cli@${DIGEST}`,
        suffix: '-cli',
        tagKey: 'FORGE_TAG',
      },
    },
    {
      name: 'takes the stack every image falls back to',
      pin: {
        digest: DIGEST,
        digestKey: 'FORGE_APP_IMAGE_DIGEST',
        kind: <const>'image',
        prefix: 'FORGE_APP',
      },
      values: {
        FORGE_IMAGE_NAME: `${packageName}-php`,
        FORGE_TAG: '1',
      },
      splitReference: {
        reference: `${GHCR}/acme/forge-php:1-app@${DIGEST}`,
        suffix: '-app',
        tagKey: 'FORGE_TAG',
      },
    },
    {
      name: 'prefers an image\'s own name to the stack',
      pin: {
        digest: DIGEST,
        digestKey: 'FORGE_CLI_CHROMIUM_IMAGE_DIGEST',
        kind: <const>'image',
        prefix: 'FORGE_CLI_CHROMIUM',
      },
      values: {
        FORGE_CLI_CHROMIUM_IMAGE_NAME: `${packageName}-bun`,
        FORGE_IMAGE_NAME: `${packageName}-php`,
        FORGE_TAG: '1',
      },
      splitReference: {
        reference: `${GHCR}/acme/forge-bun:1-cli-chromium@${DIGEST}`,
        suffix: '-cli-chromium',
        tagKey: 'FORGE_TAG',
      },
    },
    {
      name: 'builds the development image a project builds on',
      pin: {
        digest: DIGEST,
        digestKey: 'FORGE_APP_DEV_IMAGE_DIGEST',
        kind: <const>'image',
        prefix: 'FORGE_APP_DEV',
      },
      values: {
        FORGE_TAG: '1',
      },
      splitReference: {
        reference: `${GHCR}/acme/forge:1-app-dev@${DIGEST}`,
        suffix: '-app-dev',
        tagKey: 'FORGE_TAG',
      },
    },
    {
      name: 'appends the suffix the fragment writes after the image\'s own tag',
      pin: {
        digest: DIGEST,
        digestKey: 'PROXY_IMAGE_DIGEST',
        kind: <const>'image',
        prefix: 'PROXY',
      },
      values: {
        PROXY_TAG: '1.0',
      },
      splitReference: {
        reference: `${GHCR}/acme/forge-php:1.0-app@${DIGEST}`,
        suffix: '-app',
        tagKey: 'PROXY_TAG',
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
        digestKey: 'FORGE_CLI_FRAGMENT_DIGEST',
        kind: <const>'fragment',
        prefix: 'FORGE_CLI',
      },
      values: {
        FORGE_TAG: '2',
      },
      splitReference: {
        reference: `${GHCR}/acme/${packageName}-compose-cli:2@${DIGEST}`,
        suffix: '',
        tagKey: 'FORGE_TAG',
      },
    },
    {
      name: 'names a fragment by the pin without its forge prefix',
      pin: {
        digest: DIGEST,
        digestKey: 'FORGE_PHP_APP_DEV_FRAGMENT_DIGEST',
        kind: <const>'fragment',
        prefix: 'FORGE_PHP_APP_DEV',
      },
      values: {
        FORGE_TAG: '2',
      },
      splitReference: {
        reference: `${GHCR}/acme/${packageName}-compose-php-app-dev:2@${DIGEST}`,
        suffix: '',
        tagKey: 'FORGE_TAG',
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
        digestKey: 'FORGE_APP_DEV_IMAGE_DIGEST',
        kind: <const>'image',
        prefix: 'FORGE_APP_DEV',
      },
      message: 'Variable "FORGE_TAG" not found, but "FORGE_APP_DEV_IMAGE_DIGEST" requires it.',
    },
    {
      name: 'refuses a fragment digest without the forge prefix',
      pin: {
        digest: DIGEST,
        digestKey: 'CLI_FRAGMENT_DIGEST',
        kind: <const>'fragment',
        prefix: 'CLI',
      },
      message: 'Fragment pin "CLI_FRAGMENT_DIGEST" must start with "FORGE_".',
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
