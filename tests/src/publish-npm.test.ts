import { file, write } from 'bun';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { main, PUBLISH_MAX_ATTEMPTS } from '#src/publish-npm';
import { serveNpmRegistry } from '#tests/support/npm';
import { captureWrites } from '#tests/support/output';
import { createUnreachableUrl } from '#tests/support/server';
import { installStubs } from '#tests/support/stubs';

import type { NpmRegistry } from '#src/publish-npm';

const ARGV = [
  '--distribution-tag=alpha',
  '--name=@acme/user',
  '--tarball=acme-user-1.0.0.tgz',
  '--version=1.0.0',
];

const PUBLISHING_STUB = 'touch "$(dirname "$0")/published"';
const TIMEOUT_MILLISECONDS = 10_000;
const SHORT_TIMEOUT_MILLISECONDS = 100;

const serveNpm = (isKnownPackage: boolean, publishedMarkerPath: string): string => serveNpmRegistry(
  async (pathname) => (pathname === '/@acme/user/1.0.0'
    ? file(publishedMarkerPath).exists()
    : (pathname === '/@acme/user' && isKnownPackage)),
);

const createRegistry = (url: string, timeoutMilliseconds: number = TIMEOUT_MILLISECONDS): NpmRegistry => ({
  backoffMilliseconds: 0,
  retryDelaysMilliseconds: [],
  timeoutMilliseconds,
  url,
});

describe('the publish-npm script', () => {
  it.each([
    {
      name: 'goes out through bun for a package npm does not know yet',
      command: 'bun',
      isKnownPackage: false,
      publishCommand: 'bun publish',
    },
    {
      name: 'goes out through npm with provenance for a package npm knows',
      command: 'npm',
      isKnownPackage: true,
      publishCommand: 'npm publish --provenance',
    },
  ])('$name', async (scenario) => {
    const stubs = await installStubs({
      [scenario.command]: PUBLISHING_STUB,
    });

    const url = serveNpm(scenario.isKnownPackage, path.join(stubs.directory, 'published'));

    await expect(main(ARGV, stubs.environment, createRegistry(url))).resolves.toBe(0);

    await expect(stubs.readCalls()).resolves.toStrictEqual([
      `${scenario.publishCommand} acme-user-1.0.0.tgz --access public --tag alpha`,
    ]);
  });

  it('publishes nothing once the version is on npm', async () => {
    const stubs = await installStubs({
      bun: 'exit 0',
    });

    const publishedMarkerPath = path.join(stubs.directory, 'published');

    await write(publishedMarkerPath, '');

    const registry = createRegistry(serveNpm(false, publishedMarkerPath));

    await expect(main(ARGV, stubs.environment, registry)).resolves.toBe(0);

    await expect(stubs.readCalls()).resolves.toStrictEqual([]);
  });

  it('stops once npm holds the version, even after an attempt that timed out', async () => {
    const stubs = await installStubs({
      bun: `${PUBLISHING_STUB}\nexec sleep 10`,
    });

    const url = serveNpm(false, path.join(stubs.directory, 'published'));

    await expect(main(ARGV, stubs.environment, createRegistry(url, SHORT_TIMEOUT_MILLISECONDS))).resolves.toBe(0);
    await expect(stubs.readCalls()).resolves.toHaveLength(1);
  });

  it('fails and names the release once every attempt timed out', async () => {
    const stubs = await installStubs({
      bun: 'exec sleep 10',
    });

    const url = serveNpm(false, path.join(stubs.directory, 'published'));
    const standardErrorWrites = captureWrites(process.stderr);

    await expect(main(ARGV, stubs.environment, createRegistry(url, SHORT_TIMEOUT_MILLISECONDS))).resolves.toBe(1);
    await expect(stubs.readCalls()).resolves.toHaveLength(PUBLISH_MAX_ATTEMPTS);

    expect(standardErrorWrites).toStrictEqual(['Unable to publish "@acme/user@1.0.0" to npm.\n']);
  });

  it('fails where npm cannot be reached rather than guess the package is new', async () => {
    const stubs = await installStubs({
      bun: 'exit 0',
    });

    const url = await createUnreachableUrl();

    await expect(main(ARGV, stubs.environment, createRegistry(url))).rejects.toThrow(
      `Unable to reach "${new URL(url).origin}": `,
    );

    await expect(stubs.readCalls()).resolves.toStrictEqual([]);
  });
});
