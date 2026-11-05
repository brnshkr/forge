# 📡 Mercure [🔍](../../compose/mercure.yaml 'Go to source')

`mercure` runs a Mercure hub of its own, beside your app.

## Usage

```yaml
# ./conf/compose.prod.yaml

include:
  - path: oci://${FORGE_FRAGMENT_NAMESPACE:-${FORGE_NAMESPACE:?}}/forge-compose-mercure:${FORGE_TAG:?}@${FORGE_MERCURE_FRAGMENT_DIGEST:?}
```

```ini
# ./.env.production

FORGE_MERCURE=forward
MERCURE_TAG=<tag>
MERCURE_IMAGE_DIGEST=sha256:<digest> # <version>
FORGE_MERCURE_FRAGMENT_DIGEST=sha256:<digest> # <version>
```

The hub runs `forge-php`'s `-app` image of the Forge release in `MERCURE_TAG`, on plain HTTP inside the project.
With `FORGE_MERCURE=forward`, your app forwards `/.well-known/mercure` to it.
The hub needs `MERCURE_PUBLISHER_JWT_KEY` and `MERCURE_TRUSTED_ISSUERS`.
On a server, keep them in `shared/.env.mercure.local`. A deploy from CI writes that file from `DEPLOY_DOTENV_MERCURE`.

During development, `FORGE_MERCURE=1` runs the hub inside `php-app-dev` instead. No `mercure` service is needed.
Take a look at the [web server](../images/web-server.md) for every Mercure variable.

## Customizing

| Variable | Changes |
| --- | --- |
| `MERCURE_CONTAINER_MEMORY_LIMIT` | how much memory the service may use |
| `MERCURE_CONTAINER_PIDS_LIMIT` | how many processes the service may start |
| `FORGE_MERCURE_UPSTREAM` | where the app forwards `/.well-known/mercure` |

The defaults are in [`mercure.yaml`](../../compose/mercure.yaml).

The hub keeps its history in the volume `forge-mercure-data` and Caddy's settings in `forge-mercure-config`.
