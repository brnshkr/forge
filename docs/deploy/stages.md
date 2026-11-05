# 🚦 Stages [🔍](../../src/shared/release/deploys.ts 'Go to source')

Every `.env.<target>` file that sets `DEPLOY_HOSTS` is a target you deploy to.

## Usage

Name a target in full words, in lowercase letters, digits, `_`, and `-`.
It then never collides with Symfony's `dev`, `test`, or `prod`.

| Target | Deploys | From CI |
| --- | --- | --- |
| `testing` | the image of a `dev/*` push, as `dev-<short sha>` | on every push to `dev/*`, each replacing the last |
| `staging` | the release | before the release publishes anything |
| `production` | the release | after the release, once someone approves it |
| any other | the release | like `staging` |

A broken release fails on `staging` and publishes nothing.
`production` builds the image. Every other target deploys that image:

```ini
# ./.env.staging

COMPOSE_FILE=./conf/compose.prod.yaml
DEPLOY_HOSTS=deploy@203.0.113.20
DEPLOY_IMAGE=production
DEPLOY_PATH=/srv/acme-shop-staging
SERVER_NAME=staging.acme-shop.example.com
```

A deploy reads `.env`, `.env.<target>`, and `.env.<target>.local`. It never reads `.env.local`.
Settings only your machine deploys with go in `.env.<target>.local`:

```ini
# ./.env.staging.local

DEPLOY_USER=acme
```

## Adding a target

A new target, e.g. `qa`, takes four steps:

1. `./.env.qa` with `DEPLOY_HOSTS`, `DEPLOY_PATH`, `DEPLOY_IMAGE=production`, and its `SERVER_NAME`.
2. A GitHub environment `qa` with `DEPLOY_SSH_KEY`, see [deploying](../github/deploying.md).
3. The server's own values in `shared/.env.local` or the environment's `DEPLOY_DOTENV`, see [secrets](./secrets.md).
4. A DNS record pointing `SERVER_NAME` at its hosts.

The next release then deploys `qa` beside `staging`, before it publishes anything.
