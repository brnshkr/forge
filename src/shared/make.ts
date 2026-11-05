import { env, fileURLToPath, spawn } from 'bun';
import path from 'node:path';

import { objectFromEntries, readOwnValue } from '#src/shared/utils/object';
import { packageName } from '#src/shared/utils/package-json';
import { readGroup } from '#src/shared/utils/pattern';

import type { StringRecord } from '#src/shared/types/core';

interface MakeRead {
  readonly directory: string;
  readonly stage?: string;
  readonly names: readonly string[];
}

export interface MakeVariableNames<TRequiredName extends string, TOptionalName extends string> {
  readonly required?: readonly TRequiredName[];
  readonly optional?: readonly TOptionalName[];
}

export const SHARED_MAKEFILE = fileURLToPath(import.meta.resolve('@brnshkr/config/conf/Makefile'));
export const FORGE_DIRECTORY = path.resolve(import.meta.dirname, '../..');

const PRINT_GOAL = `_${packageName}-print-variables`;
const MISSING_INCLUDE_NOTICE = `_${packageName}-missing-shared-makefile`;
const PRINT_DEFINED_VARIABLE = '$(if $(filter undefined,$(origin $(NAME))),,$(info $(NAME)=$($(NAME))))';
const createAssignmentPattern = (): RegExp => /^(?<name>[A-Z][\dA-Z_]*)=(?<value>.*)$/gmv;
const createReferencePattern = (): RegExp => /\$\{(?<name>[A-Z][\dA-Z_]*)\}/gv;

export const splitWords = (wordList: string): string[] => wordList.split(' ').filter((word) => word !== '');

/**
 * @throws {Error}
 */
export const readAssignments = (text: string): Record<string, string> => objectFromEntries(
  text.matchAll(createAssignmentPattern()).map((match) => <const>[
    readGroup(match.groups, 'name'),
    readGroup(match.groups, 'value'),
  ]),
);

/**
 * @throws {Error}
 */
export const resolveReferences = (
  value: string,
  assignments: StringRecord,
): string => value.replaceAll(createReferencePattern(), (_match: string, ...captures: unknown[]) => {
  const name = readGroup(<StringRecord>captures.at(-1), 'name');
  const referencedValue = readOwnValue(assignments, name);

  if (referencedValue === undefined) {
    throw new Error(`Variable "${name}" not found.`);
  }

  return resolveReferences(referencedValue, assignments);
});

const createPrintRule = (names: readonly string[]): string => [
  `${PRINT_GOAL}: ; @:$(if $(filter ${SHARED_MAKEFILE},$(MAKEFILE_LIST))`,
  `$(foreach NAME,${names.join(' ')},${PRINT_DEFINED_VARIABLE})`,
  `$(info ${MISSING_INCLUDE_NOTICE}))`,
].join(',');

/**
 * @rejects {Error}
 */
const runMake = async (makeRead: MakeRead, makefileArguments?: readonly string[]): Promise<string> => {
  const makeProcess = spawn([
    'make',
    '-s',
    '--no-print-directory',
    ...makefileArguments ?? [],
    `_BRNSHKR_CONFIG_PATHS=${SHARED_MAKEFILE}`,
    'APP_SERVICE=',
    ...makeRead.stage === undefined ? [] : [`APP_ENV=${makeRead.stage}`],
    '--eval',
    createPrintRule(makeRead.names),
    PRINT_GOAL,
  ], {
    cwd: makeRead.directory,
    env: {
      HOME: env['HOME'],
      PATH: env['PATH'],
    },
    stderr: 'pipe',
  });

  const [standardOutput, standardError, exitCode] = await Promise.all([
    new Response(makeProcess.stdout).text(),
    new Response(makeProcess.stderr).text(),
    makeProcess.exited,
  ]);

  if (exitCode !== 0) {
    const nameList = makeRead.names.map((name) => `"${name}"`).join(', ');

    throw new Error(`Unable to read ${nameList} from make in "${makeRead.directory}": ${standardError.trim()}`);
  }

  return standardOutput;
};

/**
 * @rejects {Error}
 */
export const readMakeAssignments = async (
  directory: string,
  names: readonly string[],
  stage?: string,
): Promise<Record<string, string>> => {
  const makeRead = <const>{
    directory,
    stage,
    names,
  } satisfies MakeRead;

  const includingOutput = await runMake(makeRead);

  const standardOutput = includingOutput.trim() === MISSING_INCLUDE_NOTICE
    ? await runMake(makeRead, [
      '-f',
      SHARED_MAKEFILE,
    ])
    : includingOutput;

  return readAssignments(standardOutput);
};

/**
 * @throws {Error}
 */
export const requireMakeVariable = (assignments: Readonly<Record<string, string>>, name: string): string => {
  const value = readOwnValue(assignments, name);

  if (value === undefined) {
    throw new Error(`Variable "${name}" not found in the shared Makefile.`);
  }

  return value;
};

/**
 * @rejects {Error}
 */
export const readMakeVariables = async <TRequiredName extends string = never, TOptionalName extends string = never>(
  directory: string,
  names: MakeVariableNames<TRequiredName, TOptionalName>,
  stage?: string,
): Promise<Record<TOptionalName | TRequiredName, string>> => {
  const requiredNames = names.required ?? [];
  const optionalNames = names.optional ?? [];

  const assignments = await readMakeAssignments(
    directory,
    [
      ...requiredNames,
      ...optionalNames,
    ],
    stage,
  );

  return objectFromEntries<TOptionalName | TRequiredName, string>([
    ...requiredNames.map((name) => <const>[
      name,
      requireMakeVariable(assignments, name),
    ]),
    ...optionalNames.map((name) => <const>[
      name,
      readOwnValue(assignments, name) ?? '',
    ]),
  ]);
};

/**
 * @rejects {Error}
 */
export const readMakeVariable = async (directory: string, name: string, stage?: string): Promise<string> => {
  const assignments = await readMakeAssignments(directory, [name], stage);

  return requireMakeVariable(assignments, name);
};

/**
 * @rejects {Error}
 */
export const readMakeList = async (directory: string, name: string, stage?: string): Promise<string[]> => {
  const listValue = await readMakeVariable(directory, name, stage);

  return splitWords(listValue);
};
