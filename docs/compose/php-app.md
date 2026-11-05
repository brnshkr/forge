# 🐘 PHP app [🔍](../../compose/php-app.yaml 'Go to source')

`php-app-dev` serves your working copy with FrankenPHP. `php-app` serves your own image on a server.

## Usage

```yaml
# ./conf/compose.yaml

include:
  - path: oci://${FORGE_FRAGMENT_NAMESPACE:-${FORGE_NAMESPACE:?}}/forge-compose-php-app-dev:${FORGE_TAG:?}@${FORGE_PHP_APP_DEV_FRAGMENT_DIGEST:?}
```

```ini
# ./.env

SERVER_NAME=acme-shop.internal
APP_HTTP_PORT=80
APP_HTTPS_PORT=443

FORGE_TAG=<tag>
FORGE_APP_DEV_IMAGE_DIGEST=sha256:<digest> # <version>
FORGE_PHP_APP_DEV_FRAGMENT_DIGEST=sha256:<digest> # <version>
```

Both run the service `php-app`. Port 443 is also published on UDP, for HTTP/3.
Take a look at the [web server](../images/web-server.md) for what it serves and every switch it passes through.

## Development

`php-app-dev` mounts your working copy read-write at `/app` and runs as `HOST_UID` and `HOST_GID`.
Its home `/home/forge` lives in the volume `forge-home`. `host.docker.internal` reaches your machine, for step debugging.

These pass through from `.env.local` without a rebuild: `TZ`, `LANG`, `LC_ALL`, `XDEBUG_MODE`, `XDEBUG_CONFIG`,
`PHP_IDE_CONFIG`, and `COMPOSER_AUTH`. The images carry only the `C.utf8` locale.

### Local HTTPS

A name under `.internal` gets its certificate from the project's own authority in `./.cache/xdg.cache`.
Trust it once with [🛠️ `make trust`](https://github.com/brnshkr/config/blob/master/docs/Makefile.md),
or import `./.cache/xdg.cache/caddy/pki/authorities/local/root.crt` yourself. Then point the name at your machine:

```text
# /etc/hosts

127.0.0.1 acme-shop.internal
```

A public name gets a public certificate.

### Other devices

Publish the ports on every interface:

```ini
# ./.env.local

APP_HOST_IP=0.0.0.0
MAILPIT_HOST_IP=0.0.0.0
```

Each device must resolve the name to your machine and trust `root.crt`.
WSL 2 needs `networkingMode=mirrored` on Windows 11, or a `netsh interface portproxy` rule on Windows 10.

To run several projects at once, give each its own loopback address, e.g. `APP_HOST_IP=127.0.0.2`.

## Production

`php-app` runs your own image read-only, with nothing mounted, as `www-data`.
It reads `shared/.env.local`, `shared/.env.<DEPLOY_APP_ENV>.local`, and `shared/.env.deploy.local` on the server.
Its ports bind to loopback. Behind the [proxy](../deploy/zero-downtime.md), a deploy publishes none.

| Path | Holds |
| --- | --- |
| `FORGE_VAR_DIR`, `/app/var` | the volume `forge-var`, shared by every production fragment |
| `FORGE_CACHE_DIR`, `/app/var/cache` | an in-memory directory, empty on every start |
| `/data`, `/config` | Caddy's state, in the volumes `forge-caddy-data` and `forge-caddy-config` |

Laravel keeps them elsewhere:

```ini
# ./.env.production

FORGE_VAR_DIR=/app/storage
FORGE_CACHE_DIR=/app/storage/framework/cache
```

Another directory must exist in the image, owned by the runtime user.
`var/` must ship empty. Rotate your logs, e.g. with Monolog's `rotating_file`.
For public uploads, link them in your own Dockerfile: `RUN ln -s ../var/uploads ./public/uploads`.

## Customizing

| Variable | Falls back to | Changes |
| --- | --- | --- |
| `PHP_APP_COMMAND` | — | what the service runs |
| `PHP_APP_HTTP_PORT` | `APP_HTTP_PORT` | which port on your machine serves HTTP |
| `PHP_APP_HTTPS_PORT` | `APP_HTTPS_PORT` | which port on your machine serves HTTPS, for TCP and UDP |
| `APP_HOST_IP` | — | where the ports listen |
| `PHP_APP_CONTAINER_MEMORY_LIMIT` | — | how much memory the service may use |
| `PHP_APP_DEV_CONTAINER_MEMORY_LIMIT` | `PHP_APP_CONTAINER_MEMORY_LIMIT` | how much memory `php-app-dev` may use |
| `PHP_APP_CONTAINER_PIDS_LIMIT` | — | how many processes the service may start |
| `PHP_APP_DEV_CONTAINER_PIDS_LIMIT` | `PHP_APP_CONTAINER_PIDS_LIMIT` | how many processes `php-app-dev` may start |
| `RUNTIME_USER_UID`, `RUNTIME_USER_GID` | — | who the app runs as |
| `HOST_APP_DIR` | the current directory | what is mounted at `/app` |
| `HOST_UID`, `HOST_GID` | — | who writes the mounted directory |

The defaults are in [`php-app.yaml`](../../compose/php-app.yaml)
and [`php-app-dev.yaml`](../../compose/php-app-dev.yaml).
