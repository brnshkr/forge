# 🐳 Compose [🔍](../../compose/ 'Go to source')

Compose fragments for your app, its workers, its services, and its tools, pinned by every Forge release.

## Usage

Include each fragment from the registry and pin it by digest:

```yaml
# ./conf/compose.yaml

include:
  - path: oci://${FORGE_FRAGMENT_NAMESPACE:-${FORGE_NAMESPACE:?}}/forge-compose-php-app-dev:${FORGE_TAG:?}@${FORGE_PHP_APP_DEV_FRAGMENT_DIGEST:?}
```

```ini
# ./.env

FORGE_TAG=<tag>
FORGE_PHP_APP_DEV_FRAGMENT_DIGEST=sha256:<digest> # <version>
```

A fragment's pin is named after it, in capitals with `_`, e.g. `FORGE_PHP_APP_DEV_FRAGMENT_DIGEST`.
Every fragment comes from the release in `FORGE_TAG`.
Read a digest once with `docker buildx imagetools inspect docker.io/brnshkr/forge-compose-php-app-dev:<tag>`.

[🛠️ `make`](https://github.com/brnshkr/config/blob/master/docs/Makefile.md) sets
`FORGE_NAMESPACE=docker.io/brnshkr` for the images and the fragments.
`FORGE_IMAGE_NAMESPACE` or `FORGE_FRAGMENT_NAMESPACE` moves only one of them, e.g. to `ghcr.io/brnshkr`.

### Without the shared Makefile

Put it in `.env` and pass your user to Compose:

```ini
# ./.env

FORGE_NAMESPACE=docker.io/brnshkr
```

```sh
HOST_UID=$(id -u) HOST_GID=$(id -g) docker compose --env-file ./.env --file ./conf/compose.yaml up --wait
```

### Full references

Write each reference out instead of building it from variables:

```yaml
# ./conf/compose.yaml

include:
  - path: oci://docker.io/brnshkr/forge-compose-php-app-dev:<tag>@sha256:<digest> # <version>
```

```ini
# ./.env

FORGE_APP_DEV_IMAGE=docker.io/brnshkr/forge:<tag>-app-dev@sha256:<digest> # <version>
```

The bump keeps both current. Switching registries then means editing every reference,
and nothing ties the fragment to its image's release the way `FORGE_TAG` does.

## Fragments

| Fragment | Service | Image | Required |
| --- | --- | --- | --- |
| [`cli`](./cli.md) | `cli` | `FORGE_CLI` | — |
| [`cli-chromium`](./cli.md) | `cli` | `FORGE_CLI_CHROMIUM` | — |
| [`php-app-dev`, `php-app`](./php-app.md) | `php-app` | `FORGE_APP_DEV`, `FORGE_APP` | `SERVER_NAME`, `APP_HTTP_PORT`, `APP_HTTPS_PORT` |
| [`php-worker-dev`, `php-worker`](./php-worker.md) | `php-worker` | `FORGE_APP_DEV`, `FORGE_APP` | `MESSENGER_TRANSPORTS` |
| [`bun-app-dev`, `bun-app`](./bun-app.md) | `bun-app` | `FORGE_APP_DEV`, `FORGE_APP` | `APP_HTTP_PORT` |
| [`bun-worker-dev`, `bun-worker`](./bun-worker.md) | `bun-worker` | `FORGE_APP_DEV`, `FORGE_APP` | — |
| [`mercure`](./mercure.md) | `mercure` | `MERCURE` | — |
| [`postgres`](./postgres.md) | `postgres` | `POSTGRES` | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` |
| [`valkey`](./valkey.md) | `valkey` | `VALKEY` | — |
| [`mailpit`](./mailpit.md) | `mailpit` | `MAILPIT` | `MAILPIT_MAX_MESSAGES`, `MAILPIT_SMTP_PORT`, `MAILPIT_WEB_PORT` |
| [`proxy`](../deploy/zero-downtime.md) | `proxy` | `PROXY` | — |
| [`node`, `semgrep`, `hadolint`, `actionlint`, `shellcheck`](./tools.md) | the same name | the same name in capitals | — |

The prefix names what runs. `php-` runs FrankenPHP, `bun-` runs Bun, and `cli` runs only the tools.
A `-dev` fragment runs your working copy on the `-app-dev` image.
Without `-dev`, it runs your own image on `-app`. A project may run both servers.

## Images

A Forge image resolves from its role's variables:

1. `FORGE_<ROLE>_IMAGE`, a full reference. A deploy sets `FORGE_APP_IMAGE`.
2. Else `<namespace>/<name>:<FORGE_TAG>-<role>@<FORGE_<ROLE>_IMAGE_DIGEST>`.

The namespace is `FORGE_IMAGE_NAMESPACE`, else `FORGE_NAMESPACE`.
The name is `FORGE_<ROLE>_IMAGE_NAME`, else `FORGE_IMAGE_NAME`, else `forge`.
The roles are `CLI` (`-cli`), `CLI_CHROMIUM` (`-cli-chromium`), `APP_DEV` (`-app-dev`), and `APP` (`-app`).
Take a look at the [images](../images/index.md) for what each one holds.

Any other image resolves from `<NAME>_IMAGE`, a full reference.
Without it, the image is `<NAME>_REPOSITORY`, the upstream image by default, with `<NAME>_TAG` and `<NAME>_IMAGE_DIGEST`:

```ini
# ./.env

POSTGRES_TAG=<tag>
POSTGRES_IMAGE_DIGEST=sha256:<digest> # <version>
```

`proxy` and `mercure` run `forge-php`'s `-app` image. `PROXY_TAG` and `MERCURE_TAG` hold a plain Forge version.
The fragment appends `-app`.
If a variable is missing, Compose names it. Where the name alone says too little, it adds a hint.

## Hardening

Every fragment extends the service `base` in [`./compose/base.yaml`](../../compose/base.yaml):

| Setting | Value |
| --- | --- |
| `restart` | `unless-stopped` |
| `logging.driver` | `local` |
| `init` | `true` |
| `read_only` | `true` |
| `cap_drop` | `ALL` |
| `security_opt` | `no-new-privileges:true` |

`cli`, `cli-chromium`, and the `-dev` fragments set `restart: no` instead.
After a Docker restart your checkout may not be mounted yet, so they stay down until a `make` command starts them.
Their health check fails while `/app` is empty.

A container writes only to its volumes, `/tmp`, and `/run`.
Both live in memory, with a size cap set in each fragment file.
Each container also has a memory limit and a process limit, listed on its page.
