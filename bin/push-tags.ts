import { env } from 'bun';

import { main } from '#src/push-tags';
import { SCRIPT_ARGUMENTS_START } from '#src/shared/utils/arguments';

process.exitCode = await main(process.argv.slice(SCRIPT_ARGUMENTS_START), env, process.cwd());
