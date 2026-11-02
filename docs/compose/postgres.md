# 🗄️ Postgres [🔍](../../compose/postgres.yaml 'Go to source')

`forge/compose/postgres` runs PostgreSQL with its data in the volume `forge-postgres-data`.

## Usage

```yaml
# ./conf/compose.yaml

include:
  - path: oci://${FORGE_REPOSITORY}/compose/postgres:${POSTGRES_FRAGMENT_TAG:-${FORGE_TAG:?}}@${POSTGRES_FRAGMENT_DIGEST:?}
```

```dotenv
# ./.env

POSTGRES_DB=acme_shop
POSTGRES_USER=acme
POSTGRES_PASSWORD=<password>
```

## Customizing

A deploy creates the databases in `POSTGRES_EXTRA_DATABASES` beside `POSTGRES_DB` where they are missing,
named with letters, digits, and `_` only:

```dotenv
# ./.env.production

POSTGRES_EXTRA_DATABASES=customer_db audit
```

A second Postgres extends the one you include, with a name, container, and volume of its own,
the way the [Valkey docs](./valkey.md#customizing) show.
Before migrating, a deploy dumps every database of every Postgres it runs ([Server docs](../deploy/server.md#backups)).
