# 💻 Development [🔍](../../compose/web-dev.yaml 'Go to source')

`forge/compose/web-dev` serves your web project from your working copy on `forge-app:<tag>-dev`,
over HTTPS at the names in `SERVER_NAME`. A library includes [`forge/compose/cli`](./cli.md) instead.
For PHP-only development, set `FORGE_APP_IMAGE_NAME=forge-php-app`; Bun projects use
[`web-bun-dev`](./bun-app.md#development).

## Usage

```yaml
# ./conf/compose.yaml

include:
  - path: oci://${FORGE_REPOSITORY}/compose/web-dev:${WEB_DEV_FRAGMENT_TAG:-${FORGE_TAG:?}}@${WEB_DEV_FRAGMENT_DIGEST:?}
```

```dotenv
# ./.env

FORGE_TAG=<tag>
FORGE_APP_IMAGE_SUFFIX=-dev
FORGE_APP_IMAGE_DIGEST=sha256:<digest> # <version>
WEB_DEV_FRAGMENT_DIGEST=sha256:<digest> # <version>

APP_HTTP_PORT=80
APP_HTTPS_PORT=443
SERVER_NAME=acme-shop.internal
```

```sh
docker compose --file ./conf/compose.yaml up --detach
```

Its service is `app`, mounted read-write at `/app`, with your home `/home/forge` in the volume `forge-home`,
so Git settings and shell history survive new containers. `host.docker.internal` reaches your machine for step
debugging. [Production](./production.md) runs your own image built from the same release, and the
[Web server docs](../images/web-server.md) cover what FrankenPHP serves and how to change it.

## Customizing

These pass through from `.env.local` without a new image:

| Variable | Changes |
| --- | --- |
| `TZ` | the timezone of the system and its tools; PHP keeps UTC |
| `LANG`, `LC_ALL` | the locale; the images only have `C.utf8` |
| `XDEBUG_MODE`, `XDEBUG_CONFIG` | Xdebug's mode and its settings |
| `PHP_IDE_CONFIG` | the server name your IDE maps paths by |
| `COMPOSER_AUTH` | Composer's credentials for private repositories |

Hot reload refreshes the browser when a file changes, once your layout loads its client
([Web server docs](../images/web-server.md#customizing)):

```dotenv
# ./.env.local

FORGE_MERCURE=1
FORGE_HOT_RELOAD=1
MERCURE_PUBLISHER_JWT_KEY=<key>
MERCURE_TRUSTED_ISSUERS=acme-shop.internal
```

## HTTPS on your machine

A name under `.internal` gets its certificate from a certificate authority of the project's own, kept in
`./.cache/xdg.cache`, so it survives new containers. Trust it once per project, while the service runs:

```sh
make trust
```

That target comes with [`@brnshkr/config`'s Makefile](https://github.com/brnshkr/config/blob/master/docs/Makefile.md);
without it, import `./.cache/xdg.cache/caddy/pki/authorities/local/root.crt` into your system's trust store.
One authority signs every `.internal` name in `SERVER_NAME`. A public name gets a public certificate instead.

Point each name to your machine:

```text
# /etc/hosts

127.0.0.1 acme-shop.internal
```

## Other devices and projects

The app and Mailpit's web interface listen on `127.0.0.1` only. Open them to your network:

```dotenv
# ./.env.local

APP_HOST_IP=0.0.0.0
MAILPIT_HOST_IP=0.0.0.0
```

Each device then resolves the name through your network's DNS and trusts the authority's `root.crt` once.
A project inside WSL 2 reaches other devices through `networkingMode=mirrored` on Windows 11, or a
`netsh interface portproxy` rule on Windows 10.

Several web projects run at once on loopback addresses of their own, e.g. `APP_HOST_IP=127.0.0.2`,
each name pointing there in your hosts file.
