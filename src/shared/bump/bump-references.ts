import { getImageSelection } from '#src/shared/bump/release-age';
import { findPinnedReferences, parseImageReference, replacePinnedReferences } from '#src/shared/pins/references';

import type { Move } from '#src/shared/bump/moves';
import type { ReleaseAge, Sightings } from '#src/shared/bump/release-age';
import type { PinnedFile } from '#src/shared/pins/files';
import type { Registries } from '#src/shared/registry';
import type { Maybe } from '#src/shared/types/core';

export interface BumpContext {
  readonly directory: string;
  readonly dotenvFile: Maybe<string>;
  readonly registries: Registries;
  readonly releaseAge: ReleaseAge;
}

export interface BumpResult {
  readonly files: readonly PinnedFile[];
  readonly sightings: readonly Sightings[];
  readonly moves: readonly Move[];
}

/**
 * @throws {Error}
 */
export const createReferenceMove = (filePath: string, reference: string, bumpedReference: string): Move => {
  const parsedReference = parseImageReference(reference);
  const bumpedTag = parseImageReference(bumpedReference).tag;
  const isSameTag = parsedReference.tag === bumpedTag;

  return {
    from: isSameTag ? reference : parsedReference.tag,
    pin: `${parsedReference.name} in ${filePath}`,
    to: isSameTag ? bumpedReference : bumpedTag,
  };
};

/**
 * @rejects {Error}
 */
export const bumpPinnedReferences = async (
  pinnedFiles: readonly PinnedFile[],
  context: BumpContext,
): Promise<BumpResult> => {
  const references = [
    ...new Set(pinnedFiles.flatMap((pinnedFile) => findPinnedReferences(pinnedFile.text, pinnedFile.syntax))),
  ];

  const imageSelections = await Promise.all(references.map(async (reference) => <const>[
    reference,
    await getImageSelection(reference, context.registries, context.releaseAge),
  ]));

  const replacements = new Map(imageSelections.flatMap(([reference, imageSelection]) => (
    imageSelection.pinnedImage === undefined ? [] : [<const>[reference, imageSelection.pinnedImage]]
  )));

  const moves = pinnedFiles.flatMap((pinnedFile) => {
    const fileReferences = new Set(findPinnedReferences(pinnedFile.text, pinnedFile.syntax));

    return replacements
      .entries()
      .filter(([reference, pinnedImage]) => fileReferences.has(reference) && pinnedImage.reference !== reference)
      .map(([reference, pinnedImage]) => createReferenceMove(pinnedFile.filePath, reference, pinnedImage.reference))
      .toArray();
  });

  return {
    files: pinnedFiles.map((pinnedFile) => ({
      ...pinnedFile,
      text: replacePinnedReferences(pinnedFile.text, pinnedFile.syntax, replacements),
    })),
    sightings: imageSelections.map(([, imageSelection]) => imageSelection.sightings),
    moves,
  };
};
