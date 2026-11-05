# 🌐 Web server [🔍](../../docker/frankenphp/Caddyfile 'Go to source')

The `-app` and `-app-dev` images of `forge` and `forge-php` serve your app with FrankenPHP.

## Usage

Name the domain your app answers on:

```ini
# ./.env

SERVER_NAME=acme-shop.internal
```

The server serves `SERVER_ROOT`, `./public` by default, and hands every `*.php` request to its `index.php`.
Without `SERVER_NAME` it answers plain HTTP on port 80.
The `php-app` fragments set `FORGE_HTTP_REDIRECT=1`. It redirects plain HTTP with 308.

The Caddyfile is FrankenPHP's own with additions, so FrankenPHP's variables keep working.
It drops the `Server`, `Via`, and `X-Powered-By` headers. It sends `Content-Security-Policy`, `Permissions-Policy`,
`Strict-Transport-Security`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `X-Frame-Options`,
`X-Content-Type-Options`, and `Referrer-Policy`. Their values are in the [Caddyfile](../../docker/frankenphp/Caddyfile).

Mercure's `authorization` query parameter stays out of the access log.

## Customizing

Each header variable replaces the default value:

| Variable | Example |
| --- | --- |
| `FORGE_CONTENT_SECURITY_POLICY` | your own policy |
| `FORGE_PERMISSIONS_POLICY` | `camera=(self)` |
| `FORGE_STRICT_TRANSPORT_SECURITY` | `max-age=31536000; includeSubDomains; preload` |
| `FORGE_CROSS_ORIGIN_OPENER_POLICY` | `same-origin-allow-popups`, for an OAuth popup |
| `FORGE_CROSS_ORIGIN_RESOURCE_POLICY` | `cross-origin`, for assets other sites embed |

The switches:

| Variable | Changes |
| --- | --- |
| `SERVER_NAME` | which domains are served |
| `SERVER_ROOT` | which directory is served |
| `FORGE_HTTP_REDIRECT` | `1` redirects plain HTTP to HTTPS |
| `FORGE_MAX_WAIT_TIME` | how long a request waits for a free PHP thread before it gets 503 |
| `FORGE_READ_BODY_TIMEOUT` | how long the server reads an upload |
| `FORGE_WORKER` | `1` runs `index.php` as a FrankenPHP worker |
| `FORGE_WORKER_CONFIG` | the worker's directives, empty turns reload off |
| `FORGE_MERCURE` | `1` runs a Mercure hub inside, `forward` forwards `/.well-known/mercure` |
| `FORGE_MERCURE_UPSTREAM` | where `forward` sends Mercure |
| `FORGE_HOT_RELOAD` | `1` refreshes the browser on file changes |

The defaults are in [`Caddyfile`](../../docker/frankenphp/Caddyfile).

Hot reload needs `FORGE_MERCURE=1`. Your layout must also load FrankenPHP's hot reload client.
The hub inside reads `MERCURE_TRUSTED_ISSUERS`, `MERCURE_PUBLISHER_JWT_KEY`, `MERCURE_PUBLISHER_JWT_ALG`,
`MERCURE_SUBSCRIBER_JWT_KEY`, `MERCURE_SUBSCRIBER_JWT_ALG`, and `MERCURE_EXTRA_DIRECTIVES`.
Take a look at [Mercure](../compose/mercure.md) for a hub of its own.

For anything else, add Caddyfile lines through these variables:

| Variable | Goes into |
| --- | --- |
| `CADDY_GLOBAL_OPTIONS` | the global options |
| `FRANKENPHP_CONFIG` | the `frankenphp` block |
| `CADDY_EXTRA_CONFIG` | the top level, before the site |
| `CADDY_SERVER_EXTRA_DIRECTIVES` | the site block |

Every `*.caddyfile` in `/etc/frankenphp/Caddyfile.d/` is imported too.
