import { describe, expect, it } from 'vitest';

import { FORGE_DIRECTORY, readAssignments, resolveReferences } from '#src/shared/make';
import { DOCKER_HUB } from '#src/shared/registry';
import { readArgumentNames, readImageTargets } from '#src/shared/release/images';

import {
  createUpstreamReferences,
  parseVersions,
  PIN_NAMES,
  readPinValue,
} from '#src/shared/tools/versions';

import { objectEntries, readOwnValue } from '#src/shared/utils/object';
import { packageName } from '#src/shared/utils/package-json';
import { compileLinearPattern, readGroup } from '#src/shared/utils/pattern';
import { toReference } from '#tests/support/dotenv';
import { compareText, readRepositoryFile } from '#tests/support/repository';

import type { Maybe, StringRecord } from '#src/shared/types/core';

const ADDITIVE_ARGUMENTS = <const>[
  'EXTRA_APT_PACKAGES',
  'EXTRA_PHP_EXTENSIONS',
];

const BUN_DOCKERFILE = 'docker/bun.Dockerfile';
const PHP_DOCKERFILE = 'docker/php.Dockerfile';

const TOOL_IMAGE_NAMES = <const>[
  'BUILDKIT_IMAGE',
  'GITLEAKS_IMAGE',
  'NODE_IMAGE',
  'OSV_SCANNER_IMAGE',
  'SEMGREP_IMAGE',
];

const COMPOSE = await readRepositoryFile('conf/compose.yaml');
const ENVIRONMENT = readAssignments(await readRepositoryFile('.env'));
const VERSIONS = await parseVersions(ENVIRONMENT);
const PINS = new Map<string, string>(PIN_NAMES.map((name) => [name, readPinValue(VERSIONS, name)]));
const IMAGE_TARGETS = await readImageTargets(FORGE_DIRECTORY);
const createStageNamePattern = (): RegExp => /^FROM \S+ AS (?<name>[\w\-]+)$/mv;
const createUserPattern = (): RegExp => /^USER (?<user>\S+)$/gmv;
const createReferencePattern = (): RegExp => /\$\{(?<name>\w+)\}/gv;
const isPin = (buildArgument: string): boolean => PIN_NAMES.some((name) => buildArgument.startsWith(`${name}=`));

const DOCKERFILES = new Map(await Promise.all(IMAGE_TARGETS.map(
  async (imageTarget) => <const>[imageTarget.dockerfile, await readRepositoryFile(imageTarget.dockerfile)],
)));

const DOCKERFILE_PATHS = DOCKERFILES.keys().toArray();

const DOCKERFILE_SCENARIOS = DOCKERFILE_PATHS.map((dockerfile) => ({
  dockerfile,
}));

const createArgumentDefaultPattern = (name: string): RegExp => compileLinearPattern(
  String.raw`^ARG ${name}=(?:"(?<quoted>[^"]*)"|(?<bare>\S*))$`,
  'mv',
);

const readDockerfile = (dockerfile: string): string => {
  const dockerfileText = DOCKERFILES.get(dockerfile);

  if (dockerfileText === undefined) {
    throw new Error(`No image target builds "${dockerfile}".`);
  }

  return dockerfileText;
};

const readArgumentDefault = (dockerfile: string, argumentName: string): Maybe<string> => {
  const groups = createArgumentDefaultPattern(argumentName).exec(readDockerfile(dockerfile))?.groups;

  if (groups === undefined) {
    return undefined;
  }

  const { bare } = groups;

  return bare ?? readGroup(groups, 'quoted')
    .replaceAll('\\\n', ' ')
    .replaceAll(/\s+/gv, ' ')
    .trim();
};

const resolveArguments = (dockerfile: string, text: string): string => text.replaceAll(
  createReferencePattern(),
  (_match: string, ...captures: unknown[]) => {
    const name = readGroup(<StringRecord>captures.at(-1), 'name');
    const value = PINS.get(name) ?? readArgumentDefault(dockerfile, name);

    if (value === undefined) {
      throw new Error(`Variable "${name}" not found.`);
    }

    return value;
  },
);

const collectPulledReferences = (dockerfile: string): string[] => readDockerfile(dockerfile)
  .matchAll(/^FROM (?<reference>\S+@\S+)/gmv)
  .map((match) => resolveArguments(dockerfile, readGroup(match.groups, 'reference')))
  .toArray();

const collectStageUsers = (dockerfile: string): Map<string, Maybe<string>> => new Map(readDockerfile(dockerfile)
  .split(/^(?=FROM )/mv)
  .flatMap((section) => {
    const stageGroups = createStageNamePattern().exec(section)?.groups;

    const lastUser = section
      .matchAll(createUserPattern())
      .toArray()
      .at(-1);

    return stageGroups === undefined
      ? []
      : [
        <const>[
          readGroup(stageGroups, 'name'),
          lastUser === undefined ? undefined : resolveArguments(dockerfile, readGroup(lastUser.groups, 'user')),
        ],
      ];
  }));

const EVERY_DECLARED_ARGUMENT = [
  ...new Set(DOCKERFILE_PATHS.flatMap((dockerfile) => readArgumentNames(readDockerfile(dockerfile)))),
].toSorted(compareText);

describe('build arguments', () => {
  it('compose passes every argument the images declare', () => {
    const passedNames = COMPOSE
      .matchAll(/^ {8}- (?<name>[A-Z][\dA-Z_]*)$/gmv)
      .map((match) => readGroup(match.groups, 'name'))
      .toArray();

    expect(passedNames.toSorted(compareText)).toStrictEqual(EVERY_DECLARED_ARGUMENT);
  });

  it.each(IMAGE_TARGETS)('$name/$target receives every pin its Dockerfile declares, as .env pins it', (scenario) => {
    const declaredNames = new Set(readArgumentNames(readDockerfile(scenario.dockerfile)));

    const declaredPins = PIN_NAMES
      .filter((name) => declaredNames.has(name))
      .map((name) => `${name}=${readPinValue(VERSIONS, name)}`);

    expect(scenario.arguments.filter((buildArgument) => isPin(buildArgument)).toSorted(compareText))
      .toStrictEqual(declaredPins);
  });

  it.each(DOCKERFILE_SCENARIOS)('$dockerfile takes no default that .env already pins', (scenario) => {
    for (const name of PIN_NAMES) {
      expect(`\n${readDockerfile(scenario.dockerfile)}`).not.toContain(`\nARG ${name}=`);
    }
  });
});

describe('the escape hatch', () => {
  it.each(DOCKERFILE_SCENARIOS)('$dockerfile adds nothing of its own to what a consumer appends', (scenario) => {
    const additiveArguments = scenario.dockerfile === BUN_DOCKERFILE
      ? ADDITIVE_ARGUMENTS.filter((name) => name !== 'EXTRA_PHP_EXTENSIONS')
      : ADDITIVE_ARGUMENTS;

    for (const name of additiveArguments) {
      expect(readArgumentDefault(scenario.dockerfile, name)).toBe('');
    }
  });
});

describe('pinned images', () => {
  const PINNED_REFERENCES = objectEntries(createUpstreamReferences(VERSIONS)).map(([name, upstreamReference]) => {
    const host = upstreamReference.registry === DOCKER_HUB ? '' : `${upstreamReference.registry}/`;
    const repository = upstreamReference.repository.replace(/^library\//v, '');

    return `${host}${repository}:${upstreamReference.tag}@${readPinValue(VERSIONS, name)}`;
  });

  const TOOL_REFERENCES = TOOL_IMAGE_NAMES.map((name) => {
    const toolReference = readOwnValue(ENVIRONMENT, name);

    if (toolReference === undefined) {
      throw new Error(`Variable "${name}" not found in ".env".`);
    }

    return resolveReferences(toolReference, ENVIRONMENT);
  });

  it.each(DOCKERFILE_SCENARIOS)('$dockerfile pulls nothing that .env does not pin', (scenario) => {
    for (const reference of collectPulledReferences(scenario.dockerfile)) {
      expect(PINNED_REFERENCES).toContain(reference);
    }
  });

  it('every pinned image is pulled by some image or run as a tool', () => {
    const pulledReferences = new Set([
      ...DOCKERFILE_PATHS.flatMap((dockerfile) => collectPulledReferences(dockerfile)),
      ...TOOL_REFERENCES,
    ]);

    expect(PINNED_REFERENCES.filter((reference) => !pulledReferences.has(reference))).toStrictEqual([]);
  });
});

describe('the stages', () => {
  it.each(IMAGE_TARGETS)('$name/$target ends as an unprivileged user', (scenario) => {
    expect(collectStageUsers(scenario.dockerfile).get(scenario.target)).toMatch(/^[1-9]\d*:[1-9]\d*$/v);
  });

  it.each(IMAGE_TARGETS)('$name/$target publishes under its target as tag suffix', (scenario) => {
    expect(scenario.suffix).toBe(`-${scenario.target}`);
  });
});

describe('the PHP-only images', () => {
  it.each(IMAGE_TARGETS.filter((imageTarget) => imageTarget.name === `${packageName}-php`))(
    '$name/$target builds without Bun',
    (scenario) => {
      expect(scenario.dockerfile).toBe(PHP_DOCKERFILE);
      expect(scenario.arguments).toContain('HAS_BUN=false');
    },
  );
});

describe('the combined images', () => {
  it.each(IMAGE_TARGETS.filter((imageTarget) => imageTarget.name === packageName))(
    '$name/$target builds with Bun',
    (scenario) => {
      expect(scenario.dockerfile).toBe(PHP_DOCKERFILE);
      expect(scenario.arguments).not.toContain('HAS_BUN=false');
    },
  );

  it('copy Bun from its image only where HAS_BUN selects it', () => {
    const dockerfileText = readDockerfile(PHP_DOCKERFILE);

    expect(dockerfileText).toContain('FROM scratch AS bun-false');
    expect(dockerfileText).toContain('COPY --link --from=bun-image /usr/local/bin/bun /usr/local/bin/bun');
    expect(dockerfileText).toContain(`FROM bun-${toReference('HAS_BUN')} AS bun`);
  });
});

describe('the Bun-only images', () => {
  it('build from a Dockerfile without PHP', () => {
    expect(readDockerfile(BUN_DOCKERFILE)).not.toMatch(/^FROM (?:dunglas\/frankenphp|php):/mv);
    expect(readDockerfile(BUN_DOCKERFILE)).not.toContain('PHP_VERSION');
  });
});
