# 🚦 Stages [🔍](../../src/shared/release/deploys.ts 'Go to source')

Every `.env.<name>` file that sets `DEPLOY_HOSTS` is a system you deploy to. Name it in full words, so it never
meets Symfony's `dev`, `test`, or `prod`. Production builds the image; every other system deploys that image.

## Usage

| Stage | Deploys | From CI |
| --- | --- | --- |
| `testing` | the image of a `dev/*` push, as `dev-<short sha>` | on every push to `dev/*`, each replacing the last |
| `staging` | the release | before the release publishes anything, so a broken one publishes nothing |
| `production` | the release | after the release, once someone approves it |
| any other | the release | like `staging` |

```dotenv
# ./.env.staging

COMPOSE_FILE=./conf/compose.prod.yaml
DEPLOY_HOSTS=deploy@203.0.113.20
DEPLOY_IMAGE=production
DEPLOY_PATH=/srv/acme-shop-staging
SERVER_NAME=staging.acme-shop.example.com
```

A deploy reads `.env`, the stage file, and `.env.<stage>.local`, never `.env.local`, so your machine's settings
stay on your machine. Settings only your machine deploys with go into `.env.<stage>.local`:

```dotenv
# ./.env.staging.local

DEPLOY_USER=acme
```

## Customizing

Adding a system, e.g. `qa`, takes four steps:

1. `./.env.qa` with `DEPLOY_HOSTS`, `DEPLOY_PATH`, `DEPLOY_IMAGE=production`, and its `SERVER_NAME`
2. a GitHub environment `qa` with `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS` ([GitHub docs](../github/deploying.md))
3. the server's own values in `shared/.env.local`, or in the environment's `DEPLOY_DOTENV` ([Secrets](./secrets.md))
4. a DNS record pointing `SERVER_NAME` at its hosts

The next release then deploys `qa` beside `staging`, before it publishes anything.
