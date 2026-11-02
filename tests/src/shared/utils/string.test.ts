import { describe, expect, it } from 'vitest';

import { GHCR } from '#src/shared/registry';
import { before, parseSeconds } from '#src/shared/utils/string';

describe('the text before a separator', () => {
  it.each([
    {
      name: 'ends at the first string separator',
      separator: '/',
      text: `${GHCR}/acme/user`,
      before: GHCR,
    },
    {
      name: 'ends at the first pattern match',
      separator: /[\t ]#/v,
      text: 'acme # 1.0.0 # note',
      before: 'acme',
    },
    {
      name: 'is the whole text without a separator',
      separator: '/',
      text: 'postgres',
      before: 'postgres',
    },
  ])('$name', (scenario) => {
    expect(before(scenario.text, scenario.separator)).toBe(scenario.before);
  });
});

describe('a number of seconds', () => {
  it.each([
    {
      text: '60',
      seconds: 60,
    },
    {
      text: '0',
      seconds: 0,
    },
    {
      text: '',
      seconds: undefined,
    },
    {
      text: '1.5',
      seconds: undefined,
    },
    {
      text: '-1',
      seconds: undefined,
    },
  ])('is read from $text as $seconds', (scenario) => {
    expect(parseSeconds(scenario.text)).toBe(scenario.seconds);
  });
});
