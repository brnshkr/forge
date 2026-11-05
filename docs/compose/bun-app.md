# 🥟 Bun app [🔍](../../compose/bun-app.yaml 'Go to source')

`bun-app-dev` runs your Bun server from your working copy. `bun-app` runs it from your own image on a server.

## Usage

```yaml
# ./conf/compose.yaml

include:
  - path: oci://${FORGE_FRAGMENT_NAMESPACE:-${FORGE_NAMESPACE:?}}/forge-compose-bun-app-dev:${FORGE_TAG:?}@${FORGE_BUN_APP_DEV_FRAGMENT_DIGEST:?}
```

```ini
# ./.env

APP_HTTP_PORT=3000

FORGE_TAG=<tag>
FORGE_IMAGE_NAME=forge-bun
FORGE_APP_DEV_IMAGE_DIGEST=sha256:<digest> # <version>
FORGE_BUN_APP_DEV_FRAGMENT_DIGEST=sha256:<digest> # <version>
```

Both run the service `bun-app` with your `package.json` script `start`. They set `HOST=0.0.0.0` and `PORT=80`.
Your server listens there. The health check asks for `GET /` and accepts any status below 500.
The app answers plain HTTP on `http://127.0.0.1:3000`.

## Development

`bun-app-dev` runs `bun --watch run start` with `NODE_ENV=development`.
It mounts your working copy read-write at `/app` and runs as `HOST_UID` and `HOST_GID`.
Its home `/home/forge` lives in the volume `forge-home`. `host.docker.internal` reaches your machine.

To debug, turn on the inspector:

```ini
# ./.env.local

FORGE_INSPECT=1
```

The server then starts with `--inspect=0.0.0.0:6499/`. Attach to `ws://127.0.0.1:6499/` and map `/app`
to your working copy. To reach it from another device, see [`php-app`](./php-app.md#other-devices).

## Production

`bun-app` runs `bun run start` with `NODE_ENV=production`, read-only, with nothing mounted, as `www-data`.
It keeps the same paths and reads the same files on the server as [`php-app`](./php-app.md#production).
The [proxy](../deploy/zero-downtime.md) terminates HTTPS and routes to it.

## Customizing

| Variable | Falls back to | Changes |
| --- | --- | --- |
| `BUN_APP_COMMAND` | — | what the service runs |
| `BUN_APP_HTTP_PORT` | `APP_HTTP_PORT` | which port on your machine serves HTTP |
| `BUN_APP_INSPECT_PORT` | `APP_INSPECT_PORT` | which port on your machine the debugger listens on |
| `APP_HOST_IP` | — | where the ports listen |
| `BUN_APP_CONTAINER_MEMORY_LIMIT` | — | how much memory the service may use |
| `BUN_APP_DEV_CONTAINER_MEMORY_LIMIT` | `BUN_APP_CONTAINER_MEMORY_LIMIT` | how much memory `bun-app-dev` may use |
| `BUN_APP_CONTAINER_PIDS_LIMIT` | — | how many processes the service may start |
| `BUN_APP_DEV_CONTAINER_PIDS_LIMIT` | `BUN_APP_CONTAINER_PIDS_LIMIT` | how many processes `bun-app-dev` may start |

The defaults are in [`bun-app.yaml`](../../compose/bun-app.yaml)
and [`bun-app-dev.yaml`](../../compose/bun-app-dev.yaml).
