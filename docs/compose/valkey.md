# 🔑 Valkey [🔍](../../compose/valkey.yaml 'Go to source')

`valkey` runs a Valkey server for your app's cache, sessions, or queues.

## Usage

```yaml
# ./conf/compose.yaml

include:
  - path: oci://${FORGE_FRAGMENT_NAMESPACE:-${FORGE_NAMESPACE:?}}/forge-compose-valkey:${FORGE_TAG:?}@${FORGE_VALKEY_FRAGMENT_DIGEST:?}
```

```ini
# ./.env

COMPOSE_PROJECT_NAME=acme-shop

VALKEY_TAG=<tag>
VALKEY_IMAGE_DIGEST=sha256:<digest> # <version>
FORGE_VALKEY_FRAGMENT_DIGEST=sha256:<digest> # <version>
```

The container is `acme-shop-valkey`. Your app reaches it at the host `valkey`, port `6379`.
It publishes no port on your machine. It writes an append-only file every second to the volume `forge-valkey-data`.
Once full, it refuses writes instead of dropping keys.

On a server, `DEPLOY_SHARED_SERVICES=valkey` runs one Valkey for every project there.
Each project then needs `VALKEY_PASSWORD`. Take a look at [shared services](../deploy/shared.md).

## Customizing

| Variable | Changes |
| --- | --- |
| `VALKEY_MAXMEMORY` | how much memory Valkey keeps data in |
| `VALKEY_MAXMEMORY_POLICY` | what Valkey does once that memory is full |
| `VALKEY_REPOSITORY` | where the image comes from |
| `VALKEY_CONTAINER_MEMORY_LIMIT` | how much memory the service may use |
| `VALKEY_CONTAINER_PIDS_LIMIT` | how many processes the service may start |

The defaults are in [`valkey.yaml`](../../compose/valkey.yaml).
