# Bun app [🔍](../../compose/web-bun.yaml 'Go to source')

The Bun fragments run your app on port `80` as an unprivileged user.
The app must read `HOST` and `PORT`, or configure its server to listen on
`0.0.0.0:80`. The health check requests `/` and accepts any response below `500`.

## Development

Include `forge/compose/web-bun-dev` while developing from your working copy:

```yaml
# ./conf/compose.yaml

include:
  - path: oci://${FORGE_REPOSITORY}/compose/web-bun-dev:${WEB_BUN_DEV_FRAGMENT_TAG:-${FORGE_TAG:?}}@${WEB_BUN_DEV_FRAGMENT_DIGEST:?}
```

```dotenv
# ./.env

FORGE_TAG=<tag>
FORGE_APP_IMAGE_NAME=forge-bun-app
FORGE_APP_IMAGE_SUFFIX=-dev
FORGE_APP_IMAGE_DIGEST=sha256:<digest> # <version>
WEB_BUN_DEV_FRAGMENT_DIGEST=sha256:<digest> # <version>

APP_HTTP_PORT=3000
```

The default command is `bun --watch run start`. Override `FORGE_COMMAND` for
another script. This fragment serves HTTP only; include a proxy fragment if you
need HTTPS locally.

`FORGE_INSPECT=1` starts it with Bun's debugger, which your editor attaches to at `ws://127.0.0.1:6499/`
(`APP_HOST_IP` and `APP_INSPECT_PORT`), mapping `/app` to your working copy.

## Production

Include `forge/compose/web-bun` with your own pinned application image:

```yaml
# ./conf/compose.prod.yaml

include:
  - path: oci://${FORGE_REPOSITORY}/compose/web-bun:${WEB_BUN_FRAGMENT_TAG:-${FORGE_TAG:?}}@${WEB_BUN_FRAGMENT_DIGEST:?}
```

```dotenv
# ./.env.production

FORGE_APP_IMAGE=ghcr.io/acme/acme-shop:<tag>@sha256:<digest>
WEB_BUN_FRAGMENT_DIGEST=sha256:<digest> # <version>
APP_HTTP_PORT=3000
```

The default command is `bun run start`. The fragment exposes HTTP on loopback by
default; a Forge proxy can route traffic to `app:80` and terminate HTTPS.
Deployments use the same `app` service and `shared/.env.*.local` files as the
PHP web fragments.
