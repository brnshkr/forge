# 🔀 Zero downtime [🔍](../../compose/proxy.yaml 'Go to source')

Include the `proxy` fragment and every deploy switches without dropping a request.

## Usage

```yaml
# ./conf/compose.prod.yaml

include:
  - path: oci://${FORGE_FRAGMENT_NAMESPACE:-${FORGE_NAMESPACE:?}}/forge-compose-php-app:${FORGE_TAG:?}@${FORGE_PHP_APP_FRAGMENT_DIGEST:?}
  - path: oci://${FORGE_FRAGMENT_NAMESPACE:-${FORGE_NAMESPACE:?}}/forge-compose-proxy:${FORGE_TAG:?}@${FORGE_PROXY_FRAGMENT_DIGEST:?}
```

```ini
# ./.env.production

PROXY_TAG=<tag>
PROXY_IMAGE_DIGEST=sha256:<digest> # <version>
FORGE_PROXY_FRAGMENT_DIGEST=sha256:<digest> # <version>
```

The proxy owns ports 80 and 443 and every project's certificates on the server, in the shared project `forge-shared`.
It routes `SERVER_NAME` to your application at `<COMPOSE_PROJECT_NAME>-app` and passes its headers through.
It drops `Server`, `Via`, and `X-Powered-By`, and adds the [web server's](../images/web-server.md) security headers
your application does not send, except `Content-Security-Policy` and `Permissions-Policy`.

Your application then publishes no port and serves plain HTTP.
A deploy starts the new release beside the old one, moves traffic once the new one is healthy, then stops the old one.

Without the proxy, `php-app` or `bun-app` keeps its own ports and certificates.
It is down for the seconds a restart takes.
The first deploy with the proxy stops the old application to free its ports. That one deploy takes seconds of downtime.

## Your application

Symfony trusts the proxy's client address and protocol through `SYMFONY_TRUSTED_PROXIES=REMOTE_ADDR`.
The deploy sets it. During a switch, two releases run at once, so follow three rules:

- A migration keeps the previous release working. Add a column first and remove the old one a release later.
- A Messenger message stays readable by the previous release.
- Sessions and locks live in Valkey, Postgres, or `flock:///app/var/lock`, never in a container's own `/tmp`.

Give each release its own cache namespace:

```yaml
# ./config/packages/cache.yaml

framework:
  cache:
    prefix_seed: '%env(FORGE_RELEASE)%'
```

The [`symfony` recipe](./hooks.md) warms each new container's cache before it serves.
A container Docker restarts by itself starts cold.

## Customizing

| Variable | Changes |
| --- | --- |
| `PROXY_HTTP_PORT` | which port on the host serves HTTP |
| `PROXY_HTTPS_PORT` | which port on the host serves HTTPS, for TCP and UDP |
| `PROXY_HOST_IP` | where the ports listen |
| `FORGE_PROXY_SITES_DIR` | where each project's site lives on the host |
| `PROXY_CONTAINER_MEMORY_LIMIT` | how much memory the service may use |
| `PROXY_CONTAINER_PIDS_LIMIT` | how many processes the service may start |

The defaults are in [`proxy.yaml`](../../compose/proxy.yaml).

## Internal names

A name under `.internal`, e.g. for a staging server only your network reaches,
gets its certificate from the proxy's own authority. Each device trusts its root once:

```sh
ssh deploy@203.0.113.20 'docker cp forge-shared-proxy:/data/caddy/pki/authorities/local/root.crt -' \
  | tar -xO >./forge-shared-root.crt
```

GitHub's runners cannot reach such a server. Deploy it from a machine inside your network.
