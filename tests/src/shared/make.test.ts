import path from 'node:path';

import {
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest';

import {
  readAssignments,
  readMakeAssignments,
  readMakeList,
  readMakeVariables,
  resolveReferences,
  SHARED_MAKEFILE,
} from '#src/shared/make';

import { objectFromEntries } from '#src/shared/utils/object';
import { createDirectory } from '#tests/support/directory';
import { toReference } from '#tests/support/dotenv';
import { createRepository, writeFiles } from '#tests/support/repository';

const MAKEFILE_NAME = 'Makefile';

const DETECTED_FILES = {
  '.env': '',
  '.env.prod': '',
  'compose.yaml': 'services: {}\n',
};

const DETECTED_NAMES = [
  'COMPOSE_FILES',
  'DOTENV_STAGES',
];

describe('an environment file', () => {
  it('yields every assignment and nothing else', () => {
    expect(readAssignments('A=1\n\n# B=2\nC_D=x=y\nlower=3\n')).toStrictEqual({
      A: '1',
      C_D: 'x=y',
    });
  });
});

describe('a reference in an assignment', () => {
  it('resolves through every assignment it reaches', () => {
    const assignments = {
      ACME_MAJOR: '1',
      ACME_MINOR: `${toReference('ACME_MAJOR')}.2`,
    };

    expect(resolveReferences(`${toReference('ACME_MINOR')}.3`, assignments)).toBe('1.2.3');
  });

  it('fails, naming it, where nothing assigns it', () => {
    expect(() => resolveReferences(toReference('ACME_MINOR'), {}))
      .toThrow('Variable "ACME_MINOR" not found.');
  });
});

describe('an assignment make resolves', () => {
  it('takes what the environment files set, references resolved', async () => {
    const directory = await createRepository({
      '.env': `ACME_VERSION=1.0.0\nACME_IMAGE=acme/user:${toReference('ACME_VERSION')}\n`,
    });

    await expect(readMakeAssignments(directory, ['ACME_IMAGE'])).resolves.toStrictEqual({
      ACME_IMAGE: 'acme/user:1.0.0',
    });
  });

  it('takes the stage it is asked for', async () => {
    const directory = await createRepository({
      '.env': 'ACME_TARGET=dev\n',
      '.env.prod': 'ACME_TARGET=prod\n',
    });

    await expect(readMakeAssignments(directory, ['ACME_TARGET'], 'prod')).resolves.toStrictEqual({
      ACME_TARGET: 'prod',
    });
  });

  it('takes the files over what the environment of this process sets', async () => {
    const directory = await createRepository({
      '.env': 'ACME_TARGET=dev\n',
    });

    vi.stubEnv('ACME_TARGET', 'environment');

    onTestFinished(() => {
      vi.unstubAllEnvs();
    });

    await expect(readMakeAssignments(directory, ['ACME_TARGET'])).resolves.toStrictEqual({
      ACME_TARGET: 'dev',
    });
  });

  it('leaves out what nothing sets, and keeps what is set empty', async () => {
    const directory = await createRepository({
      '.env': 'ACME_SUFFIX=\n',
    });

    const names = [
      'ACME_SUFFIX',
      'ACME_UNSET',
    ];

    await expect(readMakeAssignments(directory, names)).resolves.toStrictEqual({
      ACME_SUFFIX: '',
    });
  });

  it('keeps every line of a multi-line value', async () => {
    const directory = await createRepository({
      [MAKEFILE_NAME]: `include ${SHARED_MAKEFILE}\n\ndefine ACME_EXTENSIONS\n  intl\nACME_ZIP=zip\nendef\n`,
    });

    const names = [
      'ACME_EXTENSIONS',
      'ACME_ZIP',
    ];

    await expect(readMakeAssignments(directory, names)).resolves.toStrictEqual({
      ACME_EXTENSIONS: '  intl\nACME_ZIP=zip',
    });
  });

  it.each([
    {
      name: 'without a Makefile',
      makefiles: new Map<string, string>(),
    },
    {
      name: 'whose Makefile does not include the shared one',
      makefiles: new Map([[MAKEFILE_NAME, 'ACME_STAGES = none\n']]),
    },
  ])('detects the stages and Compose files of a repository $name', async (scenario) => {
    const directory = await createDirectory('forge-');

    await writeFiles(directory, DETECTED_FILES);
    await writeFiles(directory, objectFromEntries(scenario.makefiles));

    await expect(readMakeAssignments(directory, DETECTED_NAMES)).resolves.toStrictEqual({
      COMPOSE_FILES: path.join(directory, 'compose.yaml'),
      DOTENV_STAGES: 'prod',
    });
  });

  it('fails naming the variables where make cannot read the Makefile', async () => {
    const directory = await createRepository({
      '.env.Bad Stage': '',
    });

    await expect(readMakeAssignments(directory, ['ACME_IMAGE'])).rejects.toThrow(
      `Unable to read "ACME_IMAGE" from make in "${directory}": `,
    );
  });
});

describe('a set of variables make resolves', () => {
  it('requires some and turns the unset optional ones empty', async () => {
    const directory = await createRepository({
      '.env': 'ACME_IMAGE=acme/user\n',
    });

    const variables = await readMakeVariables(directory, {
      optional: ['ACME_SUFFIX'],
      required: ['ACME_IMAGE'],
    });

    expect(variables).toStrictEqual({
      ACME_IMAGE: 'acme/user',
      ACME_SUFFIX: '',
    });
  });
});

describe('a list make resolves', () => {
  it('splits into its words', async () => {
    const directory = await createRepository({
      '.env': 'ACME_STAGES=dev  prod\n',
    });

    await expect(readMakeList(directory, 'ACME_STAGES')).resolves.toStrictEqual([
      'dev',
      'prod',
    ]);
  });

  it('fails naming the list where the shared Makefile does not define it', async () => {
    const directory = await createRepository({
      '.env': '',
    });

    await expect(readMakeList(directory, 'ACME_STAGES')).rejects.toThrow(
      'Variable "ACME_STAGES" not found in the shared Makefile.',
    );
  });
});
