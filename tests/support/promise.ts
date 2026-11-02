import { readRejectionMessages } from '#src/shared/utils/promise';

/**
 * @rejects {Error}
 */
export const settleAll = async (sideEffects: readonly Promise<unknown>[]): Promise<void> => {
  const results = await Promise.allSettled(sideEffects);
  const issues = readRejectionMessages(results);

  if (issues.length > 0) {
    throw new Error(issues.join('\n'));
  }
};
