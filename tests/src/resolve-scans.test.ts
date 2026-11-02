import { describe, expect, it } from 'vitest';

import { main } from '#src/resolve-scans';
import { GHCR } from '#src/shared/registry';
import { commit, git, GIT_ENVIRONMENT } from '#tests/support/git';
import { captureWrites } from '#tests/support/output';
import { settleAll } from '#tests/support/promise';
import { createRepository } from '#tests/support/repository';

const REPOSITORY_FILES = {
  '.env': '',
  '.env.dev': 'IMAGE_NAME=acme-user\nIMAGE_TARGET=dev\nIMAGE_SUFFIX=-dev\n',
  '.env.prod': 'IMAGE_NAME=acme-user\nIMAGE_TARGET=prod\nIMAGE_ALIASES=latest\n',
  'docker/acme-user.Dockerfile': 'FROM acme/base\n',
};

const ARGV = [
  '--namespace=acme',
  `--registry=${GHCR}`,
];

describe('the resolve-scans script', () => {
  it.each([
    {
      name: 'the images of the newest stable release at their widest tag',
      tags: [
        'v1',
        'v1.2',
        'v1.2.3',
        'v1.1.0',
        'v1.3.0-rc.1',
      ],
      references: [
        `${GHCR}/acme/acme-user:1-dev`,
        `${GHCR}/acme/acme-user:1`,
      ],
    },
    {
      name: 'the minor of a stable release below 1.0.0',
      tags: ['v0.2.3'],
      references: [
        `${GHCR}/acme/acme-user:0.2-dev`,
        `${GHCR}/acme/acme-user:0.2`,
      ],
    },
    {
      name: 'the newest prerelease at its own tag where no release is stable',
      tags: [
        'v1.0.0-alpha.1',
        'v1.0.0-beta.1',
      ],
      references: [
        `${GHCR}/acme/acme-user:1.0.0-beta.1-dev`,
        `${GHCR}/acme/acme-user:1.0.0-beta.1`,
      ],
    },
    {
      name: 'nothing where no version is tagged',
      tags: [],
      references: [],
    },
  ])('picks $name', async (scenario) => {
    const directory = await createRepository(REPOSITORY_FILES);
    const standardOutputWrites = captureWrites(process.stdout);

    await git(directory, 'init --quiet --initial-branch=main');
    await commit(directory, 'README.md', 'acme');

    await settleAll(scenario.tags.map(async (tag) => git(directory, `tag ${tag}`)));

    await expect(main(ARGV, GIT_ENVIRONMENT, directory)).resolves.toBe(0);

    expect(standardOutputWrites).toStrictEqual([`${JSON.stringify(scenario.references)}\n`]);
  });
});
