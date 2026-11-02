import { splitWords } from '#src/shared/make';
import { readDeployTargets } from '#src/shared/release/deploys';
import { getImageName, readImageTargetsByStage } from '#src/shared/release/images';
import { findManifestIssues, readManifests, readPackageTargets } from '#src/shared/release/manifests';

import {
  createGitTags,
  createImageTags,
  createMergeTargets,
  formatVersion,
  getDistributionTag,
  parseBranchVersion,
  readFragmentFiles,
} from '#src/shared/release/versions';

import { readStringArguments } from '#src/shared/utils/arguments';
import { objectEntries } from '#src/shared/utils/object';

import type { DeployTarget } from '#src/shared/release/deploys';
import type { ImageLocation, ImageTarget } from '#src/shared/release/images';
import type { ReleaseVersion } from '#src/shared/release/versions';
import type { Maybe } from '#src/shared/types/core';

const OWN_JOB_TARGETS = new Set([
  'production',
  'testing',
]);

interface BuildTargets {
  readonly deployTargets: Readonly<Record<string, DeployTarget>>;
  readonly imageTargets: readonly ImageTarget[];
}

interface StagingOutput extends DeployTarget {
  readonly target: string;
}

interface VersionOutputs {
  readonly createTags: (imageTarget: ImageTarget) => readonly string[];
  readonly release: {
    readonly distributionTag: string;
    readonly gitTags: string;
    readonly isPrerelease: boolean;
    readonly mergeTargets: string;
    readonly version: string;
  };
}

const createVersionOutputs = (
  version: Maybe<ReleaseVersion>,
  location: ImageLocation,
  isPackagistPackage: boolean,
): VersionOutputs => (version === undefined
  ? {
    createTags: () => [],
    release: {
      distributionTag: '',
      gitTags: '',
      isPrerelease: false,
      mergeTargets: '',
      version: '',
    },
  }
  : {
    createTags: (imageTarget) => createImageTags({
      aliases: imageTarget.aliases,
      image: getImageName(location, imageTarget),
      suffix: imageTarget.suffix,
      version,
    }),
    release: {
      distributionTag: getDistributionTag(version),
      gitTags: createGitTags({
        isPackagistPackage,
        version,
      }).join(' '),
      isPrerelease: version.prerelease !== undefined,
      mergeTargets: createMergeTargets(version).join(' '),
      version: formatVersion(version),
    },
  });

const createStagingOutputs = (
  deployTargets: Readonly<Record<string, DeployTarget>>,
): StagingOutput[] => objectEntries(deployTargets)
  .filter(([target]) => !OWN_JOB_TARGETS.has(target))
  .map(([target, deployTarget]) => ({
    ...deployTarget,
    target,
  }));

/**
 * @rejects {Error}
 */
const readBuildTargets = async (directory: string, chosenDeployTargets: readonly string[]): Promise<BuildTargets> => {
  const imageTargetsByStage = await readImageTargetsByStage(directory);

  return {
    deployTargets: await readDeployTargets(directory, imageTargetsByStage, chosenDeployTargets),
    imageTargets: imageTargetsByStage.values().toArray(),
  };
};

/**
 * @rejects {Error}
 * @rejects {ENOTDIR}
 * @rejects {SyntaxError}
 */
export const main = async (argv: readonly string[], directory: string): Promise<number> => {
  const options = readStringArguments(argv, [
    'deploy-targets',
    'namespace',
    'reference',
    'registry',
  ]);

  const [
    branchVersion,
    manifests,
    buildTargets,
    fragmentFiles,
  ] = await Promise.all([
    parseBranchVersion(options.reference),
    readManifests(directory),
    readBuildTargets(directory, splitWords(options['deploy-targets'])),
    readFragmentFiles(directory),
  ]);

  const manifestIssues = findManifestIssues(manifests);

  if (manifestIssues.length > 0) {
    process.stderr.write(`${manifestIssues.join('\n')}\n`);

    return 1;
  }

  const packageTargets = readPackageTargets(manifests);

  const versionOutputs = createVersionOutputs(
    branchVersion?.kind === 'release' ? branchVersion : undefined,
    options,
    packageTargets.packagist !== '',
  );

  const imageOutputs = buildTargets.imageTargets.map((imageTarget) => ({
    arguments: imageTarget.arguments.join('\n'),
    dockerfile: imageTarget.dockerfile,
    name: imageTarget.name,
    tags: versionOutputs.createTags(imageTarget).join('\n'),
    target: imageTarget.target,
  }));

  const releaseOutput = {
    fragments: fragmentFiles.join(' '),
    ...versionOutputs.release,
    ...packageTargets,
  };

  process.stdout.write([
    `deploy=${JSON.stringify(buildTargets.deployTargets)}`,
    `images=${JSON.stringify(imageOutputs)}`,
    `release=${JSON.stringify(releaseOutput)}`,
    `staging=${JSON.stringify(createStagingOutputs(buildTargets.deployTargets))}`,
    '',
  ].join('\n'));

  return 0;
};
