import { STATUS_CODE } from '#src/shared/utils/http';
import { serve } from '#tests/support/server';

type PathCheck = (pathname: string) => boolean | Promise<boolean>;

export const serveNpmRegistry = (isKnown: PathCheck): string => serve(async (request) => new Response('{}', {
  status: await isKnown(new URL(request.url).pathname) ? STATUS_CODE.OK : STATUS_CODE.NOT_FOUND,
})).origin;
