# 🔀 Zero downtime [🔍](../../compose/proxy.yaml 'Go to source')

Include `forge/compose/proxy` and every deploy switches without dropping a request.
Without it, `web` keeps its own ports and certificates and is down for the seconds it takes to restart.

## Usage

```yaml
# ./conf/compose.prod.yaml

include:
  - path: oci://${FORGE_REPOSITORY}/compose/web:${WEB_FRAGMENT_TAG:-${FORGE_TAG:?}}@${WEB_FRAGMENT_DIGEST:?}
  - path: oci://${FORGE_REPOSITORY}/compose/proxy:${PROXY_FRAGMENT_TAG:-${FORGE_TAG:?}}@${PROXY_FRAGMENT_DIGEST:?}
```

The proxy owns ports 80 and 443 and the certificates of every project on the server, in `forge-shared`
([Shared services](./shared.md)). It passes your application's own headers through and only drops `Server`.
Your application then publishes no port and serves plain HTTP: a deploy starts the new release beside the old one,
moves traffic over once it is healthy, and only then stops the old one.

The first deploy that turns to the proxy stops the previous release's application, which holds the ports,
so that one deploy takes seconds of downtime. If it fails, the proxy stops again and the old application comes back.

## Your application

The proxy forwards the client's address and protocol, which Symfony trusts through `SYMFONY_TRUSTED_PROXIES`,
set to `REMOTE_ADDR` since only the proxy reaches your application. Follow three rules:

- a migration keeps the previous release working: add a column first, remove the old one a release later
- a Messenger message stays readable by the previous release
- sessions and locks live in Valkey, Postgres, or `flock:///app/var/lock`, never in the per-container `/tmp`
  Symfony's `flock` uses

Give each release its own cache namespace, so the two releases never read each other's cache during the switch:

```yaml
# ./config/packages/cache.yaml

framework:
  cache:
    prefix_seed: '%env(FORGE_RELEASE)%'
```

Each new container warms its cache before it counts as started, through the [`symfony` recipe](./hooks.md).
A container Docker restarts by itself starts cold.

## Customizing

A name under `.internal`, e.g. for a staging only your network reaches, gets a certificate from the proxy's own
certificate authority. Each device trusts its root once:

```sh
ssh deploy@203.0.113.20 'docker cp forge-shared-proxy:/data/caddy/pki/authorities/local/root.crt -' \
  | tar -xO >./forge-shared-root.crt
```

A server only your network reaches is deployed from a machine inside it, since GitHub's runners cannot reach it.
