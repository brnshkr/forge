# 🗄️ Postgres [🔍](../../compose/postgres.yaml 'Go to source')

`postgres` runs a PostgreSQL database for your app.

## Usage

```yaml
# ./conf/compose.yaml

include:
  - path: oci://${FORGE_FRAGMENT_NAMESPACE:-${FORGE_NAMESPACE:?}}/forge-compose-postgres:${FORGE_TAG:?}@${FORGE_POSTGRES_FRAGMENT_DIGEST:?}
```

```ini
# ./.env

COMPOSE_PROJECT_NAME=acme-shop
POSTGRES_DB=acme_shop
POSTGRES_USER=acme
POSTGRES_PASSWORD=acme

POSTGRES_TAG=<tag>
POSTGRES_IMAGE_DIGEST=sha256:<digest> # <version>
FORGE_POSTGRES_FRAGMENT_DIGEST=sha256:<digest> # <version>
```

The container is `acme-shop-postgres`. Your app reaches it at the host `postgres`, port `5432`.
It publishes no port on your machine. Its data lives in the volume `forge-postgres-data`.
The health check runs `pg_isready` for `POSTGRES_USER` and `POSTGRES_DB`.

On a server, `DEPLOY_SHARED_SERVICES=postgres` runs one Postgres for every project there,
with a role and a database per project. Take a look at [shared services](../deploy/shared.md).

## Customizing

| Variable | Changes |
| --- | --- |
| `POSTGRES_REPOSITORY` | where the image comes from |
| `POSTGRES_CONTAINER_MEMORY_LIMIT` | how much memory the service may use |
| `POSTGRES_CONTAINER_PIDS_LIMIT` | how many processes the service may start |

The defaults are in [`postgres.yaml`](../../compose/postgres.yaml).
