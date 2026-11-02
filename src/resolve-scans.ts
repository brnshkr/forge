import { getImageName, readImageTargets } from '#src/shared/release/images';
import { createWidestImageTag, findNewestRelease, listVersionTags } from '#src/shared/release/versions';
import { readStringArguments } from '#src/shared/utils/arguments';
import { createShell } from '#src/shared/utils/shell';

import type { ReleaseVersion } from '#src/shared/release/versions';
import type { Maybe } from '#src/shared/types/core';
import type { Environment } from '#src/shared/utils/environment';
import type { Shell } from '#src/shared/utils/shell';

/**
 * @rejects {Error}
 */
const readNewestRelease = async (shell: Shell): Promise<Maybe<ReleaseVersion>> => {
  const versionTags = await listVersionTags(shell);

  return findNewestRelease(versionTags);
};

/**
 * @rejects {Error}
 * @rejects {ENOTDIR}
 */
export const main = async (argv: readonly string[], environment: Environment, directory: string): Promise<number> => {
  const options = readStringArguments(argv, [
    'namespace',
    'registry',
  ]);

  const shell = createShell({
    directory,
    environment,
  });

  const [releaseVersion, imageTargets] = await Promise.all([
    readNewestRelease(shell),
    readImageTargets(directory),
  ]);

  const scanReferences = releaseVersion === undefined
    ? []
    : imageTargets.map((imageTarget) => createWidestImageTag({
      image: getImageName(options, imageTarget),
      suffix: imageTarget.suffix,
      version: releaseVersion,
    }));

  process.stdout.write(`${JSON.stringify(scanReferences)}\n`);

  return 0;
};
