# 📬 Mailpit [🔍](../../compose/mailpit.yaml 'Go to source')

`mailpit` catches every mail your app sends and shows it in a web interface.

## Usage

```yaml
# ./conf/compose.yaml

include:
  - path: oci://${FORGE_FRAGMENT_NAMESPACE:-${FORGE_NAMESPACE:?}}/forge-compose-mailpit:${FORGE_TAG:?}@${FORGE_MAILPIT_FRAGMENT_DIGEST:?}
```

```ini
# ./.env

COMPOSE_PROJECT_NAME=acme-shop
MAILPIT_MAX_MESSAGES=500
MAILPIT_SMTP_PORT=1025
MAILPIT_WEB_PORT=8025
MAILER_DSN=smtp://mailpit:1025

MAILPIT_TAG=<tag>
MAILPIT_IMAGE_DIGEST=sha256:<digest> # <version>
FORGE_MAILPIT_FRAGMENT_DIGEST=sha256:<digest> # <version>
```

Your app sends to the host `mailpit` on `MAILPIT_SMTP_PORT`. Any login is accepted, without TLS.
The web interface answers on `http://127.0.0.1:8025`. Mailpit keeps at most `MAILPIT_MAX_MESSAGES` mails.
They live in the volume `forge-mailpit-data` and survive a restart.

A deploy refuses `mailpit` in production. On another target it can run once per server for every project there.
Its logins then live in `shared/.env.mailpit.local`. Take a look at [shared services](../deploy/shared.md).

## Customizing

| Variable | Changes |
| --- | --- |
| `MAILPIT_HOST_IP` | where the web interface listens |
| `MAILPIT_REPOSITORY` | where the image comes from |
| `MAILPIT_CONTAINER_MEMORY_LIMIT` | how much memory the service may use |
| `MAILPIT_CONTAINER_PIDS_LIMIT` | how many processes the service may start |

The defaults are in [`mailpit.yaml`](../../compose/mailpit.yaml).
