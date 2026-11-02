import { describe, expect, it } from 'vitest';

import { findPinnedReferences, parseImageReference, replacePinnedReferences } from '#src/shared/pins/references';
import { DOCKER_HUB, GHCR } from '#src/shared/registry';
import { createDigest } from '#tests/support/digest';

const DIGEST = createDigest('a');
const NEWER_DIGEST = createDigest('b');
const PINNED = `postgres:1.0-acme@${DIGEST}`;
const MOVED = `postgres:1.1-acme@${NEWER_DIGEST}`;

const REPLACEMENTS = new Map([
  [
    PINNED,
    {
      reference: MOVED,
      version: '1.1',
    },
  ],
]);

describe('a pinned reference', () => {
  it.each([
    {
      reference: PINNED,
      image: {
        registry: DOCKER_HUB,
        repository: 'library/postgres',
      },
    },
    {
      reference: `acme/user:1.0@${DIGEST}`,
      image: {
        registry: DOCKER_HUB,
        repository: 'acme/user',
      },
    },
    {
      reference: `${GHCR}/acme/user:1@${DIGEST}`,
      image: {
        registry: GHCR,
        repository: 'acme/user',
      },
    },
    {
      reference: `localhost:5000/acme/user:1@${DIGEST}`,
      image: {
        registry: 'localhost:5000',
        repository: 'acme/user',
      },
    },
  ])('names its registry and repository: $image.registry', (scenario) => {
    expect(parseImageReference(scenario.reference)).toMatchObject({
      image: scenario.image,
    });
  });

  it.each([
    {
      reference: 'postgres:1.0-acme',
    },
    {
      reference: `postgres@${DIGEST}`,
    },
  ])('is refused without a tag and a digest: $reference', (scenario) => {
    expect(() => parseImageReference(scenario.reference))
      .toThrow(`Image reference "${scenario.reference}" must pin a tag and a digest.`);
  });
});

describe('the references a file pins', () => {
  it('are the values of the keys ending in _IMAGE in a dotenv file', () => {
    const text = [
      `POSTGRES_IMAGE=${PINNED}`,
      `ACME_IMAGE="${GHCR}/acme/user:1@${DIGEST}" # 1.0.0`,
      `# VALKEY_IMAGE=${PINNED}`,
      'NODE_IMAGE=node:1.0-acme',
      `POSTGRES_DSN=${PINNED}`,
    ].join('\n');

    expect(findPinnedReferences(text, 'environment')).toStrictEqual([
      PINNED,
      `${GHCR}/acme/user:1@${DIGEST}`,
    ]);
  });

  it('are the images and OCI includes of a compose file, however they are spaced', () => {
    const text = [
      'include:',
      `  - oci://${GHCR}/acme/compose/app:1@${DIGEST}`,
      `  - path: "oci://${GHCR}/acme/compose/user:1@${DIGEST}"`,
      'services:',
      '  database:',
      `    image:   '${PINNED}'`,
      `    # image: ${PINNED}`,
      `    environment: ${PINNED}`,
    ].join('\n');

    expect(findPinnedReferences(text, 'compose')).toStrictEqual([
      `${GHCR}/acme/compose/app:1@${DIGEST}`,
      `${GHCR}/acme/compose/user:1@${DIGEST}`,
      PINNED,
    ]);
  });
});

describe('a replaced pinned reference', () => {
  it.each([
    {
      name: 'writes the version behind it',
      line: `POSTGRES_IMAGE=${PINNED}`,
      replacedLine: `POSTGRES_IMAGE=${MOVED} # 1.1`,
    },
    {
      name: 'replaces an old version and keeps any other comment',
      line: `POSTGRES_IMAGE=${PINNED} # 1.0 # database`,
      replacedLine: `POSTGRES_IMAGE=${MOVED} # 1.1 # database`,
    },
    {
      name: 'leaves a reference it has no replacement for',
      line: `ACME_IMAGE=${GHCR}/acme/user:1@${DIGEST}`,
      replacedLine: `ACME_IMAGE=${GHCR}/acme/user:1@${DIGEST}`,
    },
  ])('$name', (scenario) => {
    expect(replacePinnedReferences(scenario.line, 'environment', REPLACEMENTS)).toBe(scenario.replacedLine);
  });

  it('puts the version before a compose comment that is no version', () => {
    expect(replacePinnedReferences(`    image: "${PINNED}" # database`, 'compose', REPLACEMENTS))
      .toBe(`    image: "${MOVED}" # 1.1 # database`);
  });

  it('drops the version comment where the new tag names no version', () => {
    const replacements = new Map([
      [
        PINNED,
        {
          reference: `postgres:latest@${NEWER_DIGEST}`,
          version: '',
        },
      ],
    ]);

    expect(replacePinnedReferences(`POSTGRES_IMAGE=${PINNED} # 1.0`, 'environment', replacements))
      .toBe(`POSTGRES_IMAGE=postgres:latest@${NEWER_DIGEST}`);
  });

  it('replaces the version of a prerelease', () => {
    const prerelease = `${GHCR}/acme/user:1.0.0-alpha.1@${DIGEST}`;

    const replacements = new Map([
      [
        prerelease,
        {
          reference: `${GHCR}/acme/user:1.0.0-alpha.2@${NEWER_DIGEST}`,
          version: '1.0.0-alpha.2',
        },
      ],
    ]);

    expect(replacePinnedReferences(`ACME_IMAGE=${prerelease} # 1.0.0-alpha.1`, 'environment', replacements))
      .toBe(`ACME_IMAGE=${GHCR}/acme/user:1.0.0-alpha.2@${NEWER_DIGEST} # 1.0.0-alpha.2`);
  });
});
