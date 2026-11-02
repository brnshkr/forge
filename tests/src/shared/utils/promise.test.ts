import { sleep } from 'bun';

import { describe, expect, it } from 'vitest';

import { filterPassing, findFirstPassing, readRejectionMessages } from '#src/shared/utils/promise';

const LONG_DELAY_MILLISECONDS = 20;
const SHORT_DELAY_MILLISECONDS = 10;

const DELAYS_MILLISECONDS = [
  LONG_DELAY_MILLISECONDS,
  0,
  SHORT_DELAY_MILLISECONDS,
];

const isPassingLate = async (delayMilliseconds: number): Promise<boolean> => {
  await sleep(delayMilliseconds);

  return delayMilliseconds > 0;
};

describe('the items an async check passes', () => {
  it('keep their order, however long each check takes', async () => {
    await expect(filterPassing(DELAYS_MILLISECONDS, isPassingLate)).resolves.toStrictEqual([
      LONG_DELAY_MILLISECONDS,
      SHORT_DELAY_MILLISECONDS,
    ]);
  });

  it('start with the first item in order, not the first check to finish', async () => {
    await expect(findFirstPassing(DELAYS_MILLISECONDS, isPassingLate)).resolves.toBe(LONG_DELAY_MILLISECONDS);
  });

  it('are none where no check passes', async () => {
    await expect(findFirstPassing([0], isPassingLate)).resolves.toBeUndefined();
  });
});

describe('the rejections of settled promises', () => {
  it('are every rejection\'s message, in order', async () => {
    const results = await Promise.allSettled([
      Promise.reject(new Error('Unable to write file ".env".')),
      Promise.resolve(),
      Promise.reject(new Error('Unable to write file "compose.yaml".')),
    ]);

    expect(readRejectionMessages(results)).toStrictEqual([
      'Unable to write file ".env".',
      'Unable to write file "compose.yaml".',
    ]);
  });
});
