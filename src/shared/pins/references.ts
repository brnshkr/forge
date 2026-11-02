import { DIGEST_SOURCE } from '#src/shared/pins/digests';
import { VERSION_SOURCE } from '#src/shared/pins/version-tags';
import { DOCKER_HUB } from '#src/shared/registry';
import { compileLinearPattern, readGroup } from '#src/shared/utils/pattern';
import { before } from '#src/shared/utils/string';

import type { RegistryRepository } from '#src/shared/registry';
import type { StringRecord } from '#src/shared/types/core';

export interface PinnedImage {
  readonly reference: string;
  readonly version: string;
}

export interface ImageReference {
  readonly name: string;
  readonly tag: string;
  readonly image: RegistryRepository;
}

export const VERSION_COMMENT_SOURCE = String.raw`(?<comment>[\t ]+#[\t ]*${VERSION_SOURCE}(?=[\t ]|$))?`;

const REFERENCE_SOURCE = String.raw`(?<name>[\w.\-]+(?::\d+)?(?:\/[\w.\-]+)*):(?<tag>\w[\w.\-]*)@${DIGEST_SOURCE}`;
const PIN_END_SOURCE = String.raw`(?<quote>["']?)(?=[\t ]|$)${VERSION_COMMENT_SOURCE}`;
const COMPOSE_PREFIX_SOURCE = String.raw` *(?:-[\t ]+)?(?:image:[\t ]+["']?|(?:path:[\t ]+)?["']?oci:\/\/)`;

const PIN_PATTERN_SOURCES = <const>{
  compose: `^(?<prefix>${COMPOSE_PREFIX_SOURCE})(?<reference>${REFERENCE_SOURCE})${PIN_END_SOURCE}`,
  environment: String.raw`^(?<prefix>[A-Z][\dA-Z_]*_IMAGE=["']?)(?<reference>${REFERENCE_SOURCE})${PIN_END_SOURCE}`,
};

export type PinSyntax = keyof typeof PIN_PATTERN_SOURCES;

/**
 * @throws {Error}
 */
const createPinPattern = (syntax: PinSyntax): RegExp => compileLinearPattern(
  Reflect.get(PIN_PATTERN_SOURCES, syntax),
  'gmv',
);

const parseRegistryRepository = (name: string): RegistryRepository => {
  const nameSegments = name.split('/');
  const firstSegment = before(name, '/');

  const hasRegistry = nameSegments.length > 1
    && (/[.:]/v.test(firstSegment) || firstSegment === 'localhost');

  const repositorySegments = hasRegistry ? nameSegments.slice(1) : nameSegments;
  const registry = hasRegistry ? firstSegment : DOCKER_HUB;
  const libraryPrefix = (registry === DOCKER_HUB && repositorySegments.length === 1) ? 'library/' : '';

  return {
    registry,
    repository: `${libraryPrefix}${repositorySegments.join('/')}`,
  };
};

/**
 * @throws {Error}
 */
export const parseImageReference = (reference: string): ImageReference => {
  const groups = compileLinearPattern(`^${REFERENCE_SOURCE}$`, 'v').exec(reference)?.groups;

  if (groups === undefined) {
    throw new Error(`Image reference "${reference}" must pin a tag and a digest.`);
  }

  const name = readGroup(groups, 'name');

  return {
    name,
    tag: readGroup(groups, 'tag'),
    image: parseRegistryRepository(name),
  };
};

export const formatVersionComment = (version: string): string => (version === '' ? '' : ` # ${version}`);

/**
 * @throws {Error}
 */
export const findPinnedReferences = (text: string, syntax: PinSyntax): string[] => Array.from(
  text.matchAll(createPinPattern(syntax)),
  (match) => readGroup(match.groups, 'reference'),
);

/**
 * @throws {Error}
 */
export const replacePinnedReferences = (
  text: string,
  syntax: PinSyntax,
  replacements: ReadonlyMap<string, PinnedImage>,
): string => text.replaceAll(createPinPattern(syntax), (match: string, ...captures: unknown[]) => {
  const groups = <StringRecord>captures.at(-1);
  const replacement = replacements.get(readGroup(groups, 'reference'));

  if (replacement === undefined) {
    return match;
  }

  const prefix = readGroup(groups, 'prefix');
  const quote = readGroup(groups, 'quote');

  return `${prefix}${replacement.reference}${quote}${formatVersionComment(replacement.version)}`;
});
