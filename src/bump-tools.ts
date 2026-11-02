import { file } from 'bun';
import path from 'node:path';

import { readMoveFormat, writeMoves } from '#src/shared/bump/moves';
import { readMinimumReleaseAge, readReleaseAge, writeSightings } from '#src/shared/bump/release-age';
import { readAssignments, resolveReferences } from '#src/shared/make';
import { writeChangedFiles } from '#src/shared/pins/files';
import { createGatedPins, getGatedSelection } from '#src/shared/tools/gates';
import { resolveVersions } from '#src/shared/tools/sources';

import {
  getVersionsWithMinors,
  parseVersions,
  PIN_NAMES,
  readPinValue,
  requireAssignment,
} from '#src/shared/tools/versions';

import { readStringArguments } from '#src/shared/utils/arguments';
import { readEnvironmentValue } from '#src/shared/utils/environment';
import { objectEntries, objectFromEntries } from '#src/shared/utils/object';
import { before } from '#src/shared/utils/string';

import type { ReleaseAge, Sightings } from '#src/shared/bump/release-age';
import type { SourceContext, VersionSources } from '#src/shared/tools/sources';
import type { PinName, Versions } from '#src/shared/tools/versions';
import type { Environment } from '#src/shared/utils/environment';

interface ToolBump {
  readonly sightings: readonly Sightings[];
  readonly versions: Versions;
}

const RELEASE_AGE_SCOPE = 'bump-tools';

/**
 * @throws {Error}
 */
const formatPinAssignment = (
  name: PinName,
  bumpedPin: string,
  assignments: Readonly<Record<string, string>>,
): string => {
  const value = requireAssignment(assignments, name);
  const referencedPrefix = value.slice(0, value.lastIndexOf('}') + 1);
  const resolvedPrefix = resolveReferences(referencedPrefix, assignments);

  if (!bumpedPin.startsWith(resolvedPrefix)) {
    throw new Error(
      `Bumped value "${bumpedPin}" of "${name}" must start with "${referencedPrefix}".`,
    );
  }

  return `${name}=${referencedPrefix}${bumpedPin.slice(resolvedPrefix.length)}`;
};

/**
 * @throws {Error}
 */
const rewritePins = (pinsText: string, changedNames: readonly PinName[], bumpedVersions: Versions): string => {
  const assignments = readAssignments(pinsText);

  return pinsText
    .split('\n')
    .map((line) => {
      const changedName = changedNames.find((name) => name === before(line, '='));

      return changedName === undefined
        ? line
        : formatPinAssignment(changedName, readPinValue(bumpedVersions, changedName), assignments);
    })
    .join('\n');
};

/**
 * @rejects {Error}
 */
const bumpVersions = async (
  pinnedVersions: Versions,
  sourceContext: SourceContext,
  releaseAge: ReleaseAge,
): Promise<ToolBump> => {
  const gatedPins = await createGatedPins({
    ...sourceContext,
    candidateVersions: await resolveVersions(pinnedVersions, sourceContext),
    pinnedVersions,
  });

  const selections = await Promise.all(gatedPins.map(async (gatedPin) => getGatedSelection(
    gatedPin,
    pinnedVersions,
    releaseAge,
  )));

  return {
    sightings: selections.map((selection) => selection.sightings),
    versions: getVersionsWithMinors({
      ...pinnedVersions,
      ...objectFromEntries(selections.flatMap((selection) => objectEntries(selection.versions))),
    }),
  };
};

/**
 * @rejects {Error}
 */
const writePins = async (
  pinsFile: string,
  pinsText: string,
  changedNames: readonly PinName[],
  bumpedVersions: Versions,
): Promise<string[]> => {
  const pinsFiles = <const>[
    {
      filePath: path.basename(pinsFile),
      syntax: 'environment',
      text: pinsText,
    },
  ];

  const bumpedPinsFiles = pinsFiles.map((pinsFileEntry) => ({
    ...pinsFileEntry,
    text: rewritePins(pinsText, changedNames, bumpedVersions),
  }));

  return writeChangedFiles(pinsFiles, bumpedPinsFiles, path.dirname(pinsFile));
};

/**
 * @rejects {Error}
 */
export const main = async (
  argv: readonly string[],
  environment: Environment,
  pinsFile: string,
  sources: VersionSources,
): Promise<number> => {
  const options = readStringArguments(argv, [
    'format',
    'seen-file',
  ]);

  const format = readMoveFormat(options.format);
  const pinsText = await file(pinsFile).text();
  const pinnedVersions = await parseVersions(readAssignments(pinsText));

  const sourceContext = <const>{
    gitHubToken: readEnvironmentValue(environment, 'GITHUB_TOKEN'),
    sources,
  } satisfies SourceContext;

  const releaseAge = await readReleaseAge(
    options['seen-file'],
    RELEASE_AGE_SCOPE,
    readMinimumReleaseAge(pinsText, environment),
  );

  const toolBump = await bumpVersions(pinnedVersions, sourceContext, releaseAge);

  const changedNames = PIN_NAMES
    .filter((name) => readPinValue(toolBump.versions, name) !== readPinValue(pinnedVersions, name));

  const writeIssues = await writePins(
    pinsFile,
    pinsText,
    changedNames,
    toolBump.versions,
  );

  await writeSightings(toolBump.sightings, releaseAge);

  if (writeIssues.length > 0) {
    process.stderr.write(`${writeIssues.join('\n')}\n`);

    return 1;
  }

  const moves = changedNames.map((name) => ({
    from: readPinValue(pinnedVersions, name),
    pin: name,
    to: readPinValue(toolBump.versions, name),
  }));

  writeMoves(moves, format);

  return 0;
};
