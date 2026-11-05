import { sleep } from 'bun';

import { getErrorMessage } from '#src/shared/utils/error';
import { STATUS_CODE } from '#src/shared/utils/http';
import { isPlainObject, readOwnValue } from '#src/shared/utils/object';
import { packageFullName } from '#src/shared/utils/package-json';
import { readGroup } from '#src/shared/utils/pattern';
import { parseSeconds } from '#src/shared/utils/string';

import type { Maybe } from '#src/shared/types/core';

export interface RegistryRepository {
  readonly registry: string;
  readonly repository: string;
}

export interface Registry {
  readonly apiUrl: string;
  readonly tokenUrl: string;
}

interface TokenResponse {
  readonly token: string;
}

interface TagListPage {
  readonly tags: string[] | null;
}

export type Registries = ReadonlyMap<string, Registry>;

type HeaderList = [string, string][];

export const DOCKER_HUB = 'docker.io';
export const GHCR = 'ghcr.io';

export const REGISTRIES: Registries = new Map([
  [
    DOCKER_HUB,
    {
      apiUrl: `https://registry-1.${DOCKER_HUB}`,
      tokenUrl: `https://auth.${DOCKER_HUB}/token?service=registry.${DOCKER_HUB}`,
    },
  ],
  [
    GHCR,
    {
      apiUrl: `https://${GHCR}`,
      tokenUrl: `https://${GHCR}/token?service=${GHCR}`,
    },
  ],
]);

const MANIFEST_TYPES = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

const FIRST_RETRY_DELAY_MILLISECONDS = 1_000;
const SECOND_RETRY_DELAY_MILLISECONDS = 4_000;
const MILLISECONDS_PER_SECOND = 1_000;
const MAXIMUM_RETRY_AFTER_SECONDS = 60;

export const RETRY_DELAYS_MILLISECONDS = <const>[
  FIRST_RETRY_DELAY_MILLISECONDS,
  SECOND_RETRY_DELAY_MILLISECONDS,
];

const tokenReads = new Map<string, Promise<string>>();
const createNextLinkPattern = (): RegExp => /<(?<path>[^<>]+)>;\s*rel="next"/v;

const fetchOrUndefined = async (url: string | URL, requestInit: RequestInit): Promise<Maybe<Response>> => {
  try {
    return await fetch(url, requestInit);
  } catch {
    return undefined;
  }
};

/**
 * @rejects {Error}
 */
const fetchReachable = async (url: string | URL, requestInit: RequestInit): Promise<Response> => {
  try {
    return await fetch(url, requestInit);
  } catch (error) {
    throw new Error(`Unable to reach "${new URL(url).origin}": ${getErrorMessage(error)}`, {
      cause: error,
    });
  }
};

const withUserAgent = (requestInit: RequestInit): RequestInit => {
  const headers = new Headers(requestInit.headers);

  headers.set('User-Agent', packageFullName.replace(/^@/v, ''));

  return {
    ...requestInit,
    headers,
  };
};

const isAnswered = (response: Maybe<Response>): response is Response => response !== undefined
  && response.status !== STATUS_CODE.TOO_MANY_REQUESTS
  && response.status < STATUS_CODE.INTERNAL_SERVER_ERROR;

/**
 * @throws {Error}
 */
const readRetryDelay = (
  url: string | URL,
  response: Maybe<Response>,
  delayMilliseconds: number,
  maximumRetryAfterSeconds: number,
): number => {
  const retryAfterSeconds = parseSeconds(response?.headers.get('Retry-After') ?? '');

  if (retryAfterSeconds === undefined) {
    return delayMilliseconds;
  }

  if (retryAfterSeconds > maximumRetryAfterSeconds) {
    const { host } = new URL(url);
    const seconds = String(retryAfterSeconds);
    const allowedSeconds = String(maximumRetryAfterSeconds);

    throw new Error(`Unable to retry "${host}": it asks to wait ${seconds} seconds, more than ${allowedSeconds}.`);
  }

  return retryAfterSeconds * MILLISECONDS_PER_SECOND;
};

/**
 * @rejects {Error}
 */
const fetchWithRetries = async (
  url: string | URL,
  requestInit: RequestInit,
  delaysMilliseconds: readonly number[],
  maximumRetryAfterSeconds: number,
): Promise<Response> => {
  const [delayMilliseconds, ...laterDelaysMilliseconds] = delaysMilliseconds;

  if (delayMilliseconds === undefined) {
    return fetchReachable(url, requestInit);
  }

  const response = await fetchOrUndefined(url, requestInit);

  if (isAnswered(response)) {
    return response;
  }

  await sleep(readRetryDelay(
    url,
    response,
    delayMilliseconds,
    maximumRetryAfterSeconds,
  ));

  return fetchWithRetries(
    url,
    requestInit,
    laterDelaysMilliseconds,
    maximumRetryAfterSeconds,
  );
};

/**
 * @rejects {Error}
 */
export const isListedOnRegistry = async (url: string, retryDelaysMilliseconds: readonly number[]): Promise<boolean> => {
  const response = await fetchWithRetries(
    url,
    withUserAgent({}),
    retryDelaysMilliseconds,
    MAXIMUM_RETRY_AFTER_SECONDS,
  );

  if (!response.ok && response.status !== STATUS_CODE.NOT_FOUND) {
    throw new Error(`Request to "${url}" failed with status ${String(response.status)}.`);
  }

  return response.ok;
};

/**
 * @rejects {Error}
 */
export const fetchOk = async (
  url: string | URL,
  requestInit: RequestInit = {},
  retryDelaysMilliseconds: readonly number[] = RETRY_DELAYS_MILLISECONDS,
  maximumRetryAfterSeconds: number = MAXIMUM_RETRY_AFTER_SECONDS,
): Promise<Response> => {
  const response = await fetchWithRetries(
    url,
    withUserAgent(requestInit),
    retryDelaysMilliseconds,
    maximumRetryAfterSeconds,
  );

  if (!response.ok) {
    throw new Error(`Request to "${String(url)}" failed with status ${String(response.status)}.`);
  }

  return response;
};

/**
 * @rejects {Error}
 */
export const fetchJson = async (url: string | URL, requestInit?: RequestInit): Promise<unknown> => {
  const response = await fetchOk(url, requestInit);

  return response.json();
};

/**
 * @throws {Error}
 */
const getRegistry = (image: RegistryRepository, registries: Registries): Registry => {
  const matchingRegistry = registries.get(image.registry);

  if (matchingRegistry === undefined) {
    const imageName = `${image.registry}/${image.repository}`;
    const registryNames = new Intl.ListFormat('en').format(registries.keys().map((name) => `"${name}"`));

    throw new Error(`Registry of image "${imageName}" is not supported. Supported registries are ${registryNames}.`);
  }

  return matchingRegistry;
};

/**
 * @rejects {Error}
 */
const fetchToken = async (tokenUrl: string, image: RegistryRepository): Promise<string> => {
  const tokenResponse = <TokenResponse>(await fetchJson(`${tokenUrl}&scope=repository:${image.repository}:pull`));

  return tokenResponse.token;
};

/**
 * @rejects {Error}
 */
const readAuthorizationHeaders = async (
  tokenUrl: string,
  image: RegistryRepository,
): Promise<HeaderList> => {
  const tokenKey = `${tokenUrl} ${image.repository}`;
  const tokenRead = tokenReads.get(tokenKey) ?? fetchToken(tokenUrl, image);

  tokenReads.set(tokenKey, tokenRead);

  return [['Authorization', `Bearer ${await tokenRead}`]];
};

/**
 * @rejects {Error}
 */
const fetchTagPage = async (url: URL, authorizationHeaders: HeaderList): Promise<string[]> => {
  const response = await fetchOk(url, {
    headers: authorizationHeaders,
  });

  const tagListPage: unknown = await response.json();

  if (!isPlainObject(tagListPage)) {
    throw new Error(`Response from "${url.href}" is not a tag list.`);
  }

  const pageTags = <Maybe<TagListPage['tags']>>readOwnValue(tagListPage, 'tags') ?? [];
  const nextLinkMatch = createNextLinkPattern().exec(response.headers.get('Link') ?? '');

  if (!nextLinkMatch) {
    return pageTags;
  }

  return [
    ...pageTags,
    ...await fetchTagPage(new URL(readGroup(nextLinkMatch.groups, 'path'), url), authorizationHeaders),
  ];
};

/**
 * @rejects {Error}
 */
export const fetchTags = async (image: RegistryRepository, registries: Registries): Promise<string[]> => {
  const registry = getRegistry(image, registries);
  const authorizationHeaders = await readAuthorizationHeaders(registry.tokenUrl, image);

  return fetchTagPage(new URL(`/v2/${image.repository}/tags/list`, registry.apiUrl), authorizationHeaders);
};

/**
 * @rejects {Error}
 */
export const fetchDigest = async (image: RegistryRepository, tag: string, registries: Registries): Promise<string> => {
  const registry = getRegistry(image, registries);

  const response = await fetchOk(new URL(`/v2/${image.repository}/manifests/${tag}`, registry.apiUrl), {
    method: 'HEAD',
    headers: [
      ['Accept', MANIFEST_TYPES],
      ...await readAuthorizationHeaders(registry.tokenUrl, image),
    ],
  });

  const digest = response.headers.get('Docker-Content-Digest') ?? '';

  if (digest === '') {
    const imageReference = `${image.registry}/${image.repository}:${tag}`;

    throw new Error(`Digest of "${imageReference}" not found.`);
  }

  return digest;
};
