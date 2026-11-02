import { describe, expect, it } from 'vitest';

import { readEnvironmentValue, requireEnvironmentValue } from '#src/shared/utils/environment';

describe('an environment value', () => {
  it.each([
    {
      name: 'is what the environment sets',
      environment: {
        ACME_TOKEN: 'secret',
      },
      value: 'secret',
    },
    {
      name: 'is none where the environment sets it empty',
      environment: {
        ACME_TOKEN: '',
      },
      value: undefined,
    },
    {
      name: 'is none where the environment does not set it',
      environment: {},
      value: undefined,
    },
  ])('$name', (scenario) => {
    expect(readEnvironmentValue(scenario.environment, 'ACME_TOKEN')).toBe(scenario.value);
  });

  it.each([
    {
      name: 'nothing sets it',
      environment: {},
      message: 'Environment variable not found: "ACME_TOKEN".',
    },
    {
      name: 'the environment sets it empty',
      environment: {
        ACME_TOKEN: '',
      },
      message: 'Environment variable "ACME_TOKEN" must not be empty.',
    },
  ])('is required, naming it, where $name', (scenario) => {
    expect(() => requireEnvironmentValue(scenario.environment, 'ACME_TOKEN')).toThrow(scenario.message);
  });
});
