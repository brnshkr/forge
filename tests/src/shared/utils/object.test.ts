import { describe, expect, it } from 'vitest';

import {
  isPlainObject,
  objectEntries,
  objectKeys,
  readOwnValue,
  writeOwnValue,
} from '#src/shared/utils/object';

describe('the keys and entries of an object', () => {
  it('come from a map in its order', () => {
    const map = new Map([
      ['acme', 'first'],
      ['beta', 'second'],
    ]);

    expect({
      entries: objectEntries(map),
      keys: objectKeys(map),
    }).toStrictEqual({
      entries: [
        ['acme', 'first'],
        ['beta', 'second'],
      ],
      keys: [
        'acme',
        'beta',
      ],
    });
  });

  it('come from an object\'s own enumerable keys', () => {
    const object = {
      acme: 'first',
      beta: 'second',
    };

    expect({
      entries: objectEntries(object),
      keys: objectKeys(object),
    }).toStrictEqual({
      entries: [
        ['acme', 'first'],
        ['beta', 'second'],
      ],
      keys: [
        'acme',
        'beta',
      ],
    });
  });
});

describe('an own value', () => {
  it('is read from a map', () => {
    expect(readOwnValue(new Map([['acme', 'first']]), 'acme')).toBe('first');
  });

  it('is read from an object, never from its prototype', () => {
    const object = <Record<string, unknown>>Object.create({ inherited: 'first' });

    writeOwnValue(object, 'acme', 'second');

    expect({
      acme: readOwnValue(object, 'acme'),
      inherited: readOwnValue(object, 'inherited'),
    }).toStrictEqual({
      acme: 'second',
      inherited: undefined,
    });
  });

  it('is written into a map', () => {
    const map = new Map<string, string>();

    writeOwnValue(map, 'acme', 'first');

    expect(map.get('acme')).toBe('first');
  });

  it('is written into an object as an enumerable property', () => {
    const object = <Record<string, string>>{};

    writeOwnValue(object, 'acme', 'first');

    expect(objectKeys(object)).toStrictEqual(['acme']);
  });
});

describe('a plain object', () => {
  it.each([
    {
      name: 'is an object literal',
      value: {},
      isPlain: true,
    },
    {
      name: 'is an object without a prototype',
      value: <unknown>Object.create(null),
      isPlain: true,
    },
    {
      name: 'is no array',
      value: [],
      isPlain: false,
    },
    {
      name: 'is no instance of a class',
      value: new Date(0),
      isPlain: false,
    },
    {
      name: 'is no null',
      value: JSON.parse('null'),
      isPlain: false,
    },
    {
      name: 'is no string',
      value: 'acme',
      isPlain: false,
    },
  ])('$name', (scenario) => {
    expect(isPlainObject(scenario.value)).toBe(scenario.isPlain);
  });
});
