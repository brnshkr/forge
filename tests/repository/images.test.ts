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
import { compileLinearPattern, readGroup } from '#src/shared/utils/pattern';
import { compareText, readRepositoryFile } from '#tests/support/repository';

import type { Maybe, StringRecord } from '#src/shared/types/core';

const ADDITIVE_ARGUMENTS = <const>[
  'EXTRA_APT_PACKAGES',
  'EXTRA_PHP_EXTENSIONS',
];

const IMAGES_WITHOUT_PHP = new Set([
  'forge-bun',
  'forge-bun-app',
]);

const IMAGES_WITHOUT_BUN = new Set([
  'forge-php',
  'forge-php-app',
]);

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
  async (imageTarget) => <const>[imageTarget.name, await readRepositoryFile(imageTarget.dockerfile)],
)));

const IMAGE_NAMES = DOCKERFILES.keys().toArray();

const IMAGE_SCENARIOS = IMAGE_NAMES.map((image) => ({
  image,
}));

const createArgumentDefaultPattern = (name: string): RegExp => compileLinearPattern(
  String.raw`^ARG ${name}=(?:"(?<quoted>[^"]*)"|(?<bare>\S*))$`,
  'mv',
);

const readDockerfile = (image: string): string => {
  const dockerfileText = DOCKERFILES.get(image);

  if (dockerfileText === undefined) {
    throw new Error(`No image target names "${image}".`);
  }

  return dockerfileText;
};

const readArgumentDefault = (image: string, argumentName: string): Maybe<string> => {
  const groups = createArgumentDefaultPattern(argumentName).exec(readDockerfile(image))?.groups;

  if (groups === undefined) {
    return undefined;
  }

  const { bare } = groups;

  return bare ?? readGroup(groups, 'quoted')
    .replaceAll('\\\n', ' ')
    .replaceAll(/\s+/gv, ' ')
    .trim();
};

const resolveArguments = (image: string, text: string): string => text.replaceAll(
  createReferencePattern(),
  (_match: string, ...captures: unknown[]) => {
    const name = readGroup(<StringRecord>captures.at(-1), 'name');
    const value = PINS.get(name) ?? readArgumentDefault(image, name);

    if (value === undefined) {
      throw new Error(`Variable "${name}" not found.`);
    }

    return value;
  },
);

const collectPulledReferences = (image: string): string[] => readDockerfile(image)
  .matchAll(/^FROM (?<reference>\S+@\S+)/gmv)
  .map((match) => resolveArguments(image, readGroup(match.groups, 'reference')))
  .toArray();

const collectStageUsers = (image: string): Map<string, Maybe<string>> => new Map(readDockerfile(image)
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
          lastUser === undefined ? undefined : resolveArguments(image, readGroup(lastUser.groups, 'user')),
        ],
      ];
  }));

const EVERY_DECLARED_ARGUMENT = [
  ...new Set(IMAGE_NAMES.flatMap((image) => readArgumentNames(readDockerfile(image)))),
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
    const declaredNames = new Set(readArgumentNames(readDockerfile(scenario.name)));

    const declaredPins = PIN_NAMES
      .filter((name) => declaredNames.has(name))
      .map((name) => `${name}=${readPinValue(VERSIONS, name)}`);

    expect(scenario.arguments.filter((buildArgument) => isPin(buildArgument)).toSorted(compareText))
      .toStrictEqual(declaredPins);
  });

  it.each(IMAGE_SCENARIOS)('$image takes no default that .env already pins', (scenario) => {
    for (const name of PIN_NAMES) {
      expect(`\n${readDockerfile(scenario.image)}`).not.toContain(`\nARG ${name}=`);
    }
  });
});

describe('the escape hatch', () => {
  it.each(IMAGE_SCENARIOS)('$image adds nothing of its own to what a consumer appends', (scenario) => {
    const additiveArguments = IMAGES_WITHOUT_PHP.has(scenario.image)
      ? ADDITIVE_ARGUMENTS.filter((name) => name !== 'EXTRA_PHP_EXTENSIONS')
      : ADDITIVE_ARGUMENTS;

    for (const name of additiveArguments) {
      expect(readArgumentDefault(scenario.image, name)).toBe('');
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

  it.each(IMAGE_SCENARIOS)('$image pulls nothing that .env does not pin', (scenario) => {
    for (const reference of collectPulledReferences(scenario.image)) {
      expect(PINNED_REFERENCES).toContain(reference);
    }
  });

  it('every pinned image is pulled by some image or run as a tool', () => {
    const pulledReferences = new Set([
      ...IMAGE_NAMES.flatMap((image) => collectPulledReferences(image)),
      ...TOOL_REFERENCES,
    ]);

    expect(PINNED_REFERENCES.filter((reference) => !pulledReferences.has(reference))).toStrictEqual([]);
  });
});

describe('the stages', () => {
  it.each(IMAGE_TARGETS)('$name/$target ends as an unprivileged user', (scenario) => {
    expect(collectStageUsers(scenario.name).get(scenario.target)).toMatch(/^[1-9]\d*:[1-9]\d*$/v);
  });

  it.each(IMAGE_SCENARIOS)('$image has a stage that publishes without a suffix', (scenario) => {
    const unsuffixedTargets = IMAGE_TARGETS.filter((imageTarget) => imageTarget.name === scenario.image
      && imageTarget.suffix === '');

    expect(unsuffixedTargets).toHaveLength(1);
  });
});

describe('the PHP-only images', () => {
  it.each([...IMAGES_WITHOUT_BUN])('$image does not include Bun', (image) => {
    expect(readDockerfile(image)).not.toContain('BUN_VERSION');
    expect(readDockerfile(image)).not.toContain('/usr/local/bin/bun');
  });
});

describe('the combined app image', () => {
  it('ships PHP and Bun in the same runtime family', () => {
    const dockerfileText = readDockerfile('forge-app');

    expect(dockerfileText).toContain('FROM oven/bun:');
    expect(dockerfileText).toContain('FROM dunglas/frankenphp:');
    expect(dockerfileText).toContain('COPY --link --from=bun /usr/local/bin/bun /usr/local/bin/bun');
  });
});

describe('the Bun-only images', () => {
  it.each([...IMAGES_WITHOUT_PHP])('$image does not include PHP', (image) => {
    expect(readDockerfile(image)).not.toMatch(/^FROM (?:dunglas\/frankenphp|php):/mv);
    expect(readDockerfile(image)).not.toContain('PHP_VERSION');
  });
});
