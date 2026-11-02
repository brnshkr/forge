# 🏭 Production [🔍](../../compose/web.yaml 'Go to source')

`forge/compose/web` and `forge/compose/messenger` run your own PHP image, which holds your code, so nothing is mounted.
Both run read-only as `www-data` and can only write `var/`.
They use `forge-app` by default; set `FORGE_APP_IMAGE_NAME=forge-php-app` for a
PHP-only runtime. For Bun-only apps, see [the Bun fragments](./bun-app.md).

## Usage

```yaml
# ./conf/compose.prod.yaml

include:
  - path: oci://${FORGE_REPOSITORY}/compose/web:${WEB_FRAGMENT_TAG:-${FORGE_TAG:?}}@${WEB_FRAGMENT_DIGEST:?}
  - path: oci://${FORGE_REPOSITORY}/compose/messenger:${MESSENGER_FRAGMENT_TAG:-${FORGE_TAG:?}}@${MESSENGER_FRAGMENT_DIGEST:?}
```

```dotenv
# ./.env.production

COMPOSE_FILE=./conf/compose.prod.yaml
FORGE_APP_IMAGE=ghcr.io/acme/acme-shop:<tag>@sha256:<digest>
APP_HOST_IP=0.0.0.0
SERVER_NAME=acme-shop.example.com
```

A deploy sets `FORGE_APP_IMAGE` to the release it ships ([Deploy docs](../deploy/index.md)).

| Path | Holds |
| --- | --- |
| `/app/var/` | `FORGE_VAR_DIR`, the volume `forge-var` both services share, e.g. logs and file sessions |
| `/app/var/cache/` | `FORGE_CACHE_DIR`, a tmpfs every container starts empty |
| `/data`, `/config` | Caddy's certificates, in the volumes `forge-caddy-data` and `forge-caddy-config` |

## Customizing

A framework writing elsewhere moves both directories, e.g. Laravel:

```dotenv
# ./.env.production

FORGE_VAR_DIR=/app/storage
FORGE_CACHE_DIR=/app/storage/framework/cache
```

Another directory has to exist in your image, owned by `www-data`, or by `RUNTIME_USER_UID` and `RUNTIME_USER_GID`
where your image runs PHP as someone else.

A volume copies your image's `var/` only once, when it is created, so `var/` has to ship empty and the build and every
deploy fail on a file there. Point a library's cache into `var/cache/`, and rotate your logs, e.g. with Monolog's
`rotating_file`. Docker rotates the container output itself.

Public uploads reach `var/` through a link in your image:

```dockerfile
# ./conf/docker/acme-shop.Dockerfile

RUN ln -s ../var/uploads ./public/uploads
```
