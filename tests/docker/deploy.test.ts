import {
  $,
  CryptoHasher,
  env,
  file,
  Glob,
  sleep,
  spawn,
} from 'bun';

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FORGE_DIRECTORY } from '#src/shared/make';
import { GHCR } from '#src/shared/registry';
import { objectFromEntries } from '#src/shared/utils/object';
import { readGroup } from '#src/shared/utils/pattern';
import { createDigest } from '#tests/support/digest';
import { createDirectory } from '#tests/support/directory';
import { git } from '#tests/support/git';
import { compareText, writeFiles } from '#tests/support/repository';
import { installStubs } from '#tests/support/stubs';

interface DeploymentOptions {
  readonly files?: Readonly<Record<string, string>>;
  readonly hosts?: string;
  readonly template?: string;
}

interface Deployment {
  readonly capture: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly project: string;
  readonly readCalls: () => Promise<string[]>;
  readonly run: (action: string, values?: Readonly<Record<string, string>>, target?: string) => Promise<DeployRun>;
  readonly getRemotePath: (...segments: string[]) => string;
  readonly getServerPath: (host: string, ...segments: string[]) => string;
}

interface RefusalScenario {
  readonly files: Readonly<Record<string, string>>;
  readonly message: string;
  readonly values: Readonly<Record<string, string>>;
}

interface ValuesScenario {
  readonly message: string;
  readonly service: string;
  readonly values: Readonly<Record<string, string>>;
}

interface ActionScenario {
  readonly action: string;
  readonly values: Readonly<Record<string, string>>;
}

interface RemovalScenario {
  readonly isDataKept: boolean;
  readonly values: Readonly<Record<string, string>>;
}

interface DeployRun {
  readonly exitCode: number;
  readonly standardError: string;
  readonly standardOutput: string;
}

const DEPLOY_SCRIPT = path.join(FORGE_DIRECTORY, 'docker/deploy.sh');
const DIGEST = createDigest('1');
const IMAGE = `${GHCR}/acme/acme-shop@${DIGEST}`;
const OLD_IMAGE = `${GHCR}/acme/acme-shop@${createDigest('3')}`;
const UNIQUE_IMAGE = `${GHCR}/acme/acme-shop@${createDigest('7')}`;
const POSTGRES_IMAGE = `postgres:1@${createDigest('2')}`;
const PROXY_IMAGE = `${GHCR}/acme/forge-php:1.0.0-app@${createDigest('4')}`;
const RUNNING_PROXY_IMAGE = `${GHCR}/acme/forge-php:0.9.0-app@${createDigest('8')}`;
const MAILPIT_IMAGE = `axllent/mailpit:1@${createDigest('6')}`;
const VALKEY_IMAGE = `valkey/valkey:1@${createDigest('5')}`;
const DEV_RUNTIME_IMAGE = `${GHCR}/acme/forge:1.0.0-app-dev@${createDigest('9')}`;
const POLL_MILLISECONDS = 50;
const TERMINATED_EXIT_CODE = 143;
const SSH_FAILURE_EXIT_CODE = 255;

const MAILPIT_LOGIN_MESSAGE = '`MAILPIT_SERVER_NAME` needs `MP_UI_AUTH` or `MP_UI_AUTH_FILE` in '
  + '`@SHARED@/.env.mailpit.local` on `one`.\n';

const createReleaseNamePattern = (): RegExp => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z_1\.0\.0$/v;

const PORTS_TEMPLATE = `name: acme-shop-production
services:
  php-app:
    image: @IMAGE@
    environment:
      APP_ENV: @APP_ENV@
      FORGE_CONTENT_SECURITY_POLICY: null
      FORGE_RELEASE: @RELEASE@
    env_file:
      - path: @SHARED@/.env.local
        required: false
    post_start:
      - command: @WARMUP@
    ports:
      - target: 80
  php-worker:
    image: @IMAGE@
  postgres:
    container_name: @PROJECT@-postgres
    image: ${POSTGRES_IMAGE}
`;

const PROXY_TEMPLATE = `${PORTS_TEMPLATE}  proxy:
    image: ${PROXY_IMAGE}
  valkey:
    image: ${VALKEY_IMAGE}
`;

const SHARED_VALKEY_TEMPLATE = `${PORTS_TEMPLATE}  valkey:
    command:
      - valkey-server
      - --appendonly
      - "yes"
    image: ${VALKEY_IMAGE}
`;

const ACL_VALKEY_FILE = [
  'services:',
  '  valkey:',
  '    command:',
  '      - valkey-server',
  '      - --aclfile',
  '      - /data/users.acl',
  '',
].join('\n');

const PREVIOUS_TEMPLATE = `${PORTS_TEMPLATE}  valkey:
    image: ${VALKEY_IMAGE}
`;

const PROXIED_TEMPLATE = PORTS_TEMPLATE.replaceAll('    ports:\n      - target: 80\n', '');

const SSH_STUB = `case " $* " in
  *" -O "*)
    exit 0
  ;;
esac

for argument do
  host=$remote_command
  remote_command=$argument
done

case $remote_command in
  *"$STUB_FAILING_READ"*)
    exit 255
  ;;
esac

exec sh -c "$(printf '%s' "$remote_command" | sed "s#$SERVER_ROOT/#$SERVER_ROOT/$host/#g")"`;

const DOCKER_STUB = String.raw`case " $* " in
  *" config --environment "*)
    if [ -n "$STUB_ENVIRONMENT_FAILS" ]; then
      exit 1
    fi

    previous=''

    for argument do
      if [ "$previous" = --env-file ]; then
        cat "$argument"
      fi

      previous=$argument
    done

    env
  ;;

  *" config --no-env-resolution "*)
    services=''
    is_after_config=''

    for argument do
      if [ -n "$is_after_config" ]; then
        services="$services $argument"
      fi

      case $argument in
        --no-path-resolution)
          is_after_config=1
        ;;

        *override.yaml)
          cp "$argument" "$STUB_CAPTURE/"
        ;;
      esac
    done

    sed \
      -e "s#@IMAGE@#$FORGE_APP_IMAGE#" \
      -e "s#@APP_ENV@#$DEPLOY_APP_ENV#" \
      -e "s#@RELEASE@#$FORGE_RELEASE#" \
      -e "s#@SHARED@#$FORGE_SHARED_DIR#" \
      -e "s#@PROJECT@#$COMPOSE_PROJECT_NAME#" \
      -e "s#@WARMUP@#$FORGE_WARMUP_COMMAND#" \
      "$STUB_RENDERED" | awk -v services="$services" '
        BEGIN { count = split(services, names, " "); for (i = 1; i <= count; i++) wanted[names[i]] = 1 }
        /^services:/ { print; is_in_services = 1; next }
        /^[^ ]/ { is_in_services = 0 }
        is_in_services && /^  [^ ]/ { name = substr($0, 3, length($0) - 3); is_kept = count == 0 || (name in wanted) }
        !is_in_services || is_kept { print }
      '
  ;;

  *" exec -i "*" sh -c psql "*)
    sql=$(cat)

    case $sql in
      *shobj_description*)
        printf '%s\n' "$STUB_ROLE_OWNER"
      ;;

      *pg_get_userbyid*)
        printf '%s\n' "$STUB_DATABASE_OWNER"
      ;;

      *"FROM pg_roles"*)
        if [ -n "$STUB_ROLE_OWNER$STUB_ROLE_EXISTS" ]; then
          printf '1\n'
        fi
      ;;

      *information_schema.tables*)
        printf '%s\n' "$STUB_TABLES"
      ;;
    esac
  ;;

  *" exec "*"-postgres sh -c pg_dump "*)
    case "$* " in
      *" sh $STUB_FAILING_DUMP ")
        exit 1
      ;;
    esac

    printf 'dump of %s\n' "$*"
  ;;

  *" exec -i "*" sh -c pg_restore "*)
    cat >/dev/null
  ;;

  *" exec forge-shared-valkey valkey-cli "*" --scan "*)
    printf '%s' "$STUB_SHARED_KEYS"
  ;;

  *" valkey-cli "*" --scan "*)
    printf 'session:1\nmessage:2\n'
  ;;

  *" valkey-cli "*" MIGRATE "*)
    printf '%s\n' "$STUB_MIGRATE_REPLY"
  ;;

  *" exec -i forge-shared-valkey valkey-cli --user forge ")
    cat >>"$STUB_CAPTURE/valkey-admin"

    if [ -n "$STUB_VALKEY_ADMIN_ERROR" ]; then
      printf '%s\n' "$STUB_VALKEY_ADMIN_ERROR"
    else
      printf 'OK\nOK\n'
    fi
  ;;

  *" exec -i forge-shared-valkey sha256sum ")
    sha256sum
  ;;

  *" exec forge-shared-valkey printenv VALKEYCLI_AUTH ")
    printf 'admin-secret\n'
  ;;

  *" exec -T postgres sh -c psql "*)
    printf '%s\n' $STUB_DATABASES
  ;;

  *" exec -T postgres sh -c pg_dump "*)
    case "$* " in
      *" sh $STUB_FAILING_DUMP ")
        exit 1
      ;;
    esac

    printf 'dump of %s\n' "$(basename "$PWD")"
  ;;

  *" exec -T postgres sh -c pg_restore "*)
    cat
  ;;

  *" sh /run/forge/$STUB_FAILING_HOOK.sh ")
    exit 1
  ;;

  *" stop $STUB_FAILING_STOP "*)
    stop_count_file=$STUB_CAPTURE/stop-count
    stop_count=0

    if [ -f "$stop_count_file" ]; then
      read -r stop_count <"$stop_count_file"
    fi

    stop_count=$((stop_count + 1))
    printf '%s\n' "$stop_count" >"$stop_count_file"

    if [ "$STUB_FAILING_STOP_COUNT" = _never ] || [ "$STUB_FAILING_STOP_COUNT" = "$stop_count" ]; then
      exit 1
    fi
  ;;

  *" run --rm --entrypoint test "*)
    exit "$STUB_CONSOLE_EXIT"
  ;;

  *" run --rm --entrypoint find "*)
    printf '%s' "$STUB_SHIPPED_FILES"
  ;;

  *" pull --quiet ")
    sleep "$STUB_PULL_SECONDS"
  ;;

  *" imagetools inspect "*)
    printf '%s\n' "$STUB_DIGEST"
  ;;

  *" ps --quiet php-app ")
    printf '%s\n' $STUB_OLD_CONTAINERS
  ;;

  *" ps --all --quiet php-app ")
    printf '%s\n' $STUB_OLD_CONTAINERS new-1
  ;;

  *" up --detach --no-deps"*" php-app ")
    case $PWD in
      *"$STUB_FAILING_RELEASE" | *"/$STUB_FAILING_HOST/srv/"*)
        exit 1
      ;;
    esac
  ;;

  *" exec -T proxy frankenphp reload "*)
    case $PWD in
      *"/$STUB_FAILING_SWITCH_HOST/srv/"*)
        exit 1
      ;;
    esac
  ;;
esac`;

const PROJECT_FILES = {
  '.env': 'COMPOSE_PROJECT_NAME=acme-shop\nDEPLOY_HOSTS=wrong.example\n',
  '.env.local': 'DEPLOY_HOSTS=local.example\n',
  '.env.production': [
    'IMAGE_NAME=acme-shop',
    'COMPOSE_FILE=./conf/compose.prod.yaml:./conf/compose.extra.yaml',
    'SERVER_NAME=acme-shop.example',
    '',
  ].join('\n'),
};

/**
 * @rejects {Error}
 */
const createDeployment = async (options: DeploymentOptions = {}): Promise<Deployment> => {
  const project = await createDirectory('forge-deploy-project-');
  const serverRoot = await createDirectory('forge-deploy-server-');
  const capture = await createDirectory('forge-deploy-capture-');

  const stubs = await installStubs({
    docker: DOCKER_STUB,
    ssh: SSH_STUB,
  });

  await writeFiles(project, {
    ...PROJECT_FILES,
    '.env.production.local': [
      `DEPLOY_HOSTS=${options.hosts ?? 'one'}`,
      `DEPLOY_PATH=${serverRoot}/srv/acme-shop`,
      `DEPLOY_SHARED_PATH=${serverRoot}/srv/forge-shared`,
      '',
    ].join('\n'),
    '.rendered.yaml': options.template ?? PORTS_TEMPLATE,
    ...options.files,
  });

  await git(project, 'init --quiet');
  await git(project, 'remote add origin git@example.com:acme/acme-shop.git');

  const environment = {
    HOME: env['HOME'] ?? '',
    PATH: stubs.environment.PATH,
    SERVER_ROOT: serverRoot,
    STUB_CAPTURE: capture,
    STUB_CONSOLE_EXIT: '0',
    STUB_DATABASES: 'acme',
    STUB_DIGEST: DIGEST,
    STUB_ENVIRONMENT_FAILS: '',
    STUB_FAILING_DUMP: '_never',
    STUB_DATABASE_OWNER: '',
    STUB_FAILING_HOOK: '_never',
    STUB_FAILING_HOST: '_never',
    STUB_FAILING_READ: '_never',
    STUB_FAILING_RELEASE: '_never',
    STUB_FAILING_STOP: '_never',
    STUB_FAILING_STOP_COUNT: '_never',
    STUB_FAILING_SWITCH_HOST: '_never',
    STUB_MIGRATE_REPLY: 'OK',
    STUB_OLD_CONTAINERS: '',
    STUB_PULL_SECONDS: '0',
    STUB_RENDERED: path.join(project, '.rendered.yaml'),
    STUB_ROLE_EXISTS: '',
    STUB_ROLE_OWNER: '',
    STUB_SHARED_KEYS: '',
    STUB_SHIPPED_FILES: '',
    STUB_TABLES: '0',
  };

  return {
    capture,
    environment,
    project,
    readCalls: stubs.readCalls,
    run: async (action, values = {}, target = 'production'): Promise<DeployRun> => {
      const deployRun = await $`sh ${DEPLOY_SCRIPT} ${action} ${target}`
        .cwd(project)
        .env({
          ...environment,
          ...values,
        })
        .quiet()
        .nothrow();

      return {
        exitCode: deployRun.exitCode,
        standardError: deployRun.stderr.toString(),
        standardOutput: deployRun.stdout.toString(),
      };
    },
    getRemotePath: (...segments): string => path.join(serverRoot, 'srv', ...segments),
    getServerPath: (host, ...segments): string => path.join(
      serverRoot,
      host,
      'srv',
      ...segments,
    ),
  };
};

/**
 * @rejects {Error}
 */
const doesPathExist = async (checkedPath: string): Promise<boolean> => {
  const test = await $`test -e ${checkedPath}`.quiet().nothrow();

  return test.exitCode === 0;
};

/**
 * @rejects {Error}
 */
const waitForPath = async (awaitedPath: string): Promise<void> => {
  if (await doesPathExist(awaitedPath)) {
    return;
  }

  await sleep(POLL_MILLISECONDS);
  await waitForPath(awaitedPath);
};

/**
 * @rejects {Error}
 */
const readReleases = async (deployment: Deployment): Promise<string[]> => {
  const releases = await Array.fromAsync(new Glob('*').scan({
    cwd: deployment.getServerPath('one', 'acme-shop/releases'),
    onlyFiles: false,
  }));

  return releases.toSorted(compareText);
};

/**
 * @rejects {Error}
 */
const readNewestRelease = async (deployment: Deployment): Promise<string> => {
  const releases = await readReleases(deployment);
  const newestRelease = releases.at(-1);

  if (newestRelease === undefined) {
    throw new Error('Host "one" holds no release.');
  }

  return newestRelease;
};

/**
 * @rejects {Error}
 */
const writeRelease = async (
  deployment: Deployment,
  release: string,
  image = OLD_IMAGE,
  template = PORTS_TEMPLATE,
): Promise<void> => {
  await writeFiles(deployment.getServerPath('one', 'acme-shop/releases', release), {
    'compose.yaml': template.split('@IMAGE@').join(image),
  });
};

/**
 * @rejects {Error}
 */
const pointCurrentAt = async (deployment: Deployment, release: string): Promise<void> => {
  await $`ln -sfn ${`releases/${release}`} ${deployment.getServerPath('one', 'acme-shop/current')}`.quiet();
};

/**
 * @rejects {Error}
 */
const readCurrent = async (deployment: Deployment, host = 'one'): Promise<string> => {
  const target = await $`readlink ${deployment.getServerPath(host, 'acme-shop/current')}`.text();

  return target.trim().replace('releases/', '');
};

/**
 * @rejects {Error}
 */
const readDockerCalls = async (deployment: Deployment): Promise<string[]> => {
  const calls = await deployment.readCalls();

  return calls.filter((call) => call.startsWith('docker ') && !call.includes(' config '));
};

describe('a deploy', () => {
  it('releases the image by digest, then migrates, hooks, switches and cleans up', async () => {
    const deployment = await createDeployment({
      files: {
        'composer.lock': [
          '"name": "symfony/framework-bundle",',
          '"name": "doctrine/doctrine-bundle",',
          '"name": "doctrine/doctrine-migrations-bundle",',
          '',
        ].join('\n'),
        'conf/deploy/after-migrate.sh': 'bin/console app:after-migrate\n',
        'conf/deploy/after-switch.sh': 'bin/console app:after-switch\n',
      },
    });

    const deployRun = await deployment.run('deploy', {
      VERSION: '1.0.0',
    });

    const release = await readNewestRelease(deployment);

    const compose = await file(deployment.getServerPath(
      'one',
      'acme-shop/releases',
      release,
      'compose.yaml',
    )).text();

    expect(deployRun.standardError).toBe('');
    expect(release).toMatch(createReleaseNamePattern());
    expect(compose).toContain(`image: ${IMAGE}`);
    expect(compose).toContain(`FORGE_RELEASE: ${release}`);
    expect(compose).toContain('container_name: acme-shop-postgres');
    expect(compose).toContain('- command: bin/console cache:warmup');
    expect(compose).not.toContain('FORGE_CONTENT_SECURITY_POLICY');
    await expect(readCurrent(deployment)).resolves.toBe(release);
    await expect(file(deployment.getServerPath('one', 'acme-shop/forge.lock/owner')).exists()).resolves.toBe(false);

    expect(deployRun.standardOutput).toBe([
      'one: lock',
      'one: check /app/var',
      `one: upload ${release}`,
      'one: pull',
      'one: start postgres',
      'one: back up postgres',
      'one: doctrine:database:create default',
      'one: doctrine:migrations:migrate default',
      'one: after-migrate.sh',
      'one: start php-app',
      `one: switch to ${release}`,
      'one: start the rest',
      'one: after-switch.sh',
      'one: clean up',
      'one: unlock',
      '',
    ].join('\n'));

    const hookPath = deployment.getServerPath(
      'one',
      'acme-shop/releases',
      release,
      'hooks/after-migrate.sh',
    );

    await expect(readDockerCalls(deployment))
      .resolves
      .toContain('docker compose --file compose.yaml run --rm --no-deps --no-TTY --env FORGE_ONE_OFF=1 '
        + `--volume ${hookPath}:/run/forge/after-migrate.sh:ro php-app sh /run/forge/after-migrate.sh`);
  });

  it('takes the recipes and Doctrine names a target sets, and no machine settings', async () => {
    const deployment = await createDeployment({
      files: {
        '.env.production': `${PROJECT_FILES['.env.production']}DEPLOY_RECIPES=doctrine\n`
          + 'DEPLOY_DOCTRINE_CONNECTIONS=default customer_db\nDEPLOY_DOCTRINE_ENTITY_MANAGERS=customer\n',
        'composer.lock': '"name": "doctrine/doctrine-migrations-bundle",\n',
      },
    });

    const deployRun = await deployment.run('deploy', {
      VERSION: '1.0.0',
    });

    expect(deployRun.standardOutput).toContain([
      'one: doctrine:database:create default',
      'one: doctrine:database:create customer_db',
      'one: doctrine:migrations:migrate customer',
      'one: start php-app',
    ].join('\n'));

    expect(deployRun.standardOutput).not.toContain('local.example');
    expect(deployRun.standardOutput).not.toContain('wrong.example');
  });

  it.each<RefusalScenario>([
    {
      message: 'Set `VERSION` to the image tag to deploy, e.g. `1.2.3` or `dev-1a2b3c4`.\n',
      files: {},
      values: {},
    },
    {
      message: 'A deploy reads its targets from the env files, which `DOTENV` turns off.\n',
      files: {},
      values: {
        DEPLOY_DOTENV_BASE: '',
        VERSION: '1.0.0',
      },
    },
    {
      message: '`conf/.env.production` does not exist, so `production` is not a target.\n',
      files: {},
      values: {
        DEPLOY_DOTENV_BASE: 'conf/.env',
        VERSION: '1.0.0',
      },
    },
    {
      message: 'Unknown recipe `larvel`, expected `symfony` or `doctrine`.\n',
      files: {
        '.env.production': `${PROJECT_FILES['.env.production']}DEPLOY_RECIPES=larvel\n`,
      },
      values: {
        VERSION: '1.0.0',
      },
    },
    {
      message: 'Production runs no `mailpit`, which catches every mail; send through a real `MAILER_DSN` instead.\n',
      files: {
        '.rendered.yaml': `${PORTS_TEMPLATE}  mailpit:\n    image: ${MAILPIT_IMAGE}\n`,
      },
      values: {
        VERSION: '1.0.0',
      },
    },
    {
      message: 'A release runs no hot reload, which watches every file; unset `FORGE_HOT_RELOAD`.\n',
      files: {
        '.rendered.yaml': `${PORTS_TEMPLATE}  scheduler:\n    image: @IMAGE@\n    environment:\n`
          + '      FORGE_HOT_RELOAD: "1"\n',
      },
      values: {
        VERSION: '1.0.0',
      },
    },
    {
      message: 'A release runs no hot reload, which watches every file; unset `FORGE_HOT_RELOAD`.\n',
      files: {
        '.env.production': `${PROJECT_FILES['.env.production']}FORGE_HOT_RELOAD=1\n`,
      },
      values: {
        VERSION: '1.0.0',
      },
    },
    {
      message: 'A release runs no `watch`, which restarts the workers on every file change; '
        + 'remove it from `FORGE_WORKER_CONFIG`.\n',
      files: {
        '.rendered.yaml': `${PORTS_TEMPLATE}  scheduler:\n    image: @IMAGE@\n    environment:\n`
          + '      FORGE_WORKER_CONFIG: watch ./src/**/*.php\n',
      },
      values: {
        VERSION: '1.0.0',
      },
    },
    {
      message: '`scheduler` mounts `/home/acme/acme-shop` over `/app`, which only development does; '
        + 'include the fragments without `-dev` instead.\n',
      files: {
        '.rendered.yaml': `${PORTS_TEMPLATE}  scheduler:\n    image: @IMAGE@\n    volumes:\n      - type: bind\n`
          + '        source: /home/acme/acme-shop\n        target: /app\n        bind: {}\n',
      },
      values: {
        VERSION: '1.0.0',
      },
    },
    {
      message: '`FORGE_APP_IMAGE` is an `-app-dev` image, which ships development tools; '
        + 'use the matching `-app` image instead.\n',
      files: {
        '.env.production': `${PROJECT_FILES['.env.production']}FORGE_APP_IMAGE=${DEV_RUNTIME_IMAGE}\n`,
      },
      values: {
        VERSION: '1.0.0',
      },
    },
    {
      message: 'Set `DEPLOY_WAIT_TIMEOUT` to the seconds a release may take to become healthy, e.g. `300`.\n',
      files: {
        '.env.production': `${PROJECT_FILES['.env.production']}DEPLOY_WAIT_TIMEOUT=5m\n`,
      },
      values: {
        VERSION: '1.0.0',
      },
    },
    {
      message: 'Set `COMPOSE_PROJECT_NAME` to the project\'s name in lowercase, e.g. `acme-shop`.\n',
      files: {
        '.env': 'COMPOSE_PROJECT_NAME=Acme Shop\n',
      },
      values: {
        VERSION: '1.0.0',
      },
    },
    {
      message: '`DEPLOY_PATH` holds an empty, `.`, or `..` segment.\n',
      files: {},
      values: {
        DEPLOY_PATH: '/srv/acme-shop/..',
        VERSION: '1.0.0',
      },
    },
    {
      message: '`DEPLOY_PATH` and `DEPLOY_SHARED_PATH` overlap.\n',
      files: {},
      values: {
        DEPLOY_PATH: '/srv/acme-shop',
        DEPLOY_SHARED_PATH: '/srv/acme-shop/shared',
        VERSION: '1.0.0',
      },
    },
    {
      message: '`-oProxyCommand=id` in `DEPLOY_HOSTS` is invalid.\n',
      files: {},
      values: {
        DEPLOY_HOSTS: '-oProxyCommand=id',
        VERSION: '1.0.0',
      },
    },
    {
      message: '`one:70000` in `DEPLOY_HOSTS` is invalid.\n',
      files: {},
      values: {
        DEPLOY_HOSTS: 'one:70000',
        VERSION: '1.0.0',
      },
    },
    {
      message: '`2001:db8::1` in `DEPLOY_HOSTS` is invalid.\n',
      files: {},
      values: {
        DEPLOY_HOSTS: '2001:db8::1',
        VERSION: '1.0.0',
      },
    },
    {
      message: 'Set `DEPLOY_KEEP_RELEASES` to a number of releases above zero, e.g. `5`.\n',
      files: {},
      values: {
        DEPLOY_KEEP_RELEASES: '000',
        VERSION: '1.0.0',
      },
    },
    {
      message: '`DEPLOY_DOCTRINE_CONNECTIONS` holds `default;id`; use letters, digits, and `_`.\n',
      files: {},
      values: {
        DEPLOY_DOCTRINE_CONNECTIONS: 'default;id',
        VERSION: '1.0.0',
      },
    },
    {
      message: 'Set `FORGE_VAR_DIR` to an absolute path of letters, digits, `.`, `_`, `-`, and `/`, e.g. `/app/var`.\n',
      files: {},
      values: {
        FORGE_VAR_DIR: '/app/var\'; id; \'',
        VERSION: '1.0.0',
      },
    },
    {
      message: '`SERVER_NAME` holds an invalid site address.\n',
      files: {},
      values: {
        SERVER_NAME: 'acme-shop.example { respond 1 }',
        VERSION: '1.0.0',
      },
    },
    {
      message: '`../staging` does not name a stage, which takes only letters, digits, `.`, `_`, and `-`, '
        + 'and never starts with `.`.\n',
      files: {},
      values: {
        DEPLOY_IMAGE: '../staging',
        VERSION: '1.0.0',
      },
    },
    {
      message: '`VALKEY_REQUIRE_ACL` holds `yes`; use `0` or `1`.\n',
      files: {},
      values: {
        VALKEY_REQUIRE_ACL: 'yes',
        VERSION: '1.0.0',
      },
    },
    {
      message: '`DEPLOY_ROLLBACK_RESTORE` holds `true`; use `0` or `1`.\n',
      files: {},
      values: {
        DEPLOY_ROLLBACK_RESTORE: 'true',
        VERSION: '1.0.0',
      },
    },
    {
      message: '`DEPLOY_REMOVE_DATA` holds `on`; use `0` or `1`.\n',
      files: {},
      values: {
        DEPLOY_REMOVE_DATA: 'on',
        VERSION: '1.0.0',
      },
    },
    {
      message: '`FORGE_HOT_RELOAD` holds `01`; use `0` or `1`.\n',
      files: {},
      values: {
        FORGE_HOT_RELOAD: '01',
        VERSION: '1.0.0',
      },
    },
    {
      message: '`valkey` has no `command` for `--aclfile`.\n',
      files: {
        '.env.production': `${PROJECT_FILES['.env.production']}DEPLOY_SHARED_SERVICES=valkey\nVALKEY_REQUIRE_ACL=1\n`,
        '.rendered.yaml': PROXY_TEMPLATE,
      },
      values: {
        VERSION: '1.0.0',
      },
    },
  ])('refuses before touching a server: $message', async (scenario) => {
    const deployment = await createDeployment({
      files: scenario.files,
    });

    const deployRun = await deployment.run('deploy', scenario.values);

    expect(deployRun.exitCode).toBe(1);
    expect(deployRun.standardError).toBe(scenario.message);
    await expect(doesPathExist(deployment.getServerPath('one', 'acme-shop/releases'))).resolves.toBe(false);
  });

  it.each([
    {
      action: 'deploy',
    },
    {
      action: 'unlock',
    },
  ])('refuses a target that is no stage name before connecting, even to $action', async (scenario) => {
    const deployment = await createDeployment();

    const deployRun = await deployment.run(
      scenario.action,
      {
        VERSION: '1.0.0',
      },
      '../production',
    );

    const calls = await deployment.readCalls();

    expect(deployRun.exitCode).toBe(1);

    expect(deployRun.standardError).toBe('`../production` is no deploy target, which takes only lowercase letters, '
      + 'digits, `_`, and `-`.\n');

    expect(calls.filter((call) => call.startsWith('ssh '))).toStrictEqual([]);
  });

  it('refuses an image whose var directory ships files, before uploading anything', async () => {
    const deployment = await createDeployment();

    const deployRun = await deployment.run('deploy', {
      STUB_SHIPPED_FILES: '/app/var/classes/Product.php',
      VERSION: '1.0.0',
    });

    expect(deployRun.exitCode).toBe(1);

    expect(deployRun.standardError).toBe('`/app/var` must be empty in the image, since its volume copies files '
      + 'only once and no later image could change them: /app/var/classes/Product.php\n');

    await expect(readReleases(deployment)).resolves.toStrictEqual([]);
  });

  it('refuses a Symfony image without bin/console', async () => {
    const deployment = await createDeployment({
      files: {
        'composer.lock': '"name": "symfony/framework-bundle",\n',
      },
    });

    const deployRun = await deployment.run('deploy', {
      STUB_CONSOLE_EXIT: '1',
      VERSION: '1.0.0',
    });

    expect(deployRun.exitCode).toBe(1);

    expect(deployRun.standardError).toBe('The image ships no `bin/console`, which Symfony runs from; add it to '
      + '`ARCHIVE_EXTRA_PATHS`.\n');
  });

  it.each([
    {
      databases: 'customer audit',
      message: 'one: create databases `customer` and `audit` in postgres\n',
    },
    {
      databases: 'customer;drop',
      message: '`POSTGRES_EXTRA_DATABASES` holds `customer;drop`; use letters, digits, and `_`.\n',
    },
  ])('creates the extra databases $databases only by plain names', async (scenario) => {
    const deployment = await createDeployment({
      files: {
        '.env.production': `${PROJECT_FILES['.env.production']}POSTGRES_EXTRA_DATABASES=${scenario.databases}\n`,
      },
    });

    const deployRun = await deployment.run('deploy', {
      VERSION: '1.0.0',
    });

    expect(`${deployRun.standardOutput}${deployRun.standardError}`).toContain(scenario.message);
  });

  it('leaves a lock it does not hold and says how to clear it', async () => {
    const deployment = await createDeployment();

    await writeFiles(deployment.getServerPath('one', 'acme-shop'), {
      'forge.lock/owner': '1970-01-01T00:00:00Z,a local deploy\n',
    });

    const deployRun = await deployment.run('deploy', {
      VERSION: '1.0.0',
    });

    expect(deployRun.exitCode).toBe(1);

    expect(deployRun.standardError).toBe('`one` is locked by `a local deploy` since `1970-01-01T00:00:00Z`. '
      + 'Once that run is gone, run `make production-deploy-unlock` or the workflow\'s `unlock` action.\n');

    await expect(file(deployment.getServerPath('one', 'acme-shop/forge.lock/owner')).exists()).resolves.toBe(true);

    await deployment.run('unlock');

    await expect(file(deployment.getServerPath('one', 'acme-shop/forge.lock/owner')).exists()).resolves.toBe(false);
  });

  it('marks an unhealthy release bad and brings the previous one back', async () => {
    const deployment = await createDeployment();

    await writeRelease(deployment, '1970-01-01T00-00-00Z_0.9.0');
    await pointCurrentAt(deployment, '1970-01-01T00-00-00Z_0.9.0');

    const deployRun = await deployment.run('deploy', {
      STUB_FAILING_RELEASE: '_1.0.0',
      VERSION: '1.0.0',
    });

    const failedRelease = await readNewestRelease(deployment);

    expect(deployRun.exitCode).toBe(1);
    expect(deployRun.standardError).toBe(`\`php-app\` of \`${failedRelease}\` did not become healthy on \`one\`.\n`);
    expect(deployRun.standardOutput).toContain('one: restore php-app of 1970-01-01T00-00-00Z_0.9.0\none: unlock\n');
    await expect(readCurrent(deployment)).resolves.toBe('1970-01-01T00-00-00Z_0.9.0');

    await expect(file(deployment.getServerPath(
      'one',
      'acme-shop/releases',
      failedRelease,
      'forge.bad',
    )).exists())
      .resolves
      .toBe(true);
  });

  it('keeps the newest releases, bad ones going first, and drops only images nothing kept uses', async () => {
    const deployment = await createDeployment();

    await writeRelease(deployment, '1970-01-01T00-00-00Z_0.1.0', UNIQUE_IMAGE);
    await writeRelease(deployment, '1970-01-02T00-00-00Z_0.2.0');
    await writeRelease(deployment, '1970-01-03T00-00-00Z_0.3.0');
    await writeRelease(deployment, '1970-01-04T00-00-00Z_0.4.0');
    await writeRelease(deployment, '1970-01-05T00-00-00Z_0.5.0');
    await writeRelease(deployment, '1970-01-06T00-00-00Z_0.6.0');

    await writeFiles(deployment.getServerPath('one', 'acme-shop/releases'), {
      '1970-01-04T00-00-00Z_0.4.0/forge.bad': '1970-01-01T00:00:00Z,a local deploy\n',
    });

    await deployment.run('deploy', {
      VERSION: '1.0.0',
    });

    const releases = await readReleases(deployment);
    const dockerCalls = await readDockerCalls(deployment);

    expect(releases).toStrictEqual([
      '1970-01-02T00-00-00Z_0.2.0',
      '1970-01-03T00-00-00Z_0.3.0',
      '1970-01-05T00-00-00Z_0.5.0',
      '1970-01-06T00-00-00Z_0.6.0',
      expect.stringMatching(createReleaseNamePattern()),
    ]);

    expect(dockerCalls.filter((call) => call.startsWith('docker image rm'))).toStrictEqual([
      `docker image rm ${UNIQUE_IMAGE}`,
    ]);
  });
});

describe('a failed deploy', () => {
  it('marks its release bad when it fails before the switch', async () => {
    const deployment = await createDeployment({
      files: {
        'conf/deploy/after-migrate.sh': 'exit 1\n',
      },
    });

    const deployRun = await deployment.run('deploy', {
      STUB_FAILING_HOOK: 'after-migrate',
      VERSION: '1.0.0',
    });

    const release = await readNewestRelease(deployment);

    expect(deployRun.exitCode).toBe(1);
    expect(deployRun.standardOutput).toContain('one: after-migrate.sh\none: unlock\n');

    await expect(file(deployment.getServerPath(
      'one',
      'acme-shop/releases',
      release,
      'forge.bad',
    )).exists())
      .resolves
      .toBe(true);
  });
});

describe('a managed dotenv', () => {
  it('fills the release last and lands beside the hand-written env files, readable by its owner only', async () => {
    const deployment = await createDeployment({
      files: {
        '.dotenv': 'DEPLOY_APP_ENV=dev\nAPP_SECRET=s3cr3t\n',
      },
    });

    const deployRun = await deployment.run('deploy', {
      DEPLOY_DOTENV_FILE: '.dotenv',
      VERSION: '1.0.0',
    });

    const release = await readNewestRelease(deployment);
    const sharedEnvironment = deployment.getServerPath('one', 'acme-shop/shared/.env.deploy.local');

    const compose = deployment.getServerPath(
      'one',
      'acme-shop/releases',
      release,
      'compose.yaml',
    );

    expect(deployRun.standardOutput).toContain('one: write .env.deploy.local\n');
    await expect(file(sharedEnvironment).text()).resolves.toBe('DEPLOY_APP_ENV=dev\nAPP_SECRET=s3cr3t\n');
    await expect(file(compose).text()).resolves.toContain('APP_ENV: dev\n');
    await expect($`stat -c %a ${sharedEnvironment} ${compose}`.text()).resolves.toBe('600\n600\n');
  });
});

describe('a rollback', () => {
  it('goes back one release per call, marking each it leaves', async () => {
    const deployment = await createDeployment();

    await writeRelease(deployment, '1970-01-01T00-00-00Z_0.1.0');
    await writeRelease(deployment, '1970-01-02T00-00-00Z_0.2.0');
    await writeRelease(deployment, '1970-01-03T00-00-00Z_0.3.0', IMAGE);
    await pointCurrentAt(deployment, '1970-01-03T00-00-00Z_0.3.0');

    const firstRollback = await deployment.run('rollback');

    expect(firstRollback.standardError).toBe('');
    await expect(readCurrent(deployment)).resolves.toBe('1970-01-02T00-00-00Z_0.2.0');

    await deployment.run('rollback');

    await expect(readCurrent(deployment)).resolves.toBe('1970-01-01T00-00-00Z_0.1.0');

    const lastRollback = await deployment.run('rollback');

    expect(lastRollback.exitCode).toBe(1);

    expect(lastRollback.standardError)
      .toBe('`one` has no release before `1970-01-01T00-00-00Z_0.1.0` to roll back to.\n');
  });
});

describe('a restart', () => {
  it('recreates only the services running the application image', async () => {
    const deployment = await createDeployment();

    await writeRelease(deployment, '1970-01-01T00-00-00Z_0.1.0', IMAGE);
    await pointCurrentAt(deployment, '1970-01-01T00-00-00Z_0.1.0');

    await deployment.run('restart');

    await expect(readDockerCalls(deployment)).resolves.toStrictEqual([
      'docker compose --file compose.yaml up --detach --no-deps --wait --wait-timeout 300 '
      + '--force-recreate php-app php-worker',
    ]);
  });

  it('stops where the server cannot tell what the release shares', async () => {
    const deployment = await createDeployment();

    await writeRelease(deployment, '1970-01-01T00-00-00Z_0.1.0', IMAGE);
    await pointCurrentAt(deployment, '1970-01-01T00-00-00Z_0.1.0');

    const restartRun = await deployment.run('restart', {
      STUB_FAILING_READ: 'forge.shared',
    });

    expect(restartRun.exitCode).toBe(SSH_FAILURE_EXIT_CODE);
    await expect(readDockerCalls(deployment)).resolves.toStrictEqual([]);
  });
});

describe('a deploy behind the proxy', () => {
  it('moves the proxy and the shared services to forge-shared and routes the application there', async () => {
    const deployment = await createDeployment({
      files: {
        '.env.production': `${PROJECT_FILES['.env.production']}DEPLOY_SHARED_SERVICES=valkey\n`,
      },
      template: PROXY_TEMPLATE,
    });

    const deployRun = await deployment.run('deploy', {
      VERSION: '1.0.0',
    });

    const release = await readNewestRelease(deployment);

    const releaseCompose = await file(deployment.getServerPath(
      'one',
      'acme-shop/releases',
      release,
      'compose.yaml',
    )).text();

    const proxyCompose = await file(deployment.getServerPath('one', 'forge-shared/proxy/compose.yaml')).text();
    const valkeyCompose = await file(deployment.getServerPath('one', 'forge-shared/valkey/compose.yaml')).text();
    const site = await file(deployment.getServerPath('one', 'forge-shared/sites/acme-shop.caddyfile')).text();
    const releaseOverride = await file(path.join(deployment.capture, 'release-override.yaml')).text();
    const sharedOverride = await file(path.join(deployment.capture, 'shared-override.yaml')).text();
    const dockerCalls = await readDockerCalls(deployment);

    expect(deployRun.standardError).toBe('');
    expect(releaseCompose).not.toContain('  proxy:');
    expect(releaseCompose).not.toContain('  valkey:');
    expect(proxyCompose).toContain('  proxy:');
    expect(proxyCompose).not.toContain('  valkey:');
    expect(valkeyCompose).toContain('  valkey:');
    expect(site).toContain('acme-shop.example {');
    expect(site).toContain('reverse_proxy acme-shop-app:80 {');
    expect(site).toContain('\t\thandle_response {\n\t\t\theader ?X-Frame-Options "DENY"\n');
    expect(site).toContain('\t\t\theader ?Strict-Transport-Security "max-age=31536000"\n');
    expect(site).toContain('\t\t\tcopy_response\n');
    expect(site).not.toContain('Content-Security-Policy');
    expect(releaseOverride).toContain('          - acme-shop-app\n      forge-shared-data: {}\n    ports: !reset []\n');
    expect(releaseOverride).toContain('  php-worker:\n    networks:\n      default: {}\n      forge-shared-data: {}\n');
    expect(sharedOverride).toContain('networks:\n  default:\n    name: forge-shared-data\n    external: true\n');
    expect(dockerCalls).toContain('docker network inspect forge-shared-data');
    expect(deployRun.standardOutput).toContain('one: start forge-shared-proxy\none: start forge-shared-valkey\n');
  });

  it('hands the ports of a release without the proxy over to it', async () => {
    const deployment = await createDeployment({
      template: PROXY_TEMPLATE,
    });

    await writeRelease(deployment, '1970-01-01T00-00-00Z_0.9.0');
    await pointCurrentAt(deployment, '1970-01-01T00-00-00Z_0.9.0');

    const deployRun = await deployment.run('deploy', {
      VERSION: '1.0.0',
    });

    const dockerCalls = await readDockerCalls(deployment);
    const releaseOverride = await file(path.join(deployment.capture, 'release-override.yaml')).text();

    expect(deployRun.standardOutput).toContain('one: stop php-app of 1970-01-01T00-00-00Z_0.9.0 for the proxy\n');
    expect(dockerCalls).toContain('docker compose --file compose.yaml rm --stop --force php-app');
    expect(dockerCalls.filter((call) => call.includes('forge-shared-data'))).toStrictEqual([]);
    expect(releaseOverride).not.toContain('forge-shared-data');
    expect(releaseOverride).not.toContain('  php-worker:');

    await expect(file(path.join(deployment.capture, 'shared-override.yaml')).text())
      .resolves
      .toContain('    container_name: forge-shared-proxy\n');
  });

  it('leaves a running shared service alone and reports what differs', async () => {
    const deployment = await createDeployment({
      template: PROXY_TEMPLATE,
    });

    await writeFiles(deployment.getServerPath('one', 'forge-shared/proxy'), {
      'compose.yaml': `services:\n  proxy:\n    image: ${RUNNING_PROXY_IMAGE}\n`,
    });

    const deployRun = await deployment.run('deploy', {
      VERSION: '1.0.0',
    });

    expect(deployRun.standardOutput).toContain(`one: \`proxy\` runs \`${RUNNING_PROXY_IMAGE}\`, this deploy pins \`${
      PROXY_IMAGE
    }\`; \`make production-deploy-shared\` moves it.\n`);

    expect(deployRun.standardOutput).not.toContain('start forge-shared');
  });
});

describe('several hosts', () => {
  it('run each step on every host before the next, each with its own user and port', async () => {
    const deployment = await createDeployment({
      files: {
        '.env.production': `${PROJECT_FILES['.env.production']}DEPLOY_USER=deploy\nDEPLOY_PORT=22\n`,
      },
      hosts: 'alice@one:2222 two',
    });

    const deployRun = await deployment.run('deploy', {
      VERSION: '1.0.0',
    });

    const calls = await deployment.readCalls();

    expect(deployRun.standardError).toBe('');

    const sshTargets = new Set(calls
      .filter((call) => call.startsWith('ssh -o ControlMaster=auto '))
      .map((call) => readGroup(/ -l (?<target>\S+ -p \S+ -- \S+) /v.exec(call)?.groups, 'target')));

    expect(deployRun.standardOutput).toMatch(/^alice@one:2222: lock\ntwo: lock\nalice@one:2222: check \S+\nalice@one:2222: upload \S+\ntwo: upload /v);

    expect(sshTargets).toStrictEqual(new Set([
      'alice -p 2222 -- one',
      'deploy -p 22 -- two',
    ]));
  });

  it('take IPv6 addresses in brackets', async () => {
    const deployment = await createDeployment({
      hosts: 'deploy@[2001:db8::1]:2222',
    });

    const unlockRun = await deployment.run('unlock');
    const calls = await deployment.readCalls();

    expect(unlockRun.standardError).toBe('');
    expect(calls).toContainEqual(expect.stringContaining(' -l deploy -p 2222 -- 2001:db8::1 '));
  });

  it('take back the application each started once another host fails it', async () => {
    const deployment = await createDeployment({
      hosts: 'one two',
      template: PROXY_TEMPLATE,
    });

    const deployRun = await deployment.run('deploy', {
      STUB_FAILING_HOST: 'two',
      STUB_OLD_CONTAINERS: 'old-1',
      VERSION: '1.0.0',
    });

    const release = await readNewestRelease(deployment);
    const dockerCalls = await readDockerCalls(deployment);

    expect(deployRun.exitCode).toBe(1);
    expect(deployRun.standardOutput).toContain(`one: remove php-app of ${release}\n`);

    expect(dockerCalls.filter((call) => call === 'docker rm --force new-1')).toStrictEqual([
      'docker rm --force new-1',
      'docker rm --force new-1',
    ]);

    expect(dockerCalls).not.toContain('docker rm --force old-1');
    await expect(file(deployment.getServerPath('one', 'acme-shop/forge.old')).exists()).resolves.toBe(false);
  });

  it('switch every host back once one fails to switch, before any old copy stops', async () => {
    const deployment = await createDeployment({
      hosts: 'one two',
      template: PROXY_TEMPLATE,
    });

    await writeRelease(
      deployment,
      '1970-01-01T00-00-00Z_0.9.0',
      OLD_IMAGE,
      PROXIED_TEMPLATE,
    );

    await pointCurrentAt(deployment, '1970-01-01T00-00-00Z_0.9.0');

    await writeFiles(deployment.getServerPath('one', 'forge-shared/sites'), {
      'acme-shop.caddyfile': 'old.acme-shop.example {\n}\n',
    });

    const deployRun = await deployment.run('deploy', {
      STUB_FAILING_SWITCH_HOST: 'two',
      STUB_OLD_CONTAINERS: 'old-1',
      VERSION: '1.0.0',
    });

    const release = await readNewestRelease(deployment);
    const dockerCalls = await readDockerCalls(deployment);

    expect(deployRun.exitCode).toBe(1);

    expect(deployRun.standardOutput).toContain([
      `one: switch back from ${release}`,
      `one: remove php-app of ${release}`,
      'one: restore php-app of 1970-01-01T00-00-00Z_0.9.0',
      `two: switch back from ${release}`,
      `two: remove php-app of ${release}`,
      '',
    ].join('\n'));

    await expect(readCurrent(deployment)).resolves.toBe('1970-01-01T00-00-00Z_0.9.0');
    await expect(doesPathExist(deployment.getServerPath('two', 'acme-shop/current'))).resolves.toBe(false);
    expect(dockerCalls).not.toContain('docker stop old-1');

    await expect(file(deployment.getServerPath('one', 'forge-shared/sites/acme-shop.caddyfile')).text())
      .resolves
      .toBe('old.acme-shop.example {\n}\n');

    await expect(doesPathExist(deployment.getServerPath('two', 'forge-shared/sites/acme-shop.caddyfile')))
      .resolves
      .toBe(false);
  });
});

describe('the backups', () => {
  it('dump each database before migrating and restore on request, the application stopped meanwhile', async () => {
    const deployment = await createDeployment();

    await deployment.run('deploy', {
      VERSION: '1.0.0',
    });

    const release = await readNewestRelease(deployment);

    await expect(file(deployment.getServerPath(
      'one',
      'acme-shop/shared/backups',
      release,
      'postgres/acme.dump',
    )).text())
      .resolves
      .toBe(`dump of ${release}\n`);

    const restoreRun = await deployment.run('restore');
    const dockerCalls = await readDockerCalls(deployment);

    expect(restoreRun.standardOutput).toContain(`one: restore postgres from ${release}\n`);

    const stopIndex = dockerCalls.indexOf('docker compose --file compose.yaml stop php-app php-worker');

    expect(stopIndex).toBeGreaterThan(-1);
    expect(dockerCalls[stopIndex + 1]).toContain('exec -T postgres sh -c pg_restore');
  });

  it('stop the deploy at the first database that fails to dump', async () => {
    const deployment = await createDeployment();

    const deployRun = await deployment.run('deploy', {
      STUB_DATABASES: 'acme analytics',
      STUB_FAILING_DUMP: 'acme',
      VERSION: '1.0.0',
    });

    expect(deployRun.exitCode).toBe(1);
    expect(deployRun.standardOutput).toContain('one: back up postgres\n');
    expect(deployRun.standardOutput).not.toContain('one: start php-app\n');
  });

  it('cover the target\'s own databases on a shared Postgres, and only those', async () => {
    const deployment = await createDeployment({
      files: {
        '.env.production': `${PROJECT_FILES['.env.production']}POSTGRES_DB=app\nPOSTGRES_EXTRA_DATABASES=audit\n`
          + 'POSTGRES_USER=acme\nPOSTGRES_PASSWORD=secret\nDEPLOY_SHARED_SERVICES=postgres\n',
      },
      template: PROXY_TEMPLATE,
    });

    await deployment.run('deploy', {
      VERSION: '1.0.0',
    });

    const release = await readNewestRelease(deployment);

    const backups = await Array.fromAsync(new Glob('*').scan({
      cwd: deployment.getServerPath(
        'one',
        'acme-shop/shared/backups',
        release,
        'forge-shared-postgres',
      ),
    }));

    const restoreRun = await deployment.run('restore');
    const dockerCalls = await readDockerCalls(deployment);

    expect(backups.toSorted(compareText)).toStrictEqual([
      'app.dump',
      'audit.dump',
    ]);

    expect(restoreRun.standardError).toBe('');
    expect(restoreRun.standardOutput).toContain(`one: restore forge-shared-postgres from ${release}\n`);

    expect(dockerCalls).toContain('docker exec -i forge-shared-postgres sh -c '
      + 'pg_restore --username "$POSTGRES_USER" --clean --if-exists --dbname "$1" sh audit');
  });

  it('restore on rollback only where the target asks for it', async () => {
    const deployment = await createDeployment({
      files: {
        '.env.production': `${PROJECT_FILES['.env.production']}DEPLOY_ROLLBACK_RESTORE=1\n`,
      },
    });

    await writeRelease(deployment, '1970-01-01T00-00-00Z_0.9.0');
    await pointCurrentAt(deployment, '1970-01-01T00-00-00Z_0.9.0');

    await deployment.run('deploy', {
      VERSION: '1.0.0',
    });

    const rollbackRun = await deployment.run('rollback');

    expect(rollbackRun.standardError).toBe('');
    expect(rollbackRun.standardOutput).toMatch(/one: restore postgres from \S+_1\.0\.0\n/v);
  });
});

describe('the shared services', () => {
  it('recreate on request, each in a project of its own, a shared mailpit requiring real logins', async () => {
    const deployment = await createDeployment({
      files: {
        '.env.staging': `${PROJECT_FILES['.env.production']}DEPLOY_SHARED_SERVICES=mailpit\n`,
      },
      template: `${PROXY_TEMPLATE}  mailpit:\n    image: ${MAILPIT_IMAGE}\n`,
    });

    await writeFiles(deployment.getServerPath('one', 'forge-shared/proxy'), {
      'compose.yaml': 'services:\n  proxy:\n    image: forge.invalid/old\n',
    });

    const sharedRun = await deployment.run(
      'shared',
      {
        DEPLOY_HOSTS: 'one',
        DEPLOY_PATH: deployment.getRemotePath('acme-shop'),
        DEPLOY_SHARED_PATH: deployment.getRemotePath('forge-shared'),
      },
      'staging',
    );

    expect(sharedRun.standardError).toBe('');

    const sharedOverride = await file(path.join(deployment.capture, 'shared-override.yaml')).text();

    expect(sharedRun.standardOutput).toBe('one: lock\none: start forge-shared-proxy\none: start forge-shared-mailpit\n'
      + 'one: unlock\n');

    await expect(file(deployment.getServerPath('one', 'forge-shared/proxy/compose.yaml')).text())
      .resolves
      .not
      .toContain('forge.invalid/old');

    await expect(file(deployment.getServerPath('one', 'forge-shared/mailpit/compose.yaml')).text())
      .resolves
      .toContain('  mailpit:');

    expect(sharedOverride).toContain('      MP_SMTP_AUTH_ACCEPT_ANY: "false"\n');

    expect(sharedOverride).toContain(`        source: ${deployment.getRemotePath('forge-shared/mailpit.passwd')}\n`);
    expect(sharedOverride).toContain('    networks:\n      default: {}\n      forge-shared: {}\n');
    expect(sharedOverride).toContain('    name: forge-shared-data\n    external: true\n  forge-shared:\n    external: true\n');
  });
});

describe('a move between a project and forge-shared', () => {
  it.each([
    {
      message: 'one: move app from acme-shop-postgres to forge-shared-postgres\n',
      service: 'postgres',
    },
    {
      message: 'one: move keys of database 0 from acme-shop-valkey to forge-shared-valkey\n',
      service: 'valkey',
    },
  ])('copies the data of $service into the shared service before migrating', async (scenario) => {
    const deployment = await createDeployment({
      files: {
        '.env.production': `${PROJECT_FILES['.env.production']}POSTGRES_DB=app\nPOSTGRES_USER=acme\n`
          + `POSTGRES_PASSWORD=it's\nDEPLOY_SHARED_SERVICES=${scenario.service}\n`,
      },
      template: PROXY_TEMPLATE,
    });

    await writeRelease(
      deployment,
      '1970-01-01T00-00-00Z_0.9.0',
      OLD_IMAGE,
      PREVIOUS_TEMPLATE,
    );

    await pointCurrentAt(deployment, '1970-01-01T00-00-00Z_0.9.0');

    const deployRun = await deployment.run('deploy', {
      VERSION: '1.0.0',
    });

    expect(deployRun.standardError).toBe('');
    expect(deployRun.standardOutput).toContain(scenario.message);
  });

  it.each<ValuesScenario>([
    {
      message: '`app` on `forge-shared-postgres` already holds tables, so nothing was moved.\n',
      service: 'postgres',
      values: {
        STUB_TABLES: '3',
      },
    },
    {
      message: 'Database `0` on `forge-shared-valkey` already holds keys, so nothing was moved.\n',
      service: 'valkey',
      values: {
        STUB_SHARED_KEYS: 'session:9\n',
      },
    },
  ])('never overwrites data the shared $service already holds', async (scenario) => {
    const deployment = await createDeployment({
      files: {
        '.env.production': `${PROJECT_FILES['.env.production']}POSTGRES_DB=app\nPOSTGRES_USER=acme\n`
          + `POSTGRES_PASSWORD=secret\nDEPLOY_SHARED_SERVICES=${scenario.service}\n`,
      },
      template: PROXY_TEMPLATE,
    });

    await writeRelease(
      deployment,
      '1970-01-01T00-00-00Z_0.9.0',
      OLD_IMAGE,
      PREVIOUS_TEMPLATE,
    );

    await pointCurrentAt(deployment, '1970-01-01T00-00-00Z_0.9.0');

    const deployRun = await deployment.run('deploy', {
      ...scenario.values,
      VERSION: '1.0.0',
    });

    expect(deployRun.exitCode).toBe(1);
    expect(deployRun.standardError).toBe(scenario.message);
  });
});

describe('a move that fails', () => {
  it.each<ValuesScenario>([
    {
      message: '`acme-shop-postgres` did not dump `app`.\n',
      service: 'postgres',
      values: {
        STUB_FAILING_DUMP: 'app',
      },
    },
    {
      message: '`acme-shop-valkey` did not move every key.\n',
      service: 'valkey',
      values: {
        STUB_MIGRATE_REPLY: 'IOERR error or timeout writing to target instance',
      },
    },
  ])('stops before the shared $service is used, naming what it holds', async (scenario) => {
    const deployment = await createDeployment({
      files: {
        '.env.production': `${PROJECT_FILES['.env.production']}POSTGRES_DB=app\nPOSTGRES_USER=acme\n`
          + `POSTGRES_PASSWORD=secret\nDEPLOY_SHARED_SERVICES=${scenario.service}\n`,
      },
      template: PROXY_TEMPLATE,
    });

    await writeRelease(
      deployment,
      '1970-01-01T00-00-00Z_0.9.0',
      OLD_IMAGE,
      PREVIOUS_TEMPLATE,
    );

    await pointCurrentAt(deployment, '1970-01-01T00-00-00Z_0.9.0');

    const deployRun = await deployment.run('deploy', {
      ...scenario.values,
      VERSION: '1.0.0',
    });

    expect(deployRun.exitCode).toBe(1);
    expect(deployRun.standardError).toBe(scenario.message);
    expect(deployRun.standardOutput).not.toContain('one: start php-app\n');
  });
});

describe('a shared Postgres', () => {
  it('refuses a login another project owns', async () => {
    const deployment = await createDeployment({
      files: {
        '.env.production': `${PROJECT_FILES['.env.production']}POSTGRES_DB=app\nPOSTGRES_USER=acme\n`
          + 'POSTGRES_PASSWORD=secret\nDEPLOY_SHARED_SERVICES=postgres\n',
      },
      template: PROXY_TEMPLATE,
    });

    const deployRun = await deployment.run('deploy', {
      STUB_ROLE_OWNER: 'beta-shop',
      VERSION: '1.0.0',
    });

    expect(deployRun.exitCode).toBe(1);
    expect(deployRun.standardError).toBe('Role `acme` belongs to `beta-shop`.\n');

    await expect(file(deployment.getServerPath('one', 'acme-shop/shared/.forge-postgres-password')).exists())
      .resolves
      .toBe(false);
  });
});

describe('unowned shared Postgres resources', () => {
  it.each<ValuesScenario>([
    {
      message: 'Role `acme` belongs to no project; adopt it with `COMMENT ON ROLE "acme" IS \'acme-shop\'`.\n',
      service: 'postgres',
      values: {
        STUB_ROLE_EXISTS: '1',
      },
    },
    {
      message: 'Database `app` belongs to `beta`.\n',
      service: 'postgres',
      values: {
        STUB_DATABASE_OWNER: 'beta',
      },
    },
  ])('claims neither a role nor a database nobody handed it: $message', async (scenario) => {
    const deployment = await createDeployment({
      files: {
        '.env.production': `${PROJECT_FILES['.env.production']}POSTGRES_DB=app\nPOSTGRES_USER=acme\n`
          + 'POSTGRES_PASSWORD=secret\nDEPLOY_SHARED_SERVICES=postgres\n',
      },
      template: PROXY_TEMPLATE,
    });

    const deployRun = await deployment.run('deploy', {
      ...scenario.values,
      VERSION: '1.0.0',
    });

    expect(deployRun.exitCode).toBe(1);
    expect(deployRun.standardError).toBe(scenario.message);
  });
});

describe('a shared Valkey requiring ACLs', () => {
  it('keeps its users on its volume and lets the deploy in through a generated admin', async () => {
    const deployment = await createDeployment({
      files: {
        '.env.staging': `${PROJECT_FILES['.env.production']}DEPLOY_SHARED_SERVICES=valkey\nVALKEY_REQUIRE_ACL=1\n`,
      },
      template: SHARED_VALKEY_TEMPLATE,
    });

    const sharedRun = await deployment.run(
      'shared',
      {
        DEPLOY_HOSTS: 'one',
        DEPLOY_PATH: deployment.getRemotePath('acme-shop'),
        DEPLOY_SHARED_PATH: deployment.getRemotePath('forge-shared'),
      },
      'staging',
    );

    expect(sharedRun.standardError).toBe('');

    await expect(file(deployment.getServerPath('one', 'forge-shared/valkey/compose.yaml')).text())
      .resolves
      .toContain('      - "yes"\n      - --aclfile\n      - /data/users.acl\n');

    await expect(file(path.join(deployment.capture, 'shared-override.yaml')).text())
      .resolves
      .toMatch(/^ {6}VALKEYCLI_AUTH: [\da-f]{48}$/mv);

    await expect(readDockerCalls(deployment)).resolves.toContainEqual(expect.stringContaining(
      'docker compose --file compose.yaml run --rm -T --no-deps --entrypoint sh valkey -c',
    ));

    await expect(file(deployment.getServerPath('one', 'forge-shared/valkey/.forge-admin-password')).exists())
      .resolves
      .toBe(false);
  });

  it('refuses a target without a password', async () => {
    const deployment = await createDeployment({
      files: {
        '.env.production': `${PROJECT_FILES['.env.production']}DEPLOY_SHARED_SERVICES=valkey\n`,
      },
      template: SHARED_VALKEY_TEMPLATE,
    });

    await writeFiles(deployment.getServerPath('one', 'forge-shared/valkey'), {
      'compose.yaml': ACL_VALKEY_FILE,
    });

    const deployRun = await deployment.run('deploy', {
      VERSION: '1.0.0',
    });

    expect(deployRun.exitCode).toBe(1);

    expect(deployRun.standardError)
      .toBe('The shared `valkey` requires ACLs; set `VALKEY_PASSWORD` for `production`.\n');
  });

  it('gives each target a user limited to its own keys', async () => {
    const deployment = await createDeployment({
      files: {
        '.env.production': `${PROJECT_FILES['.env.production']}DEPLOY_SHARED_SERVICES=valkey\nVALKEY_PASSWORD=secret\n`,
      },
      template: SHARED_VALKEY_TEMPLATE,
    });

    await writeFiles(deployment.getServerPath('one', 'forge-shared/valkey'), {
      'compose.yaml': ACL_VALKEY_FILE,
    });

    const deployRun = await deployment.run('deploy', {
      VERSION: '1.0.0',
    });

    const passwordHash = new CryptoHasher('sha256')
      .update('secret')
      .digest('hex');

    expect(deployRun.standardError).toBe('');
    expect(deployRun.standardOutput).toContain('one: prepare acme-shop on forge-shared-valkey\n');

    await expect(file(path.join(deployment.capture, 'valkey-admin')).text()).resolves.toBe(
      `ACL SETUSER acme-shop reset on #${passwordHash} ~acme-shop:* &acme-shop:* +@all -@dangerous\nACL SAVE\n`,
    );
  });

  it('fails without echoing the ACL change Valkey rejects', async () => {
    const deployment = await createDeployment({
      files: {
        '.env.production': `${PROJECT_FILES['.env.production']}DEPLOY_SHARED_SERVICES=valkey\nVALKEY_PASSWORD=secret\n`,
      },
      template: SHARED_VALKEY_TEMPLATE,
    });

    await writeFiles(deployment.getServerPath('one', 'forge-shared/valkey'), {
      'compose.yaml': ACL_VALKEY_FILE,
    });

    const passwordHash = new CryptoHasher('sha256')
      .update('secret')
      .digest('hex');

    const deployRun = await deployment.run('deploy', {
      STUB_VALKEY_ADMIN_ERROR: `(error) ERR Error in ACL SETUSER modifier '#${passwordHash}': Syntax error`,
      VERSION: '1.0.0',
    });

    expect(deployRun.exitCode).toBe(1);
    expect(deployRun.standardError).toBe('`forge-shared-valkey` rejected the ACL change.\n');
  });

  it('refuses to deploy beside a shared Valkey without them and names the action that turns them on', async () => {
    const deployment = await createDeployment({
      files: {
        '.env.production': `${PROJECT_FILES['.env.production']}DEPLOY_SHARED_SERVICES=valkey\nVALKEY_REQUIRE_ACL=1\n`,
      },
      template: SHARED_VALKEY_TEMPLATE,
    });

    await writeFiles(deployment.getServerPath('one', 'forge-shared/valkey'), {
      'compose.yaml': SHARED_VALKEY_TEMPLATE,
    });

    const deployRun = await deployment.run('deploy', {
      VERSION: '1.0.0',
    });

    expect(deployRun.exitCode).toBe(1);

    expect(deployRun.standardError).toBe('`forge-shared-valkey` on `one` runs without ACLs; '
      + 'run `make production-deploy-shared`.\n');

    await expect(readReleases(deployment)).resolves.toStrictEqual([]);
  });

  it('moves only the target\'s own keys, through the admin', async () => {
    const deployment = await createDeployment({
      files: {
        '.env.production': `${PROJECT_FILES['.env.production']}DEPLOY_SHARED_SERVICES=valkey\nVALKEY_PASSWORD=secret\n`,
      },
      template: SHARED_VALKEY_TEMPLATE,
    });

    await writeFiles(deployment.getServerPath('one', 'forge-shared/valkey'), {
      'compose.yaml': ACL_VALKEY_FILE,
    });

    await writeRelease(
      deployment,
      '1970-01-01T00-00-00Z_0.9.0',
      OLD_IMAGE,
      PREVIOUS_TEMPLATE,
    );

    await pointCurrentAt(deployment, '1970-01-01T00-00-00Z_0.9.0');

    const deployRun = await deployment.run('deploy', {
      VERSION: '1.0.0',
    });

    const dockerCalls = await readDockerCalls(deployment);

    expect(deployRun.standardError).toBe('');

    expect(dockerCalls)
      .toContain('docker exec forge-shared-valkey valkey-cli --user forge -n 0 --scan --pattern acme-shop:*');

    expect(dockerCalls).toContain('docker exec acme-shop-valkey valkey-cli -n 0 --scan --pattern acme-shop:*');

    expect(dockerCalls).toContain('docker exec acme-shop-valkey valkey-cli -n 0 '
      + 'MIGRATE forge-shared-valkey 6379  0 5000 COPY AUTH2 forge admin-secret KEYS session:1 message:2');
  });

  it('drops the user of a target taken off its server', async () => {
    const deployment = await createDeployment();

    await writeRelease(deployment, '1970-01-01T00-00-00Z_0.9.0');
    await pointCurrentAt(deployment, '1970-01-01T00-00-00Z_0.9.0');

    await writeFiles(deployment.getServerPath('one', 'acme-shop/releases/1970-01-01T00-00-00Z_0.9.0'), {
      'forge.shared': 'valkey\n',
    });

    await writeFiles(deployment.getServerPath('one', 'forge-shared/valkey'), {
      'compose.yaml': ACL_VALKEY_FILE,
    });

    const removalRun = await deployment.run('remove');

    expect(removalRun.standardError).toBe('');

    await expect(file(path.join(deployment.capture, 'valkey-admin')).text())
      .resolves
      .toBe('ACL DELUSER acme-shop\nACL SAVE\n');
  });
});

describe('a removal', () => {
  it.each<RemovalScenario>([
    {
      isDataKept: true,
      values: {},
    },
    {
      isDataKept: false,
      values: {
        DEPLOY_REMOVE_DATA: '1',
      },
    },
  ])('takes the target off its server, its data only on request ($values)', async (scenario) => {
    const deployment = await createDeployment();

    await writeRelease(deployment, '1970-01-01T00-00-00Z_0.9.0');
    await pointCurrentAt(deployment, '1970-01-01T00-00-00Z_0.9.0');

    await writeFiles(deployment.getServerPath('one', 'forge-shared/sites'), {
      'acme-shop.caddyfile': 'acme-shop.example {\n}\n',
    });

    await deployment.run('remove', scenario.values);

    const dockerCalls = await readDockerCalls(deployment);

    expect(dockerCalls).toContain(`docker compose --file compose.yaml down --remove-orphans${
      scenario.isDataKept ? '' : ' --volumes'
    }`);

    await expect(file(deployment.getServerPath('one', 'forge-shared/sites/acme-shop.caddyfile')).exists())
      .resolves
      .toBe(false);

    await expect(file(deployment.getServerPath('one', 'acme-shop/releases/1970-01-01T00-00-00Z_0.9.0/compose.yaml'))
      .exists())
      .resolves
      .toBe(scenario.isDataKept);
  });
});

describe('a failed switch to the proxy', () => {
  it('stops the proxy it created and brings the previous application back on its ports', async () => {
    const deployment = await createDeployment({
      template: PROXY_TEMPLATE,
    });

    await writeRelease(deployment, '1970-01-01T00-00-00Z_0.9.0');
    await pointCurrentAt(deployment, '1970-01-01T00-00-00Z_0.9.0');

    const deployRun = await deployment.run('deploy', {
      STUB_FAILING_RELEASE: '_1.0.0',
      VERSION: '1.0.0',
    });

    const dockerCalls = await readDockerCalls(deployment);

    expect(deployRun.exitCode).toBe(1);
    expect(deployRun.standardOutput).toContain('one: restore php-app of 1970-01-01T00-00-00Z_0.9.0 on its ports\n');
    expect(dockerCalls).toContain('docker compose --file compose.yaml down');
    expect(dockerCalls.at(-1)).toBe('docker compose --file compose.yaml up --detach --no-deps php-app');
  });
});

describe('the managed service files', () => {
  it('land beside the service that reads them, a shared mailpit\'s in forge-shared', async () => {
    const deployment = await createDeployment({
      files: {
        '.dotenv-mailpit': 'MP_UI_AUTH=alice:secret\n',
        '.dotenv-mercure': 'MERCURE_PUBLISHER_JWT_KEY=secret\n',
        '.env.staging': `${PROJECT_FILES['.env.production']}DEPLOY_SHARED_SERVICES=mailpit\n`,
      },
      template: `${PROXY_TEMPLATE}  mailpit:\n    image: ${MAILPIT_IMAGE}\n`,
    });

    await deployment.run(
      'deploy',
      {
        DEPLOY_DOTENV_MAILPIT_FILE: '.dotenv-mailpit',
        DEPLOY_DOTENV_MERCURE_FILE: '.dotenv-mercure',
        DEPLOY_HOSTS: 'one',
        DEPLOY_PATH: deployment.getRemotePath('acme-shop'),
        DEPLOY_SHARED_PATH: deployment.getRemotePath('forge-shared'),
        VERSION: '1.0.0',
      },
      'staging',
    );

    await expect(file(deployment.getServerPath('one', 'acme-shop/shared/.env.mercure.local')).text())
      .resolves
      .toBe('MERCURE_PUBLISHER_JWT_KEY=secret\n');

    await expect(file(deployment.getServerPath('one', 'forge-shared/.env.mailpit.local')).text())
      .resolves
      .toBe('MP_UI_AUTH=alice:secret\n');
  });
});

describe('a Mailpit behind the proxy', () => {
  it.each([
    {
      dotenv: 'MP_UI_AUTH=alice:secret\n',
      exitCode: 0,
      message: '',
    },
    {
      dotenv: 'MP_UI_AUTH_FILE=/run/secrets/mailpit-ui\n',
      exitCode: 0,
      message: '',
    },
    {
      dotenv: 'MP_MAX_MESSAGES=500\n',
      exitCode: 1,
      message: MAILPIT_LOGIN_MESSAGE,
    },
    {
      dotenv: 'MP_UI_AUTH=\n',
      exitCode: 1,
      message: MAILPIT_LOGIN_MESSAGE,
    },
    {
      dotenv: 'MP_UI_AUTH_FILE=""\n',
      exitCode: 1,
      message: MAILPIT_LOGIN_MESSAGE,
    },
  ])('routes only behind a login: $dotenv', async (scenario) => {
    const deployment = await createDeployment({
      files: {
        '.dotenv-mailpit': scenario.dotenv,
        '.env.staging': `${PROJECT_FILES['.env.production']}DEPLOY_SHARED_SERVICES=mailpit\n`
          + 'MAILPIT_SERVER_NAME=mail.acme-shop.example\n',
      },
      template: `${PROXY_TEMPLATE}  mailpit:\n    image: ${MAILPIT_IMAGE}\n`,
    });

    const deployRun = await deployment.run(
      'deploy',
      {
        DEPLOY_DOTENV_MAILPIT_FILE: '.dotenv-mailpit',
        DEPLOY_HOSTS: 'one',
        DEPLOY_PATH: deployment.getRemotePath('acme-shop'),
        DEPLOY_SHARED_PATH: deployment.getRemotePath('forge-shared'),
        VERSION: '1.0.0',
      },
      'staging',
    );

    expect(deployRun.exitCode).toBe(scenario.exitCode);
    expect(deployRun.standardError).toBe(scenario.message.split('@SHARED@').join(deployment.getRemotePath('forge-shared')));
  });

  it('gets the security headers it does not send, framing only its own pages', async () => {
    const deployment = await createDeployment({
      files: {
        '.dotenv-mailpit': 'MP_UI_AUTH=alice:secret\n',
        '.env.staging': `${PROJECT_FILES['.env.production']}DEPLOY_SHARED_SERVICES=mailpit\n`
          + 'MAILPIT_SERVER_NAME=mail.acme-shop.example\n',
      },
      template: `${PROXY_TEMPLATE}  mailpit:\n    image: ${MAILPIT_IMAGE}\n`,
    });

    const deployRun = await deployment.run(
      'deploy',
      {
        DEPLOY_DOTENV_MAILPIT_FILE: '.dotenv-mailpit',
        DEPLOY_HOSTS: 'one',
        DEPLOY_PATH: deployment.getRemotePath('acme-shop'),
        DEPLOY_SHARED_PATH: deployment.getRemotePath('forge-shared'),
        VERSION: '1.0.0',
      },
      'staging',
    );

    const site = await file(deployment.getServerPath('one', 'forge-shared/sites/acme-shop-staging.caddyfile')).text();

    expect(deployRun.exitCode).toBe(0);
    expect(site).toMatch(/^\treverse_proxy [\-a-z]+-mailpit:8025 \{\n\t{2}handle_response \{\n\t{3}header \?X-Frame-Options "SAMEORIGIN"$/mv);
  });
});

describe('the lock', () => {
  it('is held and released for an owner whose name holds a quote', async () => {
    const deployment = await createDeployment();

    const deployRun = await deployment.run('deploy', {
      GITHUB_REPOSITORY: 'acme/it\'s',
      GITHUB_RUN_ID: '1',
      GITHUB_SERVER_URL: 'https://github.example.com',
      VERSION: '1.0.0',
    });

    expect(deployRun.standardError).toBe('');
    expect(deployRun.exitCode).toBe(0);
    await expect(doesPathExist(deployment.getServerPath('one', 'acme-shop/forge.lock'))).resolves.toBe(false);
  });

  it('is held by one run at a time, naming its holder without the token that tells runs apart', async () => {
    const deployment = await createDeployment();
    const ownerPath = deployment.getServerPath('one', 'acme-shop/forge.lock/owner');

    const deployProcess = spawn([
      'sh',
      DEPLOY_SCRIPT,
      'deploy',
      'production',
    ], {
      cwd: deployment.project,
      env: {
        ...deployment.environment,
        STUB_PULL_SECONDS: '2',
        VERSION: '1.0.0',
      },
      stderr: 'pipe',
      stdout: 'pipe',
    });

    await waitForPath(ownerPath);

    const lockedRun = await deployment.run('deploy', {
      VERSION: '1.0.0',
    });

    const owner = await file(ownerPath).text();

    expect(owner).toMatch(/^[^,]+,a local deploy,[\da-f]{16}\n$/v);
    expect(lockedRun.standardOutput).toBe('one: lock\n');
    expect(lockedRun.standardError).toMatch(/^`one` is locked by `a local deploy` since `[^`]+`\. /v);
    await expect(deployProcess.exited).resolves.toBe(0);
    await expect(doesPathExist(deployment.getServerPath('one', 'acme-shop/forge.lock'))).resolves.toBe(false);
  });

  it('clears even when the env files cannot be read, as long as the hosts are known', async () => {
    const deployment = await createDeployment({
      files: {
        '.env.production': `${PROJECT_FILES['.env.production']}DEPLOY_WAIT_TIMEOUT=5m\n`,
      },
    });

    await writeFiles(deployment.getServerPath('one', 'acme-shop'), {
      'forge.lock/owner': '1970-01-01T00:00:00Z,a local deploy\n',
    });

    const unlockRun = await deployment.run('unlock', {
      DEPLOY_HOSTS: 'one',
      DEPLOY_PATH: deployment.getRemotePath('acme-shop'),
      STUB_ENVIRONMENT_FAILS: '1',
    });

    expect(unlockRun.exitCode).toBe(0);
    await expect(file(deployment.getServerPath('one', 'acme-shop/forge.lock/owner')).exists()).resolves.toBe(false);
  });

  it('is released when the deploy is terminated', async () => {
    const deployment = await createDeployment();

    const deployProcess = spawn([
      'sh',
      DEPLOY_SCRIPT,
      'deploy',
      'production',
    ], {
      cwd: deployment.project,
      env: {
        ...deployment.environment,
        STUB_PULL_SECONDS: '2',
        VERSION: '1.0.0',
      },
      stderr: 'pipe',
      stdout: 'pipe',
    });

    await waitForPath(deployment.getServerPath('one', 'acme-shop/forge.lock/owner'));

    deployProcess.kill('SIGTERM');

    await expect(deployProcess.exited).resolves.toBe(TERMINATED_EXIT_CODE);
    await expect(doesPathExist(deployment.getServerPath('one', 'acme-shop/forge.lock'))).resolves.toBe(false);
  });
});

describe('a symbolic link on the server', () => {
  it('may carry the deploy path onto another disk', async () => {
    const deployment = await createDeployment();
    const dataPath = deployment.getServerPath('one', 'data/acme-shop');

    await $`mkdir -p ${dataPath}`.quiet();
    await $`ln -s ${dataPath} ${deployment.getServerPath('one', 'acme-shop')}`.quiet();

    const deployRun = await deployment.run('deploy', {
      VERSION: '1.0.0',
    });

    expect(deployRun.standardError).toBe('');
    expect(deployRun.standardOutput).toContain('one: clean up\n');
  });

  it('refuses an env file that is a symbolic link', async () => {
    const deployment = await createDeployment();
    const sharedPath = deployment.getServerPath('one', 'acme-shop/shared');

    await $`mkdir -p ${sharedPath}`.quiet();
    await $`ln -s /etc/hostname ${path.join(sharedPath, '.env.local')}`.quiet();

    const deployRun = await deployment.run('deploy', {
      VERSION: '1.0.0',
    });

    expect(deployRun.exitCode).toBe(1);
    expect(deployRun.standardError).toBe(`\`${sharedPath}/.env.local\` is a symbolic link.\n`);
  });

  it('refuses a release compose file that is a symbolic link', async () => {
    const deployment = await createDeployment();
    const release = '1970-01-01T00-00-00Z_0.9.0';
    const composePath = deployment.getServerPath('one', `acme-shop/releases/${release}/compose.yaml`);

    await writeRelease(deployment, release);
    await $`rm ${composePath}`.quiet();
    await $`ln -s /etc/hostname ${composePath}`.quiet();

    const deployRun = await deployment.run('deploy', {
      VERSION: '1.0.0',
    });

    expect(deployRun.exitCode).toBe(1);
    expect(deployRun.standardError).toBe(`\`${composePath}\` is a symbolic link.\n`);
  });

  it('refuses a release directory that resolves outside releases', async () => {
    const deployment = await createDeployment();
    const deployPath = deployment.getServerPath('one', 'acme-shop');
    const releasePath = path.join(deployPath, 'releases/1970-01-01T00-00-00Z_0.9.0');
    const sharedPath = path.join(deployPath, 'shared');

    await $`mkdir -p ${path.dirname(releasePath)} ${sharedPath}`.quiet();
    await $`ln -s ${sharedPath} ${releasePath}`.quiet();

    const deployRun = await deployment.run('deploy', {
      VERSION: '1.0.0',
    });

    expect(deployRun.exitCode).toBe(1);
    expect(deployRun.standardError).toContain(`\`${releasePath}\` resolves outside`);
  });

  it.each<ActionScenario>([
    {
      action: 'deploy',
      values: {
        DEPLOY_KEEP_RELEASES: '1',
        VERSION: '1.0.0',
      },
    },
    {
      action: 'restore',
      values: {},
    },
    {
      action: 'remove',
      values: {
        DEPLOY_REMOVE_DATA: '1',
      },
    },
  ])('stops a $action whose releases lead outside the deploy path', async (scenario) => {
    const deployment = await createDeployment();
    const deployPath = deployment.getServerPath('one', 'acme-shop');
    const elsewhere = deployment.getServerPath('one', 'elsewhere');

    await $`mkdir -p ${elsewhere} ${deployPath}`.quiet();
    await $`ln -s ${elsewhere} ${path.join(deployPath, 'releases')}`.quiet();
    await writeRelease(deployment, '1970-01-01T00-00-00Z_0.9.0');
    await pointCurrentAt(deployment, '1970-01-01T00-00-00Z_0.9.0');

    const actionRun = await deployment.run(scenario.action, scenario.values);

    expect(actionRun.exitCode).toBe(1);
    expect(actionRun.standardError).toBe(`\`${deployPath}/releases\` resolves outside \`${deployPath}\`.\n`);

    await expect(file(path.join(elsewhere, '1970-01-01T00-00-00Z_0.9.0/compose.yaml')).exists())
      .resolves
      .toBe(true);
  });
});

describe('the hooks', () => {
  it('run each at its point of a deploy, a restore, a rollback and a removal', async () => {
    const deployment = await createDeployment({
      files: objectFromEntries([
        'after-migrate',
        'after-restore',
        'after-rollback',
        'after-switch',
        'before-migrate',
        'before-remove',
        'before-switch',
      ].map((hook) => <const>[`conf/deploy/${hook}.sh`, 'exit 0\n'])),
    });

    const firstRun = await deployment.run('deploy', {
      VERSION: '1.0.0',
    });

    const secondRun = await deployment.run('deploy', {
      VERSION: '1.0.1',
    });

    const release = await readNewestRelease(deployment);
    const restoreRun = await deployment.run('restore');
    const rollbackRun = await deployment.run('rollback');
    const removalRun = await deployment.run('remove');

    expect(firstRun.standardError).toBe('');

    expect(secondRun.standardOutput).toContain([
      'one: back up postgres',
      'one: before-migrate.sh',
      'one: after-migrate.sh',
      'one: start php-app',
      'one: before-switch.sh',
      `one: switch to ${release}`,
      'one: start the rest',
      'one: after-switch.sh',
      'one: clean up',
      '',
    ].join('\n'));

    expect(restoreRun.standardOutput).toContain('one: start the rest\none: after-restore.sh\n');
    expect(rollbackRun.standardOutput).toContain('one: start the rest\none: after-rollback.sh\n');
    expect(removalRun.standardOutput).toContain('one: before-remove.sh\none: remove acme-shop\n');
  });

  it('hand on-failure.sh the failed step and the release, in the image that failed', async () => {
    const deployment = await createDeployment({
      files: {
        'conf/deploy/before-switch.sh': 'exit 1\n',
        'conf/deploy/on-failure.sh': 'exit 0\n',
      },
    });

    const deployRun = await deployment.run('deploy', {
      STUB_FAILING_HOOK: 'before-switch',
      VERSION: '1.0.0',
    });

    const release = await readNewestRelease(deployment);
    const dockerCalls = await readDockerCalls(deployment);

    expect(deployRun.exitCode).toBe(1);
    expect(deployRun.standardOutput).toContain('one: before-switch.sh\n');
    expect(deployRun.standardOutput).toContain('one: on-failure.sh\none: unlock\n');

    expect(dockerCalls).toContainEqual(expect.stringContaining(
      `--env FORGE_FAILED_STEP=before-switch --env FORGE_RELEASE=${release} --volume `,
    ));
  });

  it('switch back every host where a step after the switch fails', async () => {
    const deployment = await createDeployment({
      files: {
        'conf/deploy/after-switch.sh': 'exit 1\n',
      },
    });

    await writeRelease(deployment, '1970-01-01T00-00-00Z_0.9.0');
    await pointCurrentAt(deployment, '1970-01-01T00-00-00Z_0.9.0');

    const deployRun = await deployment.run('deploy', {
      STUB_FAILING_HOOK: 'after-switch',
      VERSION: '1.0.0',
    });

    const release = await readNewestRelease(deployment);

    expect(deployRun.exitCode).toBe(1);

    expect(deployRun.standardOutput).toContain([
      `one: switch back from ${release}`,
      'one: restore php-app of 1970-01-01T00-00-00Z_0.9.0',
      'one: restore the rest of 1970-01-01T00-00-00Z_0.9.0',
      '',
    ].join('\n'));

    await expect(readCurrent(deployment)).resolves.toBe('1970-01-01T00-00-00Z_0.9.0');
  });

  it('keeps rollback armed until old application containers stop', async () => {
    const deployment = await createDeployment({
      template: PROXY_TEMPLATE,
    });

    await writeRelease(
      deployment,
      '1970-01-01T00-00-00Z_0.9.0',
      OLD_IMAGE,
      PROXIED_TEMPLATE,
    );

    await pointCurrentAt(deployment, '1970-01-01T00-00-00Z_0.9.0');

    await writeFiles(deployment.getServerPath('one', 'forge-shared/sites'), {
      'acme-shop.caddyfile': 'old.acme-shop.example {\n}\n',
    });

    const deployRun = await deployment.run('deploy', {
      STUB_FAILING_STOP: 'old-1',
      STUB_OLD_CONTAINERS: 'old-1',
      VERSION: '1.0.0',
    });

    expect(deployRun.exitCode).toBe(1);
    await expect(readCurrent(deployment)).resolves.toBe('1970-01-01T00-00-00Z_0.9.0');

    await expect(file(deployment.getServerPath('one', 'forge-shared/sites/acme-shop.caddyfile')).text())
      .resolves
      .toBe('old.acme-shop.example {\n}\n');
  });

  it('keeps every host rollbackable if stopping old containers fails on a later host', async () => {
    const deployment = await createDeployment({
      hosts: 'one two',
      template: PROXY_TEMPLATE,
    });

    await writeRelease(
      deployment,
      '1970-01-01T00-00-00Z_0.9.0',
      OLD_IMAGE,
      PROXIED_TEMPLATE,
    );

    await pointCurrentAt(deployment, '1970-01-01T00-00-00Z_0.9.0');

    await writeFiles(deployment.getServerPath('one', 'forge-shared/sites'), {
      'acme-shop.caddyfile': 'old.acme-shop.example {\n}\n',
    });

    const deployRun = await deployment.run('deploy', {
      STUB_FAILING_STOP: 'old-1',
      STUB_FAILING_STOP_COUNT: '2',
      STUB_OLD_CONTAINERS: 'old-1',
      VERSION: '1.0.0',
    });

    expect(deployRun.exitCode).toBe(1);
    expect(deployRun.standardOutput).toContain('one: restore php-app of 1970-01-01T00-00-00Z_0.9.0\n');

    await expect(readCurrent(deployment)).resolves.toBe('1970-01-01T00-00-00Z_0.9.0');
    await expect(doesPathExist(deployment.getServerPath('two', 'acme-shop/current'))).resolves.toBe(false);

    await expect(file(deployment.getServerPath('one', 'forge-shared/sites/acme-shop.caddyfile')).text())
      .resolves
      .toBe('old.acme-shop.example {\n}\n');

    await expect(doesPathExist(deployment.getServerPath('two', 'forge-shared/sites/acme-shop.caddyfile')))
      .resolves
      .toBe(false);
  });
});
