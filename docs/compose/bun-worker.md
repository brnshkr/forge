# 🧵 Bun worker [🔍](../../compose/bun-worker.yaml 'Go to source')

`bun-worker-dev` runs your queue worker from your working copy. `bun-worker` runs it from your own image.

## Usage

```yaml
# ./conf/compose.yaml

include:
  - path: oci://${FORGE_FRAGMENT_NAMESPACE:-${FORGE_NAMESPACE:?}}/forge-compose-bun-worker-dev:${FORGE_TAG:?}@${FORGE_BUN_WORKER_DEV_FRAGMENT_DIGEST:?}
```

```ini
# ./.env

FORGE_TAG=<tag>
FORGE_IMAGE_NAME=forge-bun
FORGE_APP_DEV_IMAGE_DIGEST=sha256:<digest> # <version>
FORGE_BUN_WORKER_DEV_FRAGMENT_DIGEST=sha256:<digest> # <version>
```

Both run the service `bun-worker` with your `package.json` script `worker`.
`bun-worker-dev` runs `bun --watch run worker` and mounts your working copy like [`bun-app-dev`](./bun-app.md#development).
`bun-worker` runs `bun run worker` from your own image like [`bun-app`](./bun-app.md#production).
A deploy starts the new worker once the new server answers.

Run more workers at once:

```sh
docker compose --file ./conf/compose.yaml up --detach --scale bun-worker=3
```

A stopping worker gets its grace period. Your jobs must survive running twice.

## Customizing

| Variable | Falls back to | Changes |
| --- | --- | --- |
| `BUN_WORKER_COMMAND` | — | what the service runs |
| `BUN_WORKER_STOP_GRACE_PERIOD` | — | how long a stopping worker may take to finish its job |
| `BUN_WORKER_CONTAINER_MEMORY_LIMIT` | — | how much memory the service may use |
| `BUN_WORKER_DEV_CONTAINER_MEMORY_LIMIT` | `BUN_WORKER_CONTAINER_MEMORY_LIMIT` | how much memory `bun-worker-dev` may use |
| `BUN_WORKER_CONTAINER_PIDS_LIMIT` | — | how many processes the service may start |
| `BUN_WORKER_DEV_CONTAINER_PIDS_LIMIT` | `BUN_WORKER_CONTAINER_PIDS_LIMIT` | how many processes `bun-worker-dev` may start |

The defaults are in [`bun-worker.yaml`](../../compose/bun-worker.yaml)
and [`bun-worker-dev.yaml`](../../compose/bun-worker-dev.yaml).
