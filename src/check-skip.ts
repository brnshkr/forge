import { readSkippedNames } from '#src/shared/release/skip';
import { readStringArguments } from '#src/shared/utils/arguments';

/**
 * @throws {Error}
 */
export const main = (argv: readonly string[]): number => {
  const options = readStringArguments(argv, ['skip']);

  readSkippedNames(options.skip);

  return 0;
};
