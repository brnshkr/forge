import {
  $,
  env,
  file,
  write,
} from 'bun';

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { requireEnvironmentValue } from '#src/shared/utils/environment';
import { objectEntries, objectKeys } from '#src/shared/utils/object';
import { createDirectory } from '#tests/support/directory';
import { settleAll } from '#tests/support/promise';

interface InstalledStubs {
  readonly directory: string;
  readonly environment: {
    readonly PATH: string;
  };
  readonly readCalls: () => Promise<string[]>;
}

const STUB_ROOT = path.resolve(import.meta.dirname, '../../.cache/stubs');

/**
 * @rejects {Error}
 */
export const installStubs = async (bodiesByCommand: Readonly<Record<string, string>>): Promise<InstalledStubs> => {
  await mkdir(STUB_ROOT, {
    recursive: true,
  });

  const directory = await createDirectory('stubs-', STUB_ROOT);
  const callLog = path.join(directory, 'calls.log');
  const stubs = objectKeys(bodiesByCommand).map((command) => path.join(directory, command));

  await settleAll(objectEntries(bodiesByCommand).map(async ([command, body]) => write(
    path.join(directory, command),
    `#!/bin/sh\nprintf '%s\\n' "${command} $*" >>'${callLog}'\n${body}\n`,
  )));

  await $`chmod +x ${stubs}`;

  return {
    directory,
    environment: {
      PATH: [
        directory,
        requireEnvironmentValue(env, 'PATH'),
      ].join(path.delimiter),
    },
    readCalls: async (): Promise<string[]> => {
      const calls = file(callLog);

      if (!await calls.exists()) {
        return [];
      }

      const text = await calls.text();

      return text.trimEnd().split('\n');
    },
  };
};
