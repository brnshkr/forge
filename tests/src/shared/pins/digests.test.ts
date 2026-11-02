import { describe, expect, it } from 'vitest';

import { readDigest, shortenDigest } from '#src/shared/pins/digests';
import { createDigest } from '#tests/support/digest';

const DIGEST = createDigest('a');

describe('the digest of a reference', () => {
  it.each([
    {
      name: 'is what an image reference pins',
      reference: `postgres:1.0-acme@${DIGEST}`,
    },
    {
      name: 'is what a release asset is checked against',
      reference: `acme/user/releases/download/v1.0.0/user.tar.gz@${DIGEST}`,
    },
  ])('$name', (scenario) => {
    expect(readDigest(scenario.reference)).toBe(DIGEST);
  });
});

describe('a shortened digest', () => {
  it.each([
    {
      value: `postgres:1.0-acme@${DIGEST}`,
      shortenedValue: 'sha256:aaaaaaaaaaaa',
    },
    {
      value: DIGEST,
      shortenedValue: 'sha256:aaaaaaaaaaaa',
    },
    {
      value: '1.0.0',
      shortenedValue: '1.0.0',
    },
  ])('shows $shortenedValue for $value', (scenario) => {
    expect(shortenDigest(scenario.value)).toBe(scenario.shortenedValue);
  });
});
