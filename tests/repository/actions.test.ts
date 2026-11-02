import { describe, expect, it } from 'vitest';

import { readGroup } from '#src/shared/utils/pattern';
import { compareText, listRepositoryFiles, readRepositoryFile } from '#tests/support/repository';

const WORKFLOW_FILES = await listRepositoryFiles('.github/**/*.yaml');

const ACTIONS_OUR_ACTIONS_CALL = [
  'actions/cache@*',
  'aquasecurity/setup-trivy@*',
];

const REUSABLE_WORKFLOWS = WORKFLOW_FILES
  .filter((workflowFile) => workflowFile.startsWith('.github/workflows/'))
  .map((workflowFile) => `brnshkr/forge/${workflowFile}@*`);

const sortActions = (actions: readonly string[]): string[] => actions.toSorted(compareText);

const readUsedActions = async (): Promise<string[]> => {
  const workflowTexts = await Promise.all(WORKFLOW_FILES.map(async (workflowFile) => readRepositoryFile(workflowFile)));

  const usedActions = workflowTexts.flatMap((workflowText) => Array.from(
    workflowText.matchAll(/uses: (?<action>[\w\-]+\/[\w\-.\/]+)@[\da-f]{40} /gv),
    (match) => `${readGroup(match.groups, 'action')}@*`,
  ));

  return sortActions([
    ...new Set([
      ...usedActions,
      ...ACTIONS_OUR_ACTIONS_CALL,
      ...REUSABLE_WORKFLOWS,
    ]),
  ]);
};

const readAllowedActions = async (): Promise<string[]> => {
  const githubDocumentation = await readRepositoryFile('docs/github/setup.md');
  const allowedListMatch = /^(?<list>(?:[\w\-]+\/[\w\-.\/]+@\*, )*[\w\-]+\/[\w\-.\/]+@\*)$/mv.exec(githubDocumentation);

  return sortActions(readGroup(allowedListMatch?.groups, 'list').split(', '));
};

describe('the allowed actions in the GitHub docs', () => {
  it('list every reusable workflow and every action a workflow uses', async () => {
    await expect(readAllowedActions()).resolves.toStrictEqual(await readUsedActions());
  });
});

describe('the release source guard', () => {
  it('allows only dev and hotfix branches into release branches', async () => {
    const workflow = await readRepositoryFile('.github/workflows/check.yaml');
    const releaseSourceStep = /- name: Check Release Source[\s\S]*?(?=\n {6}- name:)/v.exec(workflow)?.[0];

    expect(releaseSourceStep).toContain([
      'if: $',
      '{{ startsWith(github.base_ref, \'release/\') }}',
    ].join(''));

    expect(releaseSourceStep).toContain('dev/* | hotfix/*');
    expect(releaseSourceStep).toContain('exit 1');
  });
});
