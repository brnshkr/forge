# 📨 Messenger [🔍](../../compose/messenger.yaml 'Go to source')

`messenger` runs Symfony Messenger's workers, consuming the transports in `MESSENGER_TRANSPORTS`.
Its PHP runtime is `forge-app` by default, or `forge-php-app` when the project
does not need Bun.

## Usage

Include it beside the web fragment of the same kind:

| Beside | Include | Runs |
| --- | --- | --- |
| `web-dev` | `forge/compose/messenger-dev` | your working copy on the same `-dev` image |
| `web` | `forge/compose/messenger` | your own image |

```yaml
# ./conf/compose.yaml

include:
  - path: oci://${FORGE_REPOSITORY}/compose/messenger-dev:${MESSENGER_DEV_FRAGMENT_TAG:-${FORGE_TAG:?}}@${MESSENGER_DEV_FRAGMENT_DIGEST:?}
```

```dotenv
# ./.env

MESSENGER_TRANSPORTS=async scheduler_default
```

A worker exits after `MESSENGER_TIME_LIMIT` seconds or once it uses `MESSENGER_MEMORY_LIMIT`, and Docker starts
a fresh one. A deploy starts the new workers only after the new release serves, so two releases never consume at once.

## Customizing

```dotenv
# ./.env.production

MESSENGER_TIME_LIMIT=3600
MESSENGER_MEMORY_LIMIT=128M
MESSENGER_STOP_GRACE_PERIOD=60s
```

A stopping worker gets `MESSENGER_STOP_GRACE_PERIOD` to finish its message. After that the transport hands the message
out again, so every handler has to survive running twice.

More workers run side by side:

```sh
docker compose --file ./conf/compose.yaml up --detach --scale messenger=3
```
