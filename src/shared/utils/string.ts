import type { Maybe } from '#src/shared/types/core';

export const before = (text: string, separator: RegExp | string): string => {
  const index = typeof separator === 'string' ? text.indexOf(separator) : text.search(separator);

  return index === -1 ? text : text.slice(0, index);
};

export const parseSeconds = (text: string): Maybe<number> => (/^\d+$/v.test(text)
  ? Number(text)
  : undefined);
