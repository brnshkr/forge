import path from 'node:path';

import { readAssignments, readMakeVariable } from '#src/shared/make';
import { objectEntries, objectFromEntries } from '#src/shared/utils/object';
import { before } from '#src/shared/utils/string';

import type { Maybe } from '#src/shared/types/core';

export const ENVIRONMENT_FILE = '.env';

const DISABLING_FLAGS = new Set([
  '',
  '0',
  'false',
  'no',
  'off',
]);

const ENABLING_FLAGS = new Set([
  '1',
  'on',
  'true',
  'yes',
]);

/**
 * @rejects {Error}
 */
export const readDotenvFile = async (directory: string): Promise<Maybe<string>> => {
  const dotenv = await readMakeVariable(directory, 'DOTENV');

  if (DISABLING_FLAGS.has(dotenv)) {
    return undefined;
  }

  return ENABLING_FLAGS.has(dotenv) ? ENVIRONMENT_FILE : path.relative(directory, path.resolve(directory, dotenv));
};

export const readPlainValue = (value: string): string => {
  const valueWithoutComment = before(value, /[\t ]#/v).trimEnd();

  return /^(?<quote>["']).*\k<quote>$/sv.test(valueWithoutComment)
    ? valueWithoutComment.slice(1, -1)
    : valueWithoutComment;
};

/**
 * @throws {Error}
 */
export const readPlainAssignments = (text: string): Record<string, string> => objectFromEntries(
  objectEntries(readAssignments(text)).map(([key, value]) => <const>[
    key,
    readPlainValue(value),
  ]),
);
