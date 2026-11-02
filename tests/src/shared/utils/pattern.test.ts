import { describe, expect, it } from 'vitest';

import { compileLinearPattern, readGroup } from '#src/shared/utils/pattern';

describe('a linear pattern', () => {
  it('compiles with its flags', () => {
    expect(compileLinearPattern(String.raw`^v\d+$`, 'v')).toStrictEqual(/^v\d+$/v);
  });

  it('is refused, naming its source, where it can backtrack super-linearly', () => {
    expect(() => compileLinearPattern('^(a+)+$', 'v')).toThrow('The pattern "^(a+)+$" can backtrack super-linearly.');
  });
});

describe('a named group', () => {
  it('reads what the pattern captured, empty included', () => {
    expect(readGroup(/^(?<prefix>v?)(?<number>\d+)$/v.exec('1')?.groups, 'prefix')).toBe('');
  });

  it.each([
    {
      name: 'a group that did not take part in the match',
      groups: /^(?<number>\d+)(?:-(?<suffix>\w+))?$/v.exec('1')?.groups,
    },
    {
      name: 'a pattern without groups',
      groups: /^\d+$/v.exec('1')?.groups,
    },
  ])('fails, naming the group, for $name', (scenario) => {
    expect(() => readGroup(scenario.groups, 'suffix')).toThrow('Group "suffix" not found in the match.');
  });
});
