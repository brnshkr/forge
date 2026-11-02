# 🗝️ Valkey [🔍](../../compose/valkey.yaml 'Go to source')

`forge/compose/valkey` runs Valkey with its data in the volume `forge-valkey-data`.
It writes every change to an append-only file once a second, so a crash loses about a second of sessions and messages.

## Usage

```yaml
# ./conf/compose.yaml

include:
  - path: oci://${FORGE_REPOSITORY}/compose/valkey:${VALKEY_FRAGMENT_TAG:-${FORGE_TAG:?}}@${VALKEY_FRAGMENT_DIGEST:?}
```

```dotenv
# ./.env

VALKEY_URL=valkey://valkey:6379
```

## Customizing

```dotenv
# ./.env.production

VALKEY_MAXMEMORY=512mb
VALKEY_CONTAINER_MEMORY_LIMIT=1g
```

`VALKEY_MAXMEMORY` caps what Valkey stores; when full it refuses writes rather than lose a session or message.
Keep `VALKEY_CONTAINER_MEMORY_LIMIT` at about twice that, since rewriting the append-only file forks the process.
`VALKEY_MAXMEMORY_POLICY=allkeys-lru` suits a Valkey that only caches.

A second Valkey extends the one you include, with a name, container, and volume of its own:

```yaml
# ./conf/compose.prod.yaml

services:
  valkey-sessions:
    extends:
      service: valkey
    container_name: ${COMPOSE_PROJECT_NAME}-valkey-sessions
    volumes: !override
      - forge-valkey-sessions-data:/data

volumes:
  forge-valkey-sessions-data: ~
```
