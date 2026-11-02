import { describe, expect, it } from 'vitest';

import {
  compareNumbers,
  getLatestTag,
  getVersionFromTag,
  listVersionCandidates,
  readVersionNumbers,
} from '#src/shared/pins/version-tags';

describe('two lists of version numbers', () => {
  it.each([
    {
      name: 'orders by the first number that differs',
      left: '1.10',
      right: '1.9',
      sign: 1,
    },
    {
      name: 'puts the longer of two equal prefixes last',
      left: '1.2',
      right: '1',
      sign: 1,
    },
    {
      name: 'puts the shorter of two equal prefixes first',
      left: '1',
      right: '1.2',
      sign: -1,
    },
    {
      name: 'finds equal numbers equal',
      left: '1.2',
      right: '1.2',
      sign: 0,
    },
  ])('$name', (scenario) => {
    const numberComparison = compareNumbers(readVersionNumbers(scenario.left), readVersionNumbers(scenario.right));

    expect(Math.sign(numberComparison)).toBe(scenario.sign);
  });
});

describe('the tag a pin moves to', () => {
  it.each([
    {
      name: 'moves the last number and keeps the suffix',
      current: '1.1-acme',
      available: [
        '1.2-acme',
        '1.3-acme',
        '1.4-user',
      ],
      latestTag: '1.3-acme',
    },
    {
      name: 'keeps the prefix',
      current: 'v1.0.1-user',
      available: [
        'v1.0.2-user',
        '1.0.3-user',
      ],
      latestTag: 'v1.0.2-user',
    },
    {
      name: 'compares numerically rather than as text',
      current: '1.9-acme',
      available: ['1.10-acme'],
      latestTag: '1.10-acme',
    },
    {
      name: 'never moves a number before the last',
      current: 'v1.0.1-user',
      available: [
        'v1.1.0-user',
        'v2.0.0-user',
      ],
      latestTag: 'v1.0.1-user',
    },
    {
      name: 'ignores a tag with more or fewer numbers',
      current: '1.1-acme',
      available: [
        '1.1.1-acme',
        '2-acme',
      ],
      latestTag: '1.1-acme',
    },
    {
      name: 'keeps a tag with a single number, so only its digest moves',
      current: '1',
      available: ['2'],
      latestTag: '1',
    },
    {
      name: 'keeps a tag without a number',
      current: 'latest',
      available: ['1.0'],
      latestTag: 'latest',
    },
    {
      name: 'never moves the minor of a zero major, so only its digest moves',
      current: '0.3-acme',
      available: [
        '0.4-acme',
        '1.0-acme',
      ],
      latestTag: '0.3-acme',
    },
    {
      name: 'moves the patch of a zero major',
      current: '0.3.1-acme',
      available: [
        '0.3.2-acme',
        '0.4.0-acme',
      ],
      latestTag: '0.3.2-acme',
    },
    {
      name: 'never moves a release to a prerelease',
      current: '1.1-acme',
      available: [
        '1.2-rc.1-acme',
        '1.2-alpha.1',
      ],
      latestTag: '1.1-acme',
    },
    {
      name: 'moves a prerelease to a later kind before a higher number',
      current: '1.0.0-alpha.1',
      available: [
        '1.0.0-alpha.9',
        '1.0.0-beta.1',
      ],
      latestTag: '1.0.0-beta.1',
    },
    {
      name: 'compares prerelease numbers numerically',
      current: 'v1.0.0-rc.2',
      available: [
        'v1.0.0-rc.9',
        'v1.0.0-rc.10',
      ],
      latestTag: 'v1.0.0-rc.10',
    },
    {
      name: 'moves a prerelease to the release of its version',
      current: '1.0.0-rc.1',
      available: [
        '1.0.0-rc.2',
        '1.0.0',
      ],
      latestTag: '1.0.0',
    },
    {
      name: 'never moves a prerelease to another version',
      current: '1.0.0-alpha.1',
      available: [
        '1.0.1-alpha.1',
        '1.0.1',
        '1.1.0',
      ],
      latestTag: '1.0.0-alpha.1',
    },
    {
      name: 'never moves a prerelease back',
      current: '1.0.0-beta.1',
      available: ['1.0.0-alpha.2'],
      latestTag: '1.0.0-beta.1',
    },
    {
      name: 'keeps the variant suffix of a prerelease',
      current: '0.0.1-alpha.1-dev',
      available: [
        '0.0.1-alpha.2',
        '0.0.1-alpha.2-dev',
      ],
      latestTag: '0.0.1-alpha.2-dev',
    },
    {
      name: 'keeps the variant suffix when a prerelease moves to its release',
      current: '0.0.1-rc.1-dev',
      available: [
        '0.0.1',
        '0.0.1-dev',
      ],
      latestTag: '0.0.1-dev',
    },
  ])('$name', (scenario) => {
    expect(getLatestTag(scenario.current, scenario.available)).toBe(scenario.latestTag);
  });
});

describe('the version a tag stands for', () => {
  it('is looked up among its more specific tags, the most numbers first, newest first', () => {
    const availableTags = [
      '1',
      '1.2',
      '1.2.2',
      '1.10.0',
      '1.2.3',
      '2.0.0',
      '1.3.0-user',
      '1.3.0-rc.1',
      'v1.4.0',
    ];

    expect(listVersionCandidates('1', availableTags)).toStrictEqual([
      '1.10.0',
      '1.2.3',
      '1.2.2',
      '1.2',
    ]);

    expect(listVersionCandidates('latest', availableTags)).toStrictEqual([]);
  });

  it.each([
    {
      tag: 'v1.0.1-user',
      version: '1.0.1',
    },
    {
      tag: '1.3-acme',
      version: '1.3',
    },
    {
      tag: 'v1.0.0-rc.2-user',
      version: '1.0.0-rc.2',
    },
    {
      tag: 'latest',
      version: '',
    },
  ])('is read from $tag as $version', (scenario) => {
    expect(getVersionFromTag(scenario.tag)).toBe(scenario.version);
  });
});
