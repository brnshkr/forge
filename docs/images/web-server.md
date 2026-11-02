# 🌐 Web server [🔍](../../docker/frankenphp/Caddyfile 'Go to source')

`forge-app` and `forge-php-app` serve `SERVER_ROOT` (`./public` by default) with FrankenPHP,
on plain HTTP until you set `SERVER_NAME`.
Its Caddyfile is FrankenPHP's own with a few additions, so all of FrankenPHP's variables keep working.

## Usage

```dotenv
# ./.env

SERVER_NAME=acme-shop.internal
```

On top of FrankenPHP's Caddyfile, it:

- removes the `Server` header and sends a strict `Content-Security-Policy`, a deny-all `Permissions-Policy`,
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: strict-origin`
- routes every `*.php` request to the `index.php` in `SERVER_ROOT`
- redirects plain HTTP with `308` where `FORGE_HTTP_REDIRECT=1`, which `web-dev` and `web` set
- leaves Mercure's `authorization` parameter out of the access log
- answers a request with `503` once it waited `FORGE_MAX_WAIT_TIME` for a free PHP thread,
  and stops reading an upload after `FORGE_READ_BODY_TIMEOUT`

Serving it locally over HTTPS is shown in the [Development docs](../compose/development.md).

## Customizing

| Variable | Effect |
| --- | --- |
| `FORGE_CONTENT_SECURITY_POLICY` | replaces the default `Content-Security-Policy` |
| `FORGE_PERMISSIONS_POLICY` | replaces the default `Permissions-Policy` |
| `FORGE_WORKER=1` | runs `index.php` from `SERVER_ROOT` as a worker |
| `FORGE_WORKER_CONFIG` | replaces the worker's directives, `watch` in `-dev`; empty turns the reload off |
| `FORGE_MERCURE=1` | enables the Mercure hub, which needs `MERCURE_PUBLISHER_JWT_KEY` and `MERCURE_TRUSTED_ISSUERS` |
| `FORGE_MERCURE=forward` | forwards `/.well-known/mercure` to `FORGE_MERCURE_UPSTREAM`, `mercure:80` by default |
| `FORGE_HOT_RELOAD=1` | reloads the browser on file changes in `-dev`, which needs `FORGE_MERCURE=1` |
| `MERCURE_EXTRA_DIRECTIVES` | adds hub directives, e.g. `subscriptions` |
| `FORGE_MAX_WAIT_TIME`, `FORGE_READ_BODY_TIMEOUT` | how long a request may wait for a PHP thread, and an upload may take |
| `CADDY_SERVER_EXTRA_DIRECTIVES` | adds directives to the site |

A worker keeps your application booted between requests; turn it on once for every stage:

```dotenv
# ./.env

FORGE_WORKER=1
```

An `index.php` that never calls `frankenphp_handle_request()` fails to start as a worker.

Hot reload publishes on the Mercure topic `forge/hot-reload` and lets browsers subscribe without a token.
Your layout points the client at it and loads [`frankenphp-hot-reload`](https://frankenphp.dev/docs/hot-reload/)
(and optionally `idiomorph`) from your own assets, so the `Content-Security-Policy` stays `'self'`:

```twig
{# ./templates/base.html.twig #}

{% if app.getRequest.server.has('FRANKENPHP_HOT_RELOAD') %}
  <meta name="frankenphp-hot-reload:url" content="{{ app.getRequest.server.getString('FRANKENPHP_HOT_RELOAD') }}">
{% endif %}
```

A deploy refuses `FORGE_HOT_RELOAD=1` and a `watch` in `FORGE_WORKER_CONFIG`, since nothing changes in a release.

## Several domains

An application answering more than one name lists them all:

```dotenv
# ./.env

SERVER_NAME="acme-shop.internal, acme.internal"
```

The Caddyfile imports every `*.caddyfile` in `/etc/frankenphp/Caddyfile.d/`, so a site of its own can live anywhere
in your repository, with `import forge-headers` for the same headers:

```text
# ./conf/caddy/admin.caddyfile

admin.acme-shop.internal {
  import forge-headers
  reverse_proxy acme-admin:8080
}
```

Copy it there in your own Dockerfile, or mount it in development:

```dockerfile
# ./conf/docker/acme-shop.Dockerfile

COPY ./conf/caddy/admin.caddyfile /etc/frankenphp/Caddyfile.d/admin.caddyfile
```

```yaml
# ./conf/compose.yaml

services:
  web:
    volumes:
      - ${HOST_APP_DIR:-${PWD}}/conf/caddy/admin.caddyfile:/etc/frankenphp/Caddyfile.d/admin.caddyfile:ro
```

A public name needs port 80 or 443 reachable from the internet for its certificate.
A public wildcard certificate needs a DNS provider in the image, which it doesn't have.
