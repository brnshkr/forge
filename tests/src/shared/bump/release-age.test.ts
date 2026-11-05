import { file, write } from 'bun';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  getCandidateSelection,
  readMinimumReleaseAge,
  readReleaseAge,
  writeSightings,
} from '#src/shared/bump/release-age';

import { GHCR } from '#src/shared/registry';
import { packageName, packageOrganization } from '#src/shared/utils/package-json';
import { createDigest } from '#tests/support/digest';
import { createDirectory } from '#tests/support/directory';
import { writeFiles } from '#tests/support/repository';

import type { CandidateSearch, ReleaseAge } from '#src/shared/bump/release-age';

const DIGEST = createDigest('a');
const PINNED_REFERENCE = `acme/user:1.0@${DIGEST}`;
const OLDER_CANDIDATE = `acme/user:1.1@${DIGEST}`;
const AGED_CANDIDATE = `acme/user:1.2@${DIGEST}`;
const NEWEST_CANDIDATE = `acme/user:1.3@${DIGEST}`;
const UNRELATED_REFERENCE = `acme/other:1.0@${DIGEST}`;
const FIRST_SEEN = '1970-01-01T00:00:00.000Z';
const NOW = '1970-01-01T00:02:00.000Z';
const MINIMUM_AGE_SECONDS = 60;

const RELEASE_AGE = <const>{
  minimumAgeSeconds: MINIMUM_AGE_SECONDS,
  now: Date.parse(NOW),
  scope: 'acme',
  seenCandidates: {
    [AGED_CANDIDATE]: '1970-01-01T00:01:00.000Z',
    [OLDER_CANDIDATE]: FIRST_SEEN,
    [UNRELATED_REFERENCE]: FIRST_SEEN,
  },
  seenFile: '',
} satisfies ReleaseAge;

const createSearch = (candidateReference: string): CandidateSearch => ({
  candidateReference,
  pinnedReference: PINNED_REFERENCE,
});

const isRelevant = (seenReference: string): boolean => seenReference.startsWith('acme/user:')
  && seenReference !== PINNED_REFERENCE;

describe('the minimum release age', () => {
  it.each([
    {
      name: 'is read from .env first, without its comment',
      dotenvText: 'MINIMUM_RELEASE_AGE=60 # a minute\n',
      environmentValue: '120',
      seconds: 60,
    },
    {
      name: 'falls back to the environment',
      dotenvText: '',
      environmentValue: '120',
      seconds: 120,
    },
    {
      name: 'is zero where .env sets it empty',
      dotenvText: 'MINIMUM_RELEASE_AGE=\n',
      environmentValue: '120',
      seconds: 0,
    },
    {
      name: 'is a week where the environment sets it empty and .env not at all',
      dotenvText: '',
      environmentValue: '',
      seconds: 604_800,
    },
  ])('$name', (scenario) => {
    expect(readMinimumReleaseAge(scenario.dotenvText, {
      MINIMUM_RELEASE_AGE: scenario.environmentValue,
    })).toBe(scenario.seconds);
  });

  it.each([
    {
      value: '7d',
    },
    {
      value: '-1',
    },
    {
      value: '1.5',
    },
  ])('refuses $value', (scenario) => {
    expect(() => readMinimumReleaseAge(`MINIMUM_RELEASE_AGE=${scenario.value}\n`, {}))
      .toThrow(`Variable "MINIMUM_RELEASE_AGE" must be a number of seconds, "${scenario.value}" given.`);
  });
});

describe('the candidate a release age selects', () => {
  it('is the newest one seen for the full age, keeping only the sightings after it', () => {
    expect(getCandidateSelection(createSearch(NEWEST_CANDIDATE), RELEASE_AGE, isRelevant)).toStrictEqual({
      reference: AGED_CANDIDATE,
      sightings: {
        [NEWEST_CANDIDATE]: NOW,
      },
    });
  });

  it('is none while no relevant one is old enough, recording every relevant sighting', () => {
    const releaseAge = <const>{
      ...RELEASE_AGE,
      minimumAgeSeconds: 600,
    } satisfies ReleaseAge;

    expect(getCandidateSelection(createSearch(NEWEST_CANDIDATE), releaseAge, isRelevant)).toStrictEqual({
      sightings: {
        [AGED_CANDIDATE]: '1970-01-01T00:01:00.000Z',
        [NEWEST_CANDIDATE]: NOW,
        [OLDER_CANDIDATE]: FIRST_SEEN,
      },
    });
  });

  it.each([
    {
      name: 'is the newest one at once where the age is zero',
      candidateReference: NEWEST_CANDIDATE,
      minimumAgeSeconds: 0,
    },
    {
      name: 'is the pin itself where nothing newer exists',
      candidateReference: PINNED_REFERENCE,
      minimumAgeSeconds: MINIMUM_AGE_SECONDS,
    },
    {
      name: 'is an image of the organization at once',
      candidateReference: `${GHCR}/${packageOrganization}/forge:1@${DIGEST}`,
      minimumAgeSeconds: MINIMUM_AGE_SECONDS,
    },
  ])('$name', (scenario) => {
    const releaseAge = <const>{
      ...RELEASE_AGE,
      minimumAgeSeconds: scenario.minimumAgeSeconds,
    } satisfies ReleaseAge;

    expect(getCandidateSelection(createSearch(scenario.candidateReference), releaseAge, isRelevant)).toStrictEqual({
      reference: scenario.candidateReference,
      sightings: {},
    });
  });
});

describe('the sightings a release age has recorded', () => {
  it.each([
    {
      name: 'are none where the file is missing',
      text: undefined,
      seenCandidates: {},
    },
    {
      name: 'are none where the file is no JSON',
      text: '{',
      seenCandidates: {},
    },
    {
      name: 'are none where the scope is no object',
      text: '{"acme":[]}',
      seenCandidates: {},
    },
    {
      name: 'skip an entry that is no time and keep one that is',
      text: JSON.stringify({
        acme: {
          [AGED_CANDIDATE]: 1,
          [NEWEST_CANDIDATE]: FIRST_SEEN,
          [OLDER_CANDIDATE]: 'yesterday',
        },
      }),
      seenCandidates: {
        [NEWEST_CANDIDATE]: FIRST_SEEN,
      },
    },
  ])('$name', async (scenario) => {
    const directory = await createDirectory(`${packageName}-seen-`);

    await writeFiles(directory, scenario.text === undefined
      ? {}
      : {
        'seen.cache': scenario.text,
      });

    const releaseAge = await readReleaseAge(path.join(directory, 'seen.cache'), 'acme', MINIMUM_AGE_SECONDS);

    expect(releaseAge.seenCandidates).toStrictEqual(scenario.seenCandidates);
  });

  it('replace their own scope with every pin\'s sightings and leave other scopes alone', async () => {
    const directory = await createDirectory(`${packageName}-seen-`);
    const seenFile = path.join(directory, 'seen.cache');

    await write(seenFile, JSON.stringify({
      acme: {
        [OLDER_CANDIDATE]: FIRST_SEEN,
      },
      other: {
        [OLDER_CANDIDATE]: FIRST_SEEN,
      },
    }));

    const sightingRecords = [
      {
        [NEWEST_CANDIDATE]: NOW,
      },
      {
        [AGED_CANDIDATE]: FIRST_SEEN,
      },
    ];

    await writeSightings(sightingRecords, await readReleaseAge(seenFile, 'acme', MINIMUM_AGE_SECONDS));

    await expect(file(seenFile).json()).resolves.toStrictEqual({
      acme: {
        [AGED_CANDIDATE]: FIRST_SEEN,
        [NEWEST_CANDIDATE]: NOW,
      },
      other: {
        [OLDER_CANDIDATE]: FIRST_SEEN,
      },
    });
  });

  it('replace a seen file that holds no object', async () => {
    const directory = await createDirectory(`${packageName}-seen-`);
    const seenFile = path.join(directory, 'seen.cache');

    await write(seenFile, '[]');

    const sightingRecords = [
      {
        [NEWEST_CANDIDATE]: NOW,
      },
    ];

    await writeSightings(sightingRecords, await readReleaseAge(seenFile, 'acme', MINIMUM_AGE_SECONDS));

    await expect(file(seenFile).json()).resolves.toStrictEqual({
      acme: {
        [NEWEST_CANDIDATE]: NOW,
      },
    });
  });
});
