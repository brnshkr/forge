import { main } from '#src/check-skip';
import { SCRIPT_ARGUMENTS_START } from '#src/shared/utils/arguments';

process.exitCode = main(process.argv.slice(SCRIPT_ARGUMENTS_START));
