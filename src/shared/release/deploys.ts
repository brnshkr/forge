import { readMakeList, readMakeVariables } from '#src/shared/make';
import { objectFromEntries } from '#src/shared/utils/object';

import type { ImageTarget } from '#src/shared/release/images';

export interface DeployTarget {
  readonly digestKey: string;
}

interface StageDeploy {
  readonly hosts: string;
  readonly imageStage: string;
  readonly stage: string;
}

/**
 * @rejects {Error}
 */
const readStageDeploy = async (directory: string, stage: string): Promise<StageDeploy> => {
  const stageVariables = await readMakeVariables(
    directory,
    {
      optional: [
        'DEPLOY_HOSTS',
        'DEPLOY_IMAGE',
      ],
    },
    stage,
  );

  return {
    hosts: stageVariables.DEPLOY_HOSTS,
    imageStage: stageVariables.DEPLOY_IMAGE === '' ? stage : stageVariables.DEPLOY_IMAGE,
    stage,
  };
};

/**
 * @throws {Error}
 */
const createDeployTarget = (
  imageTargetsByStage: ReadonlyMap<string, ImageTarget>,
  stageDeploy: StageDeploy,
): DeployTarget => {
  const imageTarget = imageTargetsByStage.get(stageDeploy.imageStage);

  if (imageTarget === undefined) {
    throw new Error(
      `Stage "${stageDeploy.imageStage}" sets no "IMAGE_NAME", so "${stageDeploy.stage}" has no image to deploy.`,
    );
  }

  return {
    digestKey: `${imageTarget.name}-${imageTarget.target}`,
  };
};

/**
 * @rejects {Error}
 */
export const readDeployTargets = async (
  directory: string,
  imageTargetsByStage: ReadonlyMap<string, ImageTarget>,
  chosenTargets: readonly string[],
): Promise<Record<string, DeployTarget>> => {
  const stages = await readMakeList(directory, 'DOTENV_STAGES');
  const unknownTargets = chosenTargets.filter((target) => !stages.includes(target));

  if (unknownTargets.length > 0) {
    throw new Error(unknownTargets.map((target) => `Unknown deploy target "${target}".`).join('\n'));
  }

  const stageDeploys = await Promise.all(stages.map(async (stage) => readStageDeploy(directory, stage)));

  const deployingStages = stageDeploys.filter((stageDeploy) => (chosenTargets.length > 0
    ? chosenTargets.includes(stageDeploy.stage)
    : stageDeploy.hosts !== ''));

  return objectFromEntries(deployingStages.map((stageDeploy) => <const>[
    stageDeploy.stage,
    createDeployTarget(imageTargetsByStage, stageDeploy),
  ]));
};
