import { readOwnValue } from '#src/shared/utils/object';

import type { Maybe, StringRecord } from '#src/shared/types/core';

export type Environment = StringRecord;

export const readEnvironmentValue = (environment: Environment, name: string): Maybe<string> => {
  const value = readOwnValue(environment, name);

  return value === '' ? undefined : value;
};

export const hasEnvironmentValue = (
  environment: Environment,
  name: string,
): boolean => readEnvironmentValue(environment, name) !== undefined;

/**
 * @throws {Error}
 */
export const requireEnvironmentValue = (environment: Environment, name: string): string => {
  const value = readOwnValue(environment, name);

  if (value === undefined) {
    throw new Error(`Environment variable not found: "${name}".`);
  }

  if (value === '') {
    throw new Error(`Environment variable "${name}" must not be empty.`);
  }

  return value;
};
