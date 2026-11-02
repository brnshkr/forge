import { listen } from 'bun';

import {
  describe,
  expect,
  it,
  onTestFinished,
} from 'vitest';

import {
  DOCKER_HUB,
  fetchDigest,
  fetchOk,
  fetchTags,
  GHCR,
} from '#src/shared/registry';

import { STATUS_CODE } from '#src/shared/utils/http';
import { createDigest } from '#tests/support/digest';
import { createDigestResponse, serveRegistry } from '#tests/support/registry';
import { createUnreachableUrl, serve } from '#tests/support/server';

import type { RegistryRepository } from '#src/shared/registry';

interface PlannedAnswer {
  readonly retryAfter?: string;
  readonly status: number;
}

interface ConnectionState {
  readonly isDropped: boolean;
}

const DIGEST = createDigest('a');
const MINUTE_MILLISECONDS = 60_000;

const IMAGE = <const>{
  registry: GHCR,
  repository: 'acme/user',
} satisfies RegistryRepository;

const NO_DELAYS = [
  0,
  0,
];

const serveInTurn = (answers: readonly PlannedAnswer[]): string => {
  const pendingAnswers = answers.values();

  return serve(() => {
    const answer = pendingAnswers.next();

    if (answer.done === true) {
      throw new Error('No further request is planned.');
    }

    return new Response(undefined, {
      headers: answer.value.retryAfter === undefined
        ? []
        : [['Retry-After', answer.value.retryAfter]],
      status: answer.value.status,
    });
  }).origin;
};

describe('the tags of an image', () => {
  it('span every page the registry links to', async () => {
    const registry = serveRegistry((path) => {
      if (path === '/v2/acme/user/tags/list') {
        const tags = [
          '1',
          '1.0',
        ];

        return Response.json(
          {
            tags,
          },
          {
            headers: [['Link', '</v2/acme/user/tags/list?last=1.0>; rel="next"']],
          },
        );
      }

      return Response.json(path === '/v2/acme/user/tags/list?last=1.0'
        ? {
          tags: ['1.1'],
        }
        : {});
    });

    await expect(fetchTags(IMAGE, registry.registries)).resolves.toStrictEqual([
      '1',
      '1.0',
      '1.1',
    ]);
  });

  it('are none where the registry lists none', async () => {
    const registry = serveRegistry(() => Response.json({}));

    await expect(fetchTags(IMAGE, registry.registries)).resolves.toStrictEqual([]);
  });

  it('fail, naming the address, where the registry answers no tag list', async () => {
    const registry = serveRegistry(() => Response.json([]));

    await expect(fetchTags(IMAGE, registry.registries))
      .rejects
      .toThrow(/^Response from "http:\/\/[^"]+\/v2\/acme\/user\/tags\/list" is not a tag list\.$/v);
  });
});

describe('the digest of a tag', () => {
  it('is what the registry answers for its manifest, asked for every manifest type', async () => {
    const registry = serveRegistry((path, request) => {
      const isManifestRequest = path === '/v2/acme/user/manifests/1.0'
        && request.method === 'HEAD'
        && request.headers.get('Accept')?.includes('application/vnd.oci.image.index.v1+json') === true;

      return isManifestRequest ? createDigestResponse(DIGEST) : new Response();
    });

    await expect(fetchDigest(IMAGE, '1.0', registry.registries)).resolves.toBe(DIGEST);
  });

  it('fails, naming the tag, where the registry sends none', async () => {
    const registry = serveRegistry(() => new Response());

    await expect(fetchDigest(IMAGE, '1.0', registry.registries)).rejects.toThrow(`Digest of "${GHCR}/acme/user:1.0" not found.`);
  });
});

describe('the token of a repository', () => {
  it('is fetched once per repository, for pulling that repository only', async () => {
    const registry = serveRegistry((path) => (path === '/v2/acme/user/tags/list'
      ? Response.json({
        tags: ['1.0'],
      })
      : createDigestResponse(DIGEST)));

    const otherImage = <const>{
      ...IMAGE,
      repository: 'acme/other',
    } satisfies RegistryRepository;

    await fetchTags(IMAGE, registry.registries);
    await fetchDigest(IMAGE, '1.0', registry.registries);
    await fetchDigest(otherImage, '1.0', registry.registries);

    expect(registry.tokenQueries).toStrictEqual([
      '?service=registry&scope=repository:acme/user:pull',
      '?service=registry&scope=repository:acme/other:pull',
    ]);
  });
});

describe('a registry other than the known ones', () => {
  it('is refused, naming the image and the known registries, before anything is requested', async () => {
    const requestedUrls: string[] = [];

    const url = serve((request) => {
      requestedUrls.push(request.url);

      return new Response();
    });

    const registry = <const>{
      apiUrl: url.origin,
      tokenUrl: `${url.origin}/token?service=registry`,
    };

    const registries = new Map([
      [
        DOCKER_HUB,
        registry,
      ],
      [
        GHCR,
        registry,
      ],
    ]);

    const image = <const>{
      registry: 'quay.io',
      repository: 'acme/user',
    } satisfies RegistryRepository;

    await expect(fetchTags(image, registries))
      .rejects
      .toThrow(`Registry of image "quay.io/acme/user" is not supported. `
        + `Supported registries are "${DOCKER_HUB}" and "${GHCR}".`);

    expect(requestedUrls).toStrictEqual([]);
  });
});

describe('a request the server fails', () => {
  it.each([
    {
      name: 'a server error',
      status: STATUS_CODE.SERVICE_UNAVAILABLE,
    },
    {
      name: 'too many requests',
      status: STATUS_CODE.TOO_MANY_REQUESTS,
    },
  ])('is retried after $name', async (scenario) => {
    const url = serveInTurn([
      {
        status: scenario.status,
      },
      {
        status: STATUS_CODE.OK,
      },
    ]);

    await expect(fetchOk(url, {}, NO_DELAYS)).resolves.toMatchObject({
      status: STATUS_CODE.OK,
    });
  });

  it('waits as long as the server asks, up to its limit, rather than its own delay', async () => {
    const url = serveInTurn([
      {
        retryAfter: '1',
        status: STATUS_CODE.TOO_MANY_REQUESTS,
      },
      {
        status: STATUS_CODE.OK,
      },
    ]);

    await expect(fetchOk(
      url,
      {},
      [MINUTE_MILLISECONDS],
      1,
    )).resolves.toMatchObject({
      status: STATUS_CODE.OK,
    });
  });

  it('gives up at once, naming the host and the wait, where the server asks for more than its limit', async () => {
    const url = serveInTurn([
      {
        retryAfter: '2',
        status: STATUS_CODE.TOO_MANY_REQUESTS,
      },
    ]);

    await expect(fetchOk(
      url,
      {},
      [MINUTE_MILLISECONDS],
      1,
    ))
      .rejects
      .toThrow(`Unable to retry "${new URL(url).host}": it asks to wait 2 seconds, more than 1.`);
  });

  it('is retried after a dropped connection', async () => {
    let connectionCount = 0;

    const listener = listen<ConnectionState>({
      hostname: '127.0.0.1',
      port: 0,
      socket: {
        data: (socket) => {
          if (!socket.data.isDropped) {
            socket.end('HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
          }
        },
        open: (socket) => {
          connectionCount += 1;

          socket.data = {
            isDropped: connectionCount === 1,
          };

          if (socket.data.isDropped) {
            socket.end();
          }
        },
      },
    });

    onTestFinished(() => {
      listener.stop(true);
    });

    await expect(fetchOk(`http://127.0.0.1:${String(listener.port)}`, {}, NO_DELAYS)).resolves.toMatchObject({
      status: STATUS_CODE.OK,
    });
  });

  it('fails once every retry is used up', async () => {
    const url = serveInTurn([
      {
        status: STATUS_CODE.SERVICE_UNAVAILABLE,
      },
      {
        status: STATUS_CODE.BAD_GATEWAY,
      },
      {
        status: STATUS_CODE.INTERNAL_SERVER_ERROR,
      },
    ]);

    await expect(fetchOk(url, {}, NO_DELAYS)).rejects.toThrow(`Request to "${url}" failed with status 500.`);
  });

  it('fails naming the host where the server never answers', async () => {
    const url = await createUnreachableUrl();

    await expect(fetchOk(url, {}, NO_DELAYS)).rejects.toThrow(`Unable to reach "${new URL(url).origin}": `);
  });
});
