import { main } from '#src/resolve-targets';
import { SCRIPT_ARGUMENTS_START } from '#src/shared/utils/arguments';

process.exitCode = await main(process.argv.slice(SCRIPT_ARGUMENTS_START), process.cwd());
