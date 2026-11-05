import { describe, expect, it } from 'vitest';

import { joinContinuedLines } from '#src/shared/pins/split-pins';
import { packageName } from '#src/shared/utils/package-json';
import { readGroup } from '#src/shared/utils/pattern';
import { listRepositoryFiles, readRepositoryFile } from '#tests/support/repository';

const BASE_FILE = 'compose/base.yaml';
const COMPOSE_FILES = await listRepositoryFiles('compose/*.yaml');
const FRAGMENT_FILES = COMPOSE_FILES.filter((composeFile) => composeFile !== BASE_FILE);

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
  'compose/bun-app-dev.yaml',
  'compose/bun-worker-dev.yaml',
  'compose/php-app-dev.yaml',
  'compose/php-worker-dev.yaml',
]);

const FORGE_IMAGE_SCENARIOS = [
  {
    fragmentFile: 'compose/cli.yaml',
    prefix: 'FORGE_CLI',
    suffix: '-cli',
  },
  {
    fragmentFile: 'compose/cli-chromium.yaml',
    prefix: 'FORGE_CLI_CHROMIUM',
    suffix: '-cli-chromium',
  },
  ...[
    'bun-app',
    'bun-worker',
    'php-app',
    'php-worker',
  ].flatMap((fragment) => [
    {
      fragmentFile: `compose/${fragment}.yaml`,
      prefix: 'FORGE_APP',
      suffix: '-app',
    },
    {
      fragmentFile: `compose/${fragment}-dev.yaml`,
      prefix: 'FORGE_APP_DEV',
      suffix: '-app-dev',
    },
  ]),
];

const SERVER_PORT_SCENARIOS = [
  {
    fragmentFile: 'compose/bun-app.yaml',
    ports: ['HTTP'],
    service: 'BUN_APP',
  },
  {
    fragmentFile: 'compose/bun-app-dev.yaml',
    ports: ['HTTP'],
    service: 'BUN_APP',
  },
  {
    fragmentFile: 'compose/php-app.yaml',
    ports: ['HTTP', 'HTTPS'],
    service: 'PHP_APP',
  },
  {
    fragmentFile: 'compose/php-app-dev.yaml',
    ports: ['HTTP', 'HTTPS'],
    service: 'PHP_APP',
  },
];

const FRAGMENT_SCENARIOS = FRAGMENT_FILES.map((fragmentFile) => ({
  fragmentFile,
}));

const PRODUCTION_FRAGMENT_SCENARIOS = PRODUCTION_FRAGMENT_FILES.map((fragmentFile) => ({
  fragmentFile,
}));

describe('the base every fragment extends', () => {
  it('runs read only, unprivileged, and logs through Docker\'s rotating driver', async () => {
    const base = await readRepositoryFile(BASE_FILE);

    expect(base).toContain('restart: unless-stopped');
    expect(base).toMatch(/^ {4}logging:\n {6}driver: local$/mv);
    expect(base).toContain('init: true');
    expect(base).toContain('read_only: true');
    expect(base).toContain('cap_drop:\n      - ALL');
    expect(base).toContain('no-new-privileges:true');
  });

  it('holds no variable, since `compose publish` reads an extended file without interpolating it', async () => {
    await expect(readRepositoryFile(BASE_FILE)).resolves.not.toContain('${');
  });
});

describe('a published fragment', () => {
  it.each(FRAGMENT_SCENARIOS)('$fragmentFile runs only on a pinned image and extends the base', async (scenario) => {
    const fragment = joinContinuedLines(await readRepositoryFile(scenario.fragmentFile));

    expect(fragment).toMatch(/image: "\$\{(?<prefix>[A-Z_]+)_IMAGE:-.*:\$\{(?:\k<prefix>|FORGE)_TAG:\?.*@\$\{\k<prefix>_IMAGE_DIGEST:\?/v);
    expect(fragment).toMatch(/^services:\n {2}[\-a-z]+:\n {4}extends:\n {6}file: \.\/base\.yaml\n {6}service: base$/mv);
  });

  it.each(FORGE_IMAGE_SCENARIOS)('$fragmentFile runs the $suffix tag pinned by $prefix', async (scenario) => {
    const fragment = joinContinuedLines(await readRepositoryFile(scenario.fragmentFile));
    const imageName = `\${${scenario.prefix}_IMAGE_NAME:-\${FORGE_IMAGE_NAME:-${packageName}}}`;

    expect(fragment).toContain(`image: "\${${scenario.prefix}_IMAGE:-`);
    expect(fragment).toContain(`/${imageName}:\${FORGE_TAG:?`);
    expect(fragment).toContain(`}${scenario.suffix}@\${${scenario.prefix}_IMAGE_DIGEST:?`);
  });

  it.each(SERVER_PORT_SCENARIOS)('$fragmentFile publishes ports of its own, falling back to the deploy\'s', async (scenario) => {
    const fragment = await readRepositoryFile(scenario.fragmentFile);

    for (const port of scenario.ports) {
      expect(fragment).toContain(`\${${scenario.service}_${port}_PORT:-\${APP_${port}_PORT:?}}`);
    }
  });

  it.each(FRAGMENT_SCENARIOS)('$fragmentFile fixes its container name only where copies would share data', async (scenario) => {
    const fragment = await readRepositoryFile(scenario.fragmentFile);

    expect(fragment.includes('container_name:')).toBe(SINGLE_INSTANCE_FRAGMENT_FILES.has(scenario.fragmentFile));
  });

  it.each(FRAGMENT_SCENARIOS)('$fragmentFile limits memory and processes, a development twin falling back to production', async (scenario) => {
    const fragment = await readRepositoryFile(scenario.fragmentFile);

    const service = readGroup(/^services:\n {2}(?<service>[\-a-z]+):$/mv.exec(fragment)?.groups, 'service')
      .toUpperCase()
      .replaceAll('-', '_');

    const createLimitPrefix = (limit: string): string => (DEVELOPMENT_TWIN_FRAGMENT_FILES.has(scenario.fragmentFile)
      ? `\${${service}_DEV_CONTAINER_${limit}_LIMIT:-\${${service}_CONTAINER_${limit}_LIMIT:-`
      : `\${${service}_CONTAINER_${limit}_LIMIT:-`);

    expect(fragment).toContain(`    mem_limit: ${createLimitPrefix('MEMORY')}`);
    expect(fragment).toContain(`    pids_limit: ${createLimitPrefix('PIDS')}`);
  });

  it.each(PRODUCTION_FRAGMENT_SCENARIOS)('$fragmentFile runs the image\'s own code with only ./var writable', async (scenario) => {
    const fragment = await readRepositoryFile(scenario.fragmentFile);

    expect(fragment).not.toContain('HOST_APP_DIR');
    expect(fragment).toMatch(/- \$\{FORGE_CACHE_DIR:-\/app\/var\/cache\}:rw,nosuid,nodev,.*,uid=\$\{RUNTIME_USER_UID:-33\},gid=\$\{RUNTIME_USER_GID:-33\},mode=0700$/mv);
    expect(fragment).toContain(`- forge-var:\${FORGE_VAR_DIR:-/app/var}`);
  });
});

describe('the Bun app fragments', () => {
  it.each(['compose/bun-app.yaml', 'compose/bun-app-dev.yaml'])(
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

describe('the Mailpit fragment', () => {
  it('keeps its mails in a volume over the image\'s world-writable /var/tmp, not in the capped /tmp', async () => {
    const fragment = await readRepositoryFile('compose/mailpit.yaml');

    expect(fragment).toContain('MP_DATABASE: /var/tmp/mailpit.db');
    expect(fragment).toContain('- forge-mailpit-data:/var/tmp');
  });
});
