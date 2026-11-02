import { RegExpParser } from '@eslint-community/regexpp';
import { analyse } from 'scslre';

import { readOwnValue } from '#src/shared/utils/object';

import type { Maybe, StringRecord } from '#src/shared/types/core';

/**
 * @throws {Error}
 */
export const compileLinearPattern = (source: string, flags: string): RegExp => {
  const parser = new RegExpParser();
  const parsedFlags = parser.parseFlags(flags);

  const pattern = parser.parsePattern(source, 0, source.length, {
    unicode: parsedFlags.unicode,
    unicodeSets: parsedFlags.unicodeSets,
  });

  if (analyse({
    pattern,
    flags: parsedFlags,
  }).reports.length > 0) {
    throw new Error(`The pattern "${source}" can backtrack super-linearly.`);
  }

  // eslint-disable-next-line security/detect-non-literal-regexp -- Checked for super-linear backtracking above
  return new RegExp(source, flags);
};

/**
 * @throws {Error}
 */
export const readGroup = (groups: Maybe<StringRecord>, name: string): string => {
  const value = readOwnValue(groups ?? {}, name);

  if (value === undefined) {
    throw new Error(`Group "${name}" not found in the match.`);
  }

  return value;
};
