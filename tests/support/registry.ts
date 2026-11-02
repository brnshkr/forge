import { DOCKER_HUB, GHCR } from '#src/shared/registry';
import { STATUS_CODE } from '#src/shared/utils/http';
import { serve } from '#tests/support/server';

import type { Registries, Registry } from '#src/shared/registry';

interface FakeRegistry {
  readonly registries: Registries;
  readonly tokenQueries: readonly string[];
}

type RegistryHandler = (path: string, request: Request) => Promise<Response> | Response;

const TOKEN = 'anonymous';

export const createDigestResponse = (digest: string): Response => new Response(undefined, {
  headers: [['Docker-Content-Digest', digest]],
});

export const serveRegistry = (handleRequest: RegistryHandler): FakeRegistry => {
  const tokenQueries: string[] = [];

  const url = serve(async (request) => {
    const requestUrl = new URL(request.url);

    if (requestUrl.pathname === '/token') {
      tokenQueries.push(requestUrl.search);

      return Response.json({
        token: TOKEN,
      });
    }

    if (request.headers.get('Authorization') !== `Bearer ${TOKEN}`) {
      return new Response(undefined, {
        status: STATUS_CODE.UNAUTHORIZED,
      });
    }

    return handleRequest(`${requestUrl.pathname}${requestUrl.search}`, request);
  });

  const registry = <const>{
    apiUrl: url.origin,
    tokenUrl: `${url.origin}/token?service=registry`,
  } satisfies Registry;

  return {
    registries: new Map([
      [DOCKER_HUB, registry],
      [GHCR, registry],
    ]),
    tokenQueries,
  };
};
