import { inspect } from 'bun';

export const getErrorMessage = (error: unknown): string => {
  if (Error.isError(error)) {
    return error.message;
  }

  return typeof error === 'string' ? error : inspect(error);
};
