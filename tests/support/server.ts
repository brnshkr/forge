import { serve as bunServe } from 'bun';

import { onTestFinished } from 'vitest';

type RequestHandler = (request: Request) => Promise<Response> | Response;

export const serve = (handleRequest: RequestHandler): URL => {
  const server = bunServe({
    fetch: handleRequest,
    port: 0,
  });

  onTestFinished(async () => {
    await server.stop(true);
  });

  return server.url;
};

export const createUnreachableUrl = async (): Promise<string> => {
  const server = bunServe({
    fetch: () => new Response(),
    port: 0,
  });

  const port = String(server.port);

  await server.stop(true);

  return `http://127.0.0.1:${port}`;
};
