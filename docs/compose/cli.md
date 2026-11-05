# ⌨️ CLI [🔍](../../compose/cli.yaml 'Go to source')

`cli` runs the tools of a library or tool on the `-cli` image. `cli-chromium` adds a browser for tests.

## Usage

```yaml
# ./conf/compose.yaml

include:
  - path: oci://${FORGE_FRAGMENT_NAMESPACE:-${FORGE_NAMESPACE:?}}/forge-compose-cli:${FORGE_TAG:?}@${FORGE_CLI_FRAGMENT_DIGEST:?}
```

```ini
# ./.env

FORGE_TAG=<tag>
FORGE_CLI_IMAGE_DIGEST=sha256:<digest> # <version>
FORGE_CLI_FRAGMENT_DIGEST=sha256:<digest> # <version>
```

For browser tests, include `cli-chromium` instead. Its pins are `FORGE_CLI_CHROMIUM_IMAGE_DIGEST`
and `FORGE_CLI_CHROMIUM_FRAGMENT_DIGEST`. Both run the service `cli`.

The service mounts your working copy read-write at `/app` and runs as `HOST_UID` and `HOST_GID`.
Its home `/home/forge` lives in the volume `forge-home`. Git settings and shell history survive there.
`host.docker.internal` reaches your machine, for step debugging.

[🛠️ `make`](https://github.com/brnshkr/config/blob/master/docs/Makefile.md) runs every tool in `cli`
when the project has no `php-app` or `bun-app`. `make shell` opens a shell in it.

### Without the shared Makefile

```sh
HOST_UID=$(id -u) HOST_GID=$(id -g) docker compose --env-file ./.env --file ./conf/compose.yaml run --rm cli sh
```

## Customizing

| Variable | Falls back to | Changes |
| --- | --- | --- |
| `CLI_COMMAND` | — | how the service waits |
| `CLI_CONTAINER_MEMORY_LIMIT` | — | how much memory the service may use |
| `CLI_CONTAINER_PIDS_LIMIT` | — | how many processes the service may start |
| `HOST_APP_DIR` | the current directory | what is mounted at `/app` |
| `HOST_UID`, `HOST_GID` | — | who writes the mounted directory |

The defaults are in [`cli.yaml`](../../compose/cli.yaml).

These pass through from `.env.local` without a rebuild: `TZ`, `LANG`, `LC_ALL`, `XDEBUG_MODE`, `XDEBUG_CONFIG`,
`PHP_IDE_CONFIG`, and `COMPOSER_AUTH`. The images carry only the `C.utf8` locale.
