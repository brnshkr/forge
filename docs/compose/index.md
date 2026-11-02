# 🐳 Compose [🔍](../../compose/ 'Go to source')

Every service comes as a Compose fragment of its own, so your project includes only the ones it runs:

| Fragment | Service | Image prefix | Required | Docs |
| --- | --- | --- | --- | --- |
| [`forge/compose/cli`](../../compose/cli.yaml) | `cli` | `FORGE_CLI` | — | [CLI](./cli.md) |
| [`forge/compose/web-dev`](../../compose/web-dev.yaml) | `app` | `FORGE_APP` | `SERVER_NAME`, `APP_HTTP_PORT`, `APP_HTTPS_PORT` | [Development](./development.md) |
| [`forge/compose/web`](../../compose/web.yaml) | `app` | `FORGE_APP` | `SERVER_NAME`, `APP_HTTP_PORT`, `APP_HTTPS_PORT` | [Production](./production.md) |
| [`forge/compose/web-bun-dev`](../../compose/web-bun-dev.yaml) | `app` | `FORGE_APP` | `APP_HTTP_PORT` | [Bun app](./bun-app.md#development) |
| [`forge/compose/web-bun`](../../compose/web-bun.yaml) | `app` | `FORGE_APP` | `APP_HTTP_PORT` | [Bun app](./bun-app.md#production) |
| [`forge/compose/messenger-dev`](../../compose/messenger-dev.yaml) | `messenger` | `FORGE_APP` | `MESSENGER_TRANSPORTS` | [Messenger](./messenger.md) |
| [`forge/compose/messenger`](../../compose/messenger.yaml) | `messenger` | `FORGE_APP` | `MESSENGER_TRANSPORTS` | [Messenger](./messenger.md) |
| [`forge/compose/mercure`](../../compose/mercure.yaml) | `mercure` | `MERCURE` | `MERCURE_PUBLISHER_JWT_KEY`, `MERCURE_TRUSTED_ISSUERS` | [Mercure](./mercure.md) |
| [`forge/compose/proxy`](../../compose/proxy.yaml) | `proxy` | `PROXY` | — | [Zero downtime](../deploy/zero-downtime.md) |
| [`forge/compose/postgres`](../../compose/postgres.yaml) | `postgres` | `POSTGRES` | `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_USER` | [Postgres](./postgres.md) |
| [`forge/compose/valkey`](../../compose/valkey.yaml) | `valkey` | `VALKEY` | — | [Valkey](./valkey.md) |
| [`forge/compose/mailpit`](../../compose/mailpit.yaml) | `mailpit` | `MAILPIT` | `MAILPIT_MAX_MESSAGES`, `MAILPIT_SMTP_PORT`, `MAILPIT_WEB_PORT` | [Mailpit](./mailpit.md) |
| [`forge/compose/node`](../../compose/node.yaml) | `node` | `NODE` | — | [Tools](./tools.md) |
| [`forge/compose/semgrep`](../../compose/semgrep.yaml) | `semgrep` | `SEMGREP` | — | [Tools](./tools.md) |
| [`forge/compose/hadolint`](../../compose/hadolint.yaml) | `hadolint` | `HADOLINT` | — | [Tools](./tools.md) |
| [`forge/compose/actionlint`](../../compose/actionlint.yaml) | `actionlint` | `ACTIONLINT` | — | [Tools](./tools.md) |

A library includes `cli`; web projects use `web-dev` while developing and `web` in production. Bun projects use
`web-bun-dev` and `web-bun`.

## Usage

Include each fragment from a Forge release, pinned by its digest:

```yaml
# ./conf/compose.yaml

include:
  - path: oci://${FORGE_REPOSITORY}/compose/web-dev:${WEB_DEV_FRAGMENT_TAG:-${FORGE_TAG:?}}@${WEB_DEV_FRAGMENT_DIGEST:?}
  - path: oci://${FORGE_REPOSITORY}/compose/postgres:${POSTGRES_FRAGMENT_TAG:-${FORGE_TAG:?}}@${POSTGRES_FRAGMENT_DIGEST:?}
```

Then pin the release, one digest per fragment, and one per image the fragments run:

```dotenv
# ./.env

FORGE_TAG=<tag>
FORGE_APP_IMAGE_SUFFIX=-dev
FORGE_APP_IMAGE_DIGEST=sha256:<digest> # <version>

WEB_DEV_FRAGMENT_DIGEST=sha256:<digest> # <version>
POSTGRES_FRAGMENT_DIGEST=sha256:<digest> # <version>

POSTGRES_TAG=<tag>
POSTGRES_IMAGE_DIGEST=sha256:<digest> # <version>
```

You write these once; the bump keeps them current ([Pins docs](../pins.md#your-projects-pins)).
[`@brnshkr/config`](https://github.com/brnshkr/config)'s Makefile also sets `FORGE_REPOSITORY`, your user,
and your project's directory for Compose, and Compose names every variable that is still missing.

## Customizing

Each fragment takes the first image reference it can build, from the variables named after its prefix:

| Set | Runs |
| --- | --- |
| `FORGE_APP_IMAGE` | exactly that reference |
| `FORGE_APP_IMAGE_DIGEST` | `<FORGE_REPOSITORY_OWNER>/<FORGE_APP_IMAGE_NAME>:<FORGE_TAG><FORGE_APP_IMAGE_SUFFIX>@<digest>` |
| `POSTGRES_IMAGE` | exactly that reference |
| `POSTGRES_IMAGE_DIGEST` | `<POSTGRES_REPOSITORY>:<POSTGRES_TAG>@<digest>` |

Forge's own images share `FORGE_TAG` and come from `FORGE_REPOSITORY_OWNER`, e.g. `ghcr.io/brnshkr`,
the namespace above `FORGE_REPOSITORY`. `FORGE_CLI_IMAGE_NAME` and `FORGE_APP_IMAGE_NAME` pick the image,
`forge` and `forge-app` by default. Choose `forge-php-app` for a PHP-only app or `forge-bun-app` with the Bun fragments.
`FORGE_CLI_IMAGE_SUFFIX` and `FORGE_APP_IMAGE_SUFFIX` pick a tag suffix, e.g. `-dev`.
Every other image keeps its upstream repository unless you set one:

```dotenv
# ./.env

POSTGRES_REPOSITORY=ghcr.io/acme/postgres
VALKEY_IMAGE=valkey/valkey:<tag>@sha256:<digest>
```

A fragment comes from the release in `FORGE_TAG` unless its own tag says otherwise:

```dotenv
# ./.env

POSTGRES_FRAGMENT_TAG=<other-tag>
POSTGRES_FRAGMENT_DIGEST=sha256:<digest>
```

## Hardening

Every fragment runs the same way:

- a read-only root filesystem with a tmpfs on `/tmp`
- `cap_drop: ALL` and `no-new-privileges`
- `init`, `restart: unless-stopped`, and Docker's rotating `local` log driver
- a memory and a process limit, `<SERVICE>_CONTAINER_MEMORY_LIMIT` and `<SERVICE>_CONTAINER_PIDS_LIMIT`,
  e.g. `APP_CONTAINER_MEMORY_LIMIT`; `web-dev` and `messenger-dev` read `APP_DEV_CONTAINER_MEMORY_LIMIT` and
  `MESSENGER_DEV_CONTAINER_MEMORY_LIMIT` first, so your machine meets the limits a server sets
