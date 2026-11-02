import { file, Glob } from 'bun';
import path from 'node:path';

import { createReferenceMove } from '#src/shared/bump/bump-references';
import { getImageSelection } from '#src/shared/bump/release-age';

import {
  FORGE_DIRECTORY,
  readAssignments,
  readMakeAssignments,
  requireMakeVariable,
} from '#src/shared/make';

import { readDigest } from '#src/shared/pins/digests';
import { readPlainAssignments } from '#src/shared/pins/dotenv';
import { readDotenvText } from '#src/shared/pins/files';
import { parseImageReference } from '#src/shared/pins/references';

import {
  createSplitReference,
  findSplitPins,
  getForgeRepositoryOwner,
  readRepositoryDefaults,
  replaceAssignment,
} from '#src/shared/pins/split-pins';

import { readOwnValue } from '#src/shared/utils/object';

import type { BumpContext, BumpResult } from '#src/shared/bump/bump-references';
import type { Sightings } from '#src/shared/bump/release-age';
import type { PinnedFile } from '#src/shared/pins/files';
import type { PinnedImage } from '#src/shared/pins/references';
import type { SplitDefaults, SplitPin } from '#src/shared/pins/split-pins';

interface FoundSplitPin {
  readonly environmentFile: PinnedFile;
  readonly pin: SplitPin;
}

interface BumpedSplitPin {
  readonly bumpedImage: PinnedImage;
  readonly digest: string;
  readonly filePath: string;
  readonly pin: SplitPin;
  readonly reference: string;
  readonly tag: string;
  readonly tagFilePath: string;
  readonly tagKey: string;
}

interface SplitPinSelection {
  readonly bumpedPin?: BumpedSplitPin;
  readonly sightings: Sightings;
}

interface SplitBumpContext extends BumpContext {
  readonly splitDefaults: SplitDefaults;
}

const FRAGMENT_DIRECTORY = path.join(FORGE_DIRECTORY, 'compose');

/**
 * @rejects {Error}
 * @rejects {ENOTDIR}
 */
const readSplitDefaults = async (directory: string): Promise<SplitDefaults> => {
  const fragmentFiles = await Array.fromAsync(new Glob('*.yaml').scan({
    absolute: true,
    cwd: FRAGMENT_DIRECTORY,
  }));

  const [fragmentTexts, assignments] = await Promise.all([
    Promise.all(fragmentFiles.map(async (fragmentFile) => file(fragmentFile).text())),
    readMakeAssignments(directory, [
      'FORGE_REPOSITORY',
      'FORGE_REPOSITORY_OWNER',
    ]),
  ]);

  const forgeRepository = requireMakeVariable(assignments, 'FORGE_REPOSITORY');

  const forgeRepositoryOwner = readOwnValue(assignments, 'FORGE_REPOSITORY_OWNER')
    ?? getForgeRepositoryOwner(forgeRepository);

  return {
    forgeRepository,
    forgeRepositoryOwner,
    repositories: readRepositoryDefaults(fragmentTexts, forgeRepositoryOwner),
  };
};

/**
 * @rejects {Error}
 */
const bumpSplitPin = async (
  foundPin: FoundSplitPin,
  dotenvText: string,
  context: SplitBumpContext,
): Promise<SplitPinSelection> => {
  const environmentText = foundPin.environmentFile.text;

  const layeredValues = {
    ...readPlainAssignments(dotenvText),
    ...readPlainAssignments(environmentText),
  };

  const splitReference = createSplitReference(foundPin.pin, layeredValues, context.splitDefaults);
  const imageSelection = await getImageSelection(splitReference.reference, context.registries, context.releaseAge);
  const bumpedImage = imageSelection.pinnedImage;

  if (bumpedImage === undefined) {
    return {
      sightings: imageSelection.sightings,
    };
  }

  const { tag } = parseImageReference(bumpedImage.reference);
  const isTagInEnvironmentFile = Object.hasOwn(readAssignments(environmentText), splitReference.tagKey);
  const defaultTagFilePath = context.dotenvFile ?? foundPin.environmentFile.filePath;

  return {
    bumpedPin: {
      bumpedImage,
      digest: readDigest(bumpedImage.reference),
      filePath: foundPin.environmentFile.filePath,
      pin: foundPin.pin,
      reference: splitReference.reference,
      tag: tag.slice(0, tag.length - splitReference.suffix.length),
      tagFilePath: isTagInEnvironmentFile ? foundPin.environmentFile.filePath : defaultTagFilePath,
      tagKey: splitReference.tagKey,
    },
    sightings: imageSelection.sightings,
  };
};

/**
 * @throws {Error}
 */
const replaceSplitPins = (
  pinnedFiles: readonly PinnedFile[],
  bumpedPins: readonly BumpedSplitPin[],
): PinnedFile[] => pinnedFiles.map((pinnedFile) => {
  let rewrittenText = pinnedFile.text;

  for (const bumpedPin of bumpedPins) {
    if (bumpedPin.filePath === pinnedFile.filePath) {
      rewrittenText = replaceAssignment(
        rewrittenText,
        bumpedPin.pin.digestKey,
        bumpedPin.digest,
        bumpedPin.bumpedImage.version,
      );
    }

    if (bumpedPin.tagFilePath === pinnedFile.filePath) {
      rewrittenText = replaceAssignment(rewrittenText, bumpedPin.tagKey, bumpedPin.tag);
    }
  }

  return {
    ...pinnedFile,
    text: rewrittenText,
  };
});

/**
 * @throws {Error}
 */
const findSplitPinsIn = (pinnedFiles: readonly PinnedFile[]): FoundSplitPin[] => pinnedFiles
  .filter((pinnedFile) => pinnedFile.syntax === 'environment')
  .flatMap((environmentFile) => findSplitPins(environmentFile.text).map((pin) => ({
    environmentFile,
    pin,
  })));

/**
 * @rejects {Error}
 */
const bumpSplitPinsOfKind = async (
  pinnedFiles: readonly PinnedFile[],
  kind: SplitPin['kind'],
  context: SplitBumpContext,
): Promise<BumpResult> => {
  const dotenvText = readDotenvText(pinnedFiles, context.dotenvFile);

  const selections = await Promise.all(findSplitPinsIn(pinnedFiles)
    .filter((foundPin) => foundPin.pin.kind === kind)
    .map(async (foundPin) => bumpSplitPin(foundPin, dotenvText, context)));

  const bumpedPins = selections
    .flatMap((selection) => (selection.bumpedPin === undefined ? [] : [selection.bumpedPin]));

  return {
    files: replaceSplitPins(pinnedFiles, bumpedPins),
    moves: bumpedPins
      .filter((bumpedPin) => bumpedPin.bumpedImage.reference !== bumpedPin.reference)
      .map((bumpedPin) => createReferenceMove(
        bumpedPin.filePath,
        bumpedPin.reference,
        bumpedPin.bumpedImage.reference,
      )),
    sightings: selections.map((selection) => selection.sightings),
  };
};

/**
 * @rejects {Error}
 * @rejects {ENOTDIR}
 */
export const bumpSplitPins = async (pinnedFiles: readonly PinnedFile[], context: BumpContext): Promise<BumpResult> => {
  if (findSplitPinsIn(pinnedFiles).length === 0) {
    return {
      files: pinnedFiles,
      moves: [],
      sightings: [],
    };
  }

  const splitContext = <const>{
    ...context,
    splitDefaults: await readSplitDefaults(context.directory),
  } satisfies SplitBumpContext;

  const imageBump = await bumpSplitPinsOfKind(pinnedFiles, 'image', splitContext);
  const fragmentBump = await bumpSplitPinsOfKind(imageBump.files, 'fragment', splitContext);

  return {
    files: fragmentBump.files,
    moves: [
      ...imageBump.moves,
      ...fragmentBump.moves,
    ],
    sightings: [
      ...imageBump.sightings,
      ...fragmentBump.sightings,
    ],
  };
};
