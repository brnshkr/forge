# 📡 Mercure [🔍](../../compose/mercure.yaml 'Go to source')

`forge/compose/mercure` runs a Mercure hub of its own, so every copy of your application publishes to the same one.
Its history lives in the volume `forge-mercure-data`.

## Usage

Your application forwards `/.well-known/mercure` to the hub, so browsers subscribe at your own domain:

```yaml
# ./conf/compose.prod.yaml

include:
  - path: oci://${FORGE_REPOSITORY}/compose/mercure:${MERCURE_FRAGMENT_TAG:-${FORGE_TAG:?}}@${MERCURE_FRAGMENT_DIGEST:?}
```

```dotenv
# ./.env.production

FORGE_MERCURE=forward
MERCURE_TAG=<tag>
MERCURE_IMAGE_DIGEST=sha256:<digest> # <version>
MERCURE_TRUSTED_ISSUERS=acme-shop.example.com
```

On a server, the keys live in a file only the hub reads ([Secrets docs](../deploy/secrets.md)):

```dotenv
# /srv/acme-shop/shared/.env.mercure.local

MERCURE_PUBLISHER_JWT_KEY=<key>
MERCURE_SUBSCRIBER_JWT_KEY=<key>
```

Your application publishes to `http://mercure/.well-known/mercure`, signing with the same publisher key.

While you develop, `FORGE_MERCURE=1` runs the hub inside `web-dev` instead
([Web server docs](../images/web-server.md#customizing)).

## Customizing

```dotenv
# ./.env.production

MERCURE_EXTRA_DIRECTIVES=anonymous subscriptions
```

`anonymous` lets a browser without a token receive public updates; `subscriptions` publishes an update whenever
someone subscribes or leaves, e.g. to show who is online.
