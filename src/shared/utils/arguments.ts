import { parseArgs } from 'node:util';

import { objectFromEntries } from '#src/shared/utils/object';

import type { ParseArgsOptionDescriptor } from 'node:util';

export const SCRIPT_ARGUMENTS_START = 2;

export const readStringArguments = <TName extends string>(
  argv: readonly string[],
  names: readonly TName[],
): Readonly<Record<TName, string>> => <Record<TName, string>>parseArgs({
  args: [...argv],
  options: objectFromEntries<string, ParseArgsOptionDescriptor>(names.map((name) => <const>[
    name,
    {
      type: 'string',
      default: '',
    },
  ])),
}).values;
