import { env } from 'bun';

import { main } from '#src/bump-tools';
import { VERSION_SOURCES } from '#src/shared/tools/sources';
import { PINS_FILE } from '#src/shared/tools/versions';
import { SCRIPT_ARGUMENTS_START } from '#src/shared/utils/arguments';

process.exitCode = await main(
  process.argv.slice(SCRIPT_ARGUMENTS_START),
  env,
  PINS_FILE,
  VERSION_SOURCES,
);
