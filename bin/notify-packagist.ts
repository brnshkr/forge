import { env } from 'bun';

import { main, PACKAGIST_REGISTRY } from '#src/notify-packagist';
import { SCRIPT_ARGUMENTS_START } from '#src/shared/utils/arguments';

process.exitCode = await main(process.argv.slice(SCRIPT_ARGUMENTS_START), env, PACKAGIST_REGISTRY);
