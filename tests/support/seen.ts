import { file } from 'bun';

import { objectEntries, objectFromEntries, objectKeys } from '#src/shared/utils/object';

type SeenState = Readonly<Record<string, Readonly<Record<string, string>>>>;

export const readSeenReferences = async (seenFile: string): Promise<Record<string, Set<string>>> => {
  const seenState = <SeenState>(await file(seenFile).json());

  const scopeEntries = objectEntries(seenState)
    .map(([scope, sightings]) => <const>[scope, new Set(objectKeys(sightings))]);

  return objectFromEntries(scopeEntries);
};
