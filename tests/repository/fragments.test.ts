import { describe, expect, it } from 'vitest';

import { readGroup } from '#src/shared/utils/pattern';
import { listRepositoryFiles, readRepositoryFile } from '#tests/support/repository';

const FRAGMENT_FILES = await listRepositoryFiles('compose/*.yaml');

const PRODUCTION_FRAGMENT_FILES = FRAGMENT_FILES.filter(
  (fragmentFile) => FRAGMENT_FILES.includes(fragmentFile.replace(/\.yaml$/v, '-dev.yaml')),
);

const SINGLE_INSTANCE_FRAGMENT_FILES = new Set([
  'compose/mailpit.yaml',
  'compose/mercure.yaml',
  'compose/postgres.yaml',
  'compose/proxy.yaml',
  'compose/valkey.yaml',
]);

const DEVELOPMENT_TWIN_FRAGMENT_FILES = new Set([
  'compose/messenger-dev.yaml',
  'compose/web-bun-dev.yaml',
  'compose/web-dev.yaml',
]);

const FRAGMENT_SCENARIOS = FRAGMENT_FILES.map((fragmentFile) => ({
  fragmentFile,
}));

const PRODUCTION_FRAGMENT_SCENARIOS = PRODUCTION_FRAGMENT_FILES.map((fragmentFile) => ({
  fragmentFile,
}));

describe('a published fragment', () => {
  it.each(FRAGMENT_SCENARIOS)('$fragmentFile runs only on a pinned image and unprivileged', async (scenario) => {
    const fragment = await readRepositoryFile(scenario.fragmentFile);

    expect(fragment).toMatch(/image: \$\{(?<prefix>[A-Z_]+)_IMAGE:-.*:\$\{(?:\k<prefix>|FORGE)_TAG:\?.*@\$\{\k<prefix>_IMAGE_DIGEST:\?/v);
    expect(fragment).toContain('cap_drop:\n      - ALL');
    expect(fragment).toContain('no-new-privileges:true');
  });

  it.each(FRAGMENT_SCENARIOS)('$fragmentFile fixes its container name only where copies would share data', async (scenario) => {
    const fragment = await readRepositoryFile(scenario.fragmentFile);

    expect(fragment.includes('container_name:')).toBe(SINGLE_INSTANCE_FRAGMENT_FILES.has(scenario.fragmentFile));
  });

  it.each(FRAGMENT_SCENARIOS)('$fragmentFile logs through Docker\'s rotating driver', async (scenario) => {
    await expect(readRepositoryFile(scenario.fragmentFile)).resolves.toMatch(/^ {4}logging:\n {6}driver: local$/mv);
  });

  it.each(FRAGMENT_SCENARIOS)('$fragmentFile limits memory and processes, a development twin falling back to production', async (scenario) => {
    const fragment = await readRepositoryFile(scenario.fragmentFile);
    const service = readGroup(/^services:\n {2}(?<service>[a-z]+):$/mv.exec(fragment)?.groups, 'service').toUpperCase();

    const createLimitPrefix = (limit: string): string => (DEVELOPMENT_TWIN_FRAGMENT_FILES.has(scenario.fragmentFile)
      ? `\${${service}_DEV_CONTAINER_${limit}_LIMIT:-\${${service}_CONTAINER_${limit}_LIMIT:-`
      : `\${${service}_CONTAINER_${limit}_LIMIT:-`);

    expect(fragment).toContain(`    mem_limit: ${createLimitPrefix('MEMORY')}`);
    expect(fragment).toContain(`    pids_limit: ${createLimitPrefix('PIDS')}`);
  });

  it.each(FRAGMENT_SCENARIOS)('$fragmentFile runs read only', async (scenario) => {
    await expect(readRepositoryFile(scenario.fragmentFile)).resolves.toContain('read_only: true');
  });

  it.each(PRODUCTION_FRAGMENT_SCENARIOS)('$fragmentFile runs the image\'s own code with only ./var writable', async (scenario) => {
    const fragment = await readRepositoryFile(scenario.fragmentFile);

    expect(fragment).not.toContain('HOST_APP_DIR');
    expect(fragment).toMatch(/- \$\{FORGE_CACHE_DIR:-\/app\/var\/cache\}:rw,nosuid,nodev,.*,uid=\$\{RUNTIME_USER_UID:-33\},gid=\$\{RUNTIME_USER_GID:-33\},mode=0700$/mv);
    expect(fragment).toContain(`- forge-var:\${FORGE_VAR_DIR:-/app/var}`);
  });
});

describe('the Bun web fragments', () => {
  it.each(['compose/web-bun.yaml', 'compose/web-bun-dev.yaml'])(
    '%s provides the standard Bun server environment and unprivileged port',
    async (fragmentFile) => {
      const fragment = await readRepositoryFile(fragmentFile);

      expect(fragment).toContain('net.ipv4.ip_unprivileged_port_start: 0');
      expect(fragment).toContain('HOST: 0.0.0.0');
      expect(fragment).toContain('PORT: 80');
      expect(fragment).toContain('fetch(\'http://127.0.0.1:80/\')');
    },
  );
});
