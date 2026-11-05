# ⚙️ PHP worker [🔍](../../compose/php-worker.yaml 'Go to source')

`php-worker-dev` consumes Symfony Messenger transports from your working copy. `php-worker` does it from your own image.

## Usage

```yaml
# ./conf/compose.yaml

include:
  - path: oci://${FORGE_FRAGMENT_NAMESPACE:-${FORGE_NAMESPACE:?}}/forge-compose-php-worker-dev:${FORGE_TAG:?}@${FORGE_PHP_WORKER_DEV_FRAGMENT_DIGEST:?}
```

```ini
# ./.env

MESSENGER_TRANSPORTS=async scheduler_default

FORGE_TAG=<tag>
FORGE_APP_DEV_IMAGE_DIGEST=sha256:<digest> # <version>
FORGE_PHP_WORKER_DEV_FRAGMENT_DIGEST=sha256:<digest> # <version>
```

Both run the service `php-worker`:

```sh
bin/console messenger:consume async scheduler_default --time-limit=3600 --memory-limit=128M
```

`php-worker-dev` mounts your working copy like [`php-app-dev`](./php-app.md#development).
`php-worker` runs your own image like [`php-app`](./php-app.md#production) and reads the same files on the server.

Run more workers at once:

```sh
docker compose --file ./conf/compose.yaml up --detach --scale php-worker=3
```

A stopping worker gets its grace period. After that the transport hands the message out again.
Your handlers must survive running twice.

## Customizing

| Variable | Falls back to | Changes |
| --- | --- | --- |
| `PHP_WORKER_COMMAND` | — | what the service runs |
| `MESSENGER_TIME_LIMIT` | — | how long a worker runs before it restarts |
| `MESSENGER_MEMORY_LIMIT` | — | how much memory a worker uses before it restarts |
| `PHP_WORKER_STOP_GRACE_PERIOD` | — | how long a stopping worker may take to finish its message |
| `PHP_WORKER_CONTAINER_MEMORY_LIMIT` | — | how much memory the service may use |
| `PHP_WORKER_DEV_CONTAINER_MEMORY_LIMIT` | `PHP_WORKER_CONTAINER_MEMORY_LIMIT` | how much memory `php-worker-dev` may use |
| `PHP_WORKER_CONTAINER_PIDS_LIMIT` | — | how many processes the service may start |
| `PHP_WORKER_DEV_CONTAINER_PIDS_LIMIT` | `PHP_WORKER_CONTAINER_PIDS_LIMIT` | how many processes `php-worker-dev` may start |

The defaults are in [`php-worker.yaml`](../../compose/php-worker.yaml)
and [`php-worker-dev.yaml`](../../compose/php-worker-dev.yaml).

`MESSENGER_TIME_LIMIT` and `MESSENGER_MEMORY_LIMIT` only feed the default command. Another framework brings its own:

```ini
# ./.env

PHP_WORKER_COMMAND=php artisan queue:work --max-time=3600
```
