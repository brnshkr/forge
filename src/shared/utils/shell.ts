import { $ } from 'bun';

import { readEnvironmentValue, requireEnvironmentValue } from '#src/shared/utils/environment';

import type { Environment } from '#src/shared/utils/environment';

export type Shell = InstanceType<typeof $.Shell>;

export interface ShellContext {
  readonly directory: string;
  readonly environment: Environment;
}

export interface RemoteContext extends ShellContext {
  readonly remote: string;
  readonly repository: string;
}

export const createShell = (context: ShellContext): Shell => {
  const shell = new $.Shell();

  shell.cwd(context.directory);
  shell.env({ ...context.environment });

  return shell;
};

/**
 * @throws {Error}
 */
export const readRemoteContext = (environment: Environment, directory: string): RemoteContext => ({
  directory,
  environment,
  remote: readEnvironmentValue(environment, 'REMOTE') ?? 'origin',
  repository: requireEnvironmentValue(environment, 'GITHUB_REPOSITORY'),
});

export const createApiFields = (fields: readonly string[]): string[] => fields.flatMap((field) => [
  '-f',
  field,
]);
