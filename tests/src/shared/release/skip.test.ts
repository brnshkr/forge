import { describe, expect, it } from 'vitest';

import { isSkipped } from '#src/shared/release/skip';

describe('a skipped job', () => {
  it.each([
    {
      name: 'is one named itself',
      skippedNames: ['npm'],
      isSkipped: true,
    },
    {
      name: 'is one whose group is named',
      skippedNames: ['publish'],
      isSkipped: true,
    },
    {
      name: 'is no job of another group',
      skippedNames: ['security'],
      isSkipped: false,
    },
    {
      name: 'is no job where nothing is named',
      skippedNames: [],
      isSkipped: false,
    },
  ])('$name', (scenario) => {
    expect(isSkipped(scenario.skippedNames, 'npm')).toBe(scenario.isSkipped);
  });
});
