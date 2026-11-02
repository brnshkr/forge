import { env } from 'bun';

import { main, NPM_REGISTRY } from '#src/publish-npm';
import { SCRIPT_ARGUMENTS_START } from '#src/shared/utils/arguments';

process.exitCode = await main(process.argv.slice(SCRIPT_ARGUMENTS_START), env, NPM_REGISTRY);
