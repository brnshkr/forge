# 🧰 CLI [🔍](../../compose/cli.yaml 'Go to source')

`forge/compose/cli` runs Forge's toolchain image for a library or tool: it mounts your project at `/app`
and waits, so your tools run inside it.

## Usage

```yaml
# ./conf/compose.yaml

include:
  - path: oci://${FORGE_REPOSITORY}/compose/cli:${CLI_FRAGMENT_TAG:-${FORGE_TAG:?}}@${CLI_FRAGMENT_DIGEST:?}
```

```dotenv
# ./.env

FORGE_TAG=<tag>
FORGE_CLI_IMAGE_DIGEST=sha256:<digest> # <version>
CLI_FRAGMENT_DIGEST=sha256:<digest> # <version>
```

Run a tool in it with Compose:

```sh
docker compose --file ./conf/compose.yaml run --rm cli composer install
```

[`@brnshkr/config`](https://github.com/brnshkr/config)'s Makefile runs every tool there by itself where your project
has no `app` service, so `make ci` and `make shell` need no setting.

## Customizing

Pick the image by its name and tag suffix:

```dotenv
# ./.env

FORGE_CLI_IMAGE_NAME=forge-php
FORGE_CLI_IMAGE_SUFFIX=-chromium
```

| Image | Holds |
| --- | --- |
| `forge` | PHP, Composer, and Bun |
| `forge-php` | PHP and Composer |
| `forge-bun` | Bun |

Each one also comes as `-chromium` for browser tests ([Images docs](../images/index.md)).
`FORGE_COMMAND` replaces the command it waits with, and `CLI_CONTAINER_MEMORY_LIMIT` and `CLI_CONTAINER_PIDS_LIMIT`
its limits. Your Git settings and shell history live in the volume `forge-home`, so they survive new containers.
