import { describe, expect, it } from 'vitest';

import { getErrorMessage } from '#src/shared/utils/error';

describe('the error message', () => {
  it.each([
    {
      error: new TypeError('Unexpected token.'),
      message: 'Unexpected token.',
    },
    {
      error: 'Connection refused.',
      message: 'Connection refused.',
    },
    {
      error: undefined,
      message: 'undefined',
    },
    {
      error: 404,
      message: '404',
    },
    {
      error: 12n,
      message: '12n',
    },
    {
      error: {
        code: 'ECONNRESET',
      },
      message: '{\n  code: "ECONNRESET",\n}',
    },
  ])('of $error reads "$message"', (scenario) => {
    expect(getErrorMessage(scenario.error)).toBe(scenario.message);
  });
});
