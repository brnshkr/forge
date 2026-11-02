import { describe, expect, it } from 'vitest';

import { readPlainAssignments, readPlainValue } from '#src/shared/pins/dotenv';
import { createDigest } from '#tests/support/digest';

const DIGEST = createDigest('a');

describe('the plain value of an assignment', () => {
  it.each([
    {
      name: 'drops a version comment',
      value: `${DIGEST} # 1.0.0`,
      plainValue: DIGEST,
    },
    {
      name: 'drops double quotes',
      value: '"1.0-acme"',
      plainValue: '1.0-acme',
    },
    {
      name: 'drops single quotes',
      value: '\'1.0-acme\'',
      plainValue: '1.0-acme',
    },
    {
      name: 'keeps quotes that do not pair',
      value: '"1.0-acme\'',
      plainValue: '"1.0-acme\'',
    },
  ])('$name', (scenario) => {
    expect(readPlainValue(scenario.value)).toBe(scenario.plainValue);
  });

  it('is read for every assignment of a file', () => {
    expect(readPlainAssignments('ACME_TAG="1" # 1.0.0\nACME_SUFFIX=\n')).toStrictEqual({
      ACME_SUFFIX: '',
      ACME_TAG: '1',
    });
  });
});
