import { describe, expect, it } from 'vitest';

import { main } from '#src/notify-packagist';
import { STATUS_CODE } from '#src/shared/utils/http';
import { serve } from '#tests/support/server';

import type { PackagistRegistry } from '#src/notify-packagist';

interface ReceivedNotice {
  readonly authorization: string | null;
  readonly body: unknown;
  readonly path: string;
}

interface FakePackagist {
  readonly notices: ReceivedNotice[];
  readonly url: string;
}

const ENVIRONMENT = {
  PACKAGIST_TOKEN: 'secret',
  PACKAGIST_USERNAME: 'acme',
};

const ARGV = [
  '--name=acme/user',
  '--repository-url=https://example.com/acme/user',
];

const servePackagist = (listingStatus: number, noticeStatus: number = STATUS_CODE.OK): FakePackagist => {
  const notices: ReceivedNotice[] = [];

  const url = serve(async (request) => {
    const requestUrl = new URL(request.url);

    if (request.method === 'GET') {
      return new Response('{}', {
        status: requestUrl.pathname === '/packages/acme/user.json' ? listingStatus : STATUS_CODE.NOT_FOUND,
      });
    }

    notices.push({
      authorization: request.headers.get('Authorization'),
      body: await request.json(),
      path: requestUrl.pathname,
    });

    return new Response('{}', {
      status: noticeStatus,
    });
  });

  return {
    notices,
    url: url.origin,
  };
};

const createRegistry = (url: string): PackagistRegistry => ({
  retryDelaysMilliseconds: [],
  url,
});

describe('the notify-packagist script', () => {
  it.each([
    {
      name: 'creates a package Packagist does not list yet',
      listingStatus: STATUS_CODE.NOT_FOUND,
      path: '/api/create-package',
    },
    {
      name: 'updates a package Packagist already lists',
      listingStatus: STATUS_CODE.OK,
      path: '/api/update-package',
    },
  ])('$name', async (scenario) => {
    const packagist = servePackagist(scenario.listingStatus);

    await expect(main(ARGV, ENVIRONMENT, createRegistry(packagist.url))).resolves.toBe(0);

    expect(packagist.notices).toStrictEqual([
      {
        authorization: 'Bearer acme:secret',
        body: {
          repository: {
            url: 'https://example.com/acme/user',
          },
        },
        path: scenario.path,
      },
    ]);
  });

  it('fails when Packagist refuses it', async () => {
    const packagist = servePackagist(STATUS_CODE.OK, STATUS_CODE.FORBIDDEN);

    await expect(main(ARGV, ENVIRONMENT, createRegistry(packagist.url)))
      .rejects
      .toThrow(`Request to "${packagist.url}/api/update-package" failed with status 403.`);
  });

  it('sends nothing without both credentials', async () => {
    const packagist = servePackagist(STATUS_CODE.OK);

    const environment = {
      PACKAGIST_USERNAME: 'acme',
    };

    await expect(main(ARGV, environment, createRegistry(packagist.url)))
      .rejects
      .toThrow('Environment variable not found: "PACKAGIST_TOKEN".');

    expect(packagist.notices).toStrictEqual([]);
  });
});
