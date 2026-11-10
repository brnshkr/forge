# 🐘 Your PHP app

Take a Symfony app with Messenger and Postgres from your machine to its server.

```mermaid
%%{init: {
  'themeCSS': 'h3 {margin: 0} table {border-collapse: collapse; margin: 0.4em 0 0} td {border-top: 1px solid #666; padding: 0.3em 0.6em; text-align: right; vertical-align: top} td:first-child {white-space: nowrap; color: #888} td:last-child {text-align: left}'
}}%%
flowchart LR
  setup("<h3>Set up</h3><table><tr><td>Files</td><td>./conf/compose.yaml<br>./.env<br>./Makefile</td></tr></table>")
  develop("<h3>Develop</h3><table><tr><td>Files</td><td>./.env.local<br>/etc/hosts</td></tr></table>")
  check("<h3>Check in CI</h3><table><tr><td>Files</td><td>./.github/workflows/ci.yaml<br>./.github/workflows/maintenance.yaml</td></tr></table>")
  image("<h3>Build the image</h3><table><tr><td>Files</td><td>./.env.production<br>./Makefile</td></tr></table>")
  deploy("<h3>Deploy</h3><table><tr><td>Files</td><td>./conf/compose.prod.yaml<br>./.env.production</td></tr></table>")

  setup --> develop --> check --> image --> deploy
```

## Set up

Include the app, its worker, and Postgres:

```yaml
# ./conf/compose.yaml

include:
  - path: oci://${FORGE_FRAGMENT_NAMESPACE:-${FORGE_NAMESPACE:?}}/forge-compose-php-app-dev:${FORGE_TAG:?}@${FORGE_PHP_APP_DEV_FRAGMENT_DIGEST:?}
  - path: oci://${FORGE_FRAGMENT_NAMESPACE:-${FORGE_NAMESPACE:?}}/forge-compose-php-worker-dev:${FORGE_TAG:?}@${FORGE_PHP_WORKER_DEV_FRAGMENT_DIGEST:?}
  - path: oci://${FORGE_FRAGMENT_NAMESPACE:-${FORGE_NAMESPACE:?}}/forge-compose-postgres:${FORGE_TAG:?}@${FORGE_POSTGRES_FRAGMENT_DIGEST:?}
```

Add the settings and the pins to the `.env` Symfony already has:

```ini
# ./.env

COMPOSE_PROJECT_NAME=acme-shop
SERVER_NAME=acme-shop.internal
APP_HTTP_PORT=80
APP_HTTPS_PORT=443
MESSENGER_TRANSPORTS=async scheduler_default

POSTGRES_DB=acme_shop
POSTGRES_USER=acme
POSTGRES_PASSWORD=acme
DATABASE_URL=postgresql://acme:acme@postgres:5432/acme_shop

FORGE_TAG=<tag>
FORGE_APP_DEV_IMAGE_DIGEST=sha256:<digest> # <version>
POSTGRES_TAG=<tag>
POSTGRES_IMAGE_DIGEST=sha256:<digest> # <version>
FORGE_PHP_APP_DEV_FRAGMENT_DIGEST=sha256:<digest> # <version>
FORGE_PHP_WORKER_DEV_FRAGMENT_DIGEST=sha256:<digest> # <version>
FORGE_POSTGRES_FRAGMENT_DIGEST=sha256:<digest> # <version>
```

The app reaches the database at the host `postgres`. Read each Forge digest once:

```sh
docker buildx imagetools inspect docker.io/brnshkr/forge:<tag>-app-dev
docker buildx imagetools inspect docker.io/brnshkr/forge-compose-php-app-dev:<tag>
```

Do the same for `php-worker-dev`, `postgres`, and the `postgres` image.
From then on the maintenance workflow bumps them with a pull request.
The `forge` image holds PHP, Composer, and Bun. Add `FORGE_IMAGE_NAME=forge-php` for an app without Bun.

Install [@brnshkr/config](https://github.com/brnshkr/config) once inside the container,
then copy the starter Makefile and let it write the rest:

```sh
export FORGE_NAMESPACE=docker.io/brnshkr HOST_UID=$(id -u) HOST_GID=$(id -g)

docker compose --env-file ./.env --file ./conf/compose.yaml run --rm php-app composer r --dev brnshkr/config
cp -v ./vendor/brnshkr/config/conf/Makefile.dist ./Makefile \
  && make startup
```

From now on the Makefile sets the variables above and runs every tool in `php-app`.

## Develop

```sh
make up
make trust
```

`make up` starts the app, the worker, and Postgres. `make trust` makes your browsers trust the project's own
certificate authority, once. Point the name at your machine:

```text
# /etc/hosts

127.0.0.1 acme-shop.internal
```

Then `https://acme-shop.internal` serves your working copy, mounted at `/app`.
`make ci` checks it, `make shell` opens a shell in `php-app`, and `make help` lists the rest.

Personal switches go in `./.env.local`. Git ignores it. This one turns on step debugging and hot reload:

```ini
# ./.env.local

XDEBUG_MODE=debug
FORGE_MERCURE=1
FORGE_HOT_RELOAD=1
MERCURE_PUBLISHER_JWT_KEY=<secret>
MERCURE_TRUSTED_ISSUERS=acme-shop.internal
```

Run `make up` again to apply it.
The [web server](../images/web-server.md) lists every switch.
For other devices and several projects at once, see [`php-app`](../compose/php-app.md).

### Without the shared Makefile

```sh
docker compose --env-file ./.env --env-file ./.env.local --file ./conf/compose.yaml up --wait
```

Import `./.cache/xdg.cache/caddy/pki/authorities/local/root.crt` into your browser or system trust store.

## Check in CI

Call Forge's workflows from two files:

```yaml
# ./.github/workflows/ci.yaml

name: CI

on:
  push:
    branches:
      - dev/*
      - release/*

  pull_request:
    branches:
      - dev/*
      - release/*

permissions:
  contents: read

jobs:
  ci:
    name: CI
    permissions:
      contents: write
      id-token: write
      packages: write
      pages: write
      security-events: write
    uses: brnshkr/forge/.github/workflows/ci.yaml@<commit> # <tag>
    secrets:
      BOT_CLIENT_ID: ${{ secrets.BOT_CLIENT_ID }}
      BOT_PRIVATE_KEY: ${{ secrets.BOT_PRIVATE_KEY }}
```

```yaml
# ./.github/workflows/maintenance.yaml

name: Maintenance

on:
  schedule:
    - cron: 20 16 * * 2,5

  repository_dispatch:
    types:
      - brnshkr-release

permissions:
  contents: read

jobs:
  maintenance:
    name: Maintenance
    permissions:
      contents: read
      security-events: write
    uses: brnshkr/forge/.github/workflows/maintenance.yaml@<commit> # <tag>
    secrets:
      BOT_CLIENT_ID: ${{ secrets.BOT_CLIENT_ID }}
      BOT_PRIVATE_KEY: ${{ secrets.BOT_PRIVATE_KEY }}
```

The [GitHub setup](../github/setup.md) covers the bot and the secrets.
CI runs `make ci` in the same container you develop in.

## Build the image

Name the image in a stage file:

```ini
# ./.env.production

IMAGE_NAME=acme-shop
IMAGE_TARGET=prod
FORGE_APP_IMAGE_DIGEST=sha256:<digest> # <version>
```

Read the digest once with `docker buildx imagetools inspect docker.io/brnshkr/forge:<tag>-app`.
Forge's Dockerfile builds the image on `forge:<tag>-app-dev` and runs it on `forge:<tag>-app`
as `www-data`, read-only.

The image ships what your package archive ships. List the paths the app needs at runtime,
then let the Makefile write them to `.gitattributes`:

```makefile
# ./Makefile

ARCHIVE_EXTRA_PATHS = bin/console config/ public/ templates/ migrations/ .env
```

```sh
make configs
```

Every push builds and scans the image. Every release publishes it.
Extensions, packages, and a Dockerfile of your own are in [your image](../images/your-image.md).

## Deploy

Run the app's own image behind the proxy, with its worker and Postgres:

```yaml
# ./conf/compose.prod.yaml

include:
  - path: oci://${FORGE_FRAGMENT_NAMESPACE:-${FORGE_NAMESPACE:?}}/forge-compose-php-app:${FORGE_TAG:?}@${FORGE_PHP_APP_FRAGMENT_DIGEST:?}
  - path: oci://${FORGE_FRAGMENT_NAMESPACE:-${FORGE_NAMESPACE:?}}/forge-compose-php-worker:${FORGE_TAG:?}@${FORGE_PHP_WORKER_FRAGMENT_DIGEST:?}
  - path: oci://${FORGE_FRAGMENT_NAMESPACE:-${FORGE_NAMESPACE:?}}/forge-compose-proxy:${FORGE_TAG:?}@${FORGE_PROXY_FRAGMENT_DIGEST:?}
  - path: oci://${FORGE_FRAGMENT_NAMESPACE:-${FORGE_NAMESPACE:?}}/forge-compose-postgres:${FORGE_TAG:?}@${FORGE_POSTGRES_FRAGMENT_DIGEST:?}
```

Name the server and the pins in the stage file:

```ini
# ./.env.production

IMAGE_NAME=acme-shop
IMAGE_TARGET=prod
FORGE_APP_IMAGE_DIGEST=sha256:<digest> # <version>

COMPOSE_FILE=./conf/compose.prod.yaml
DEPLOY_HOSTS=deploy@203.0.113.10
DEPLOY_PATH=/srv/acme-shop
SERVER_NAME=acme-shop.example.com

PROXY_TAG=<tag>
PROXY_IMAGE_DIGEST=sha256:<digest> # <version>
FORGE_PHP_APP_FRAGMENT_DIGEST=sha256:<digest> # <version>
FORGE_PHP_WORKER_FRAGMENT_DIGEST=sha256:<digest> # <version>
FORGE_PROXY_FRAGMENT_DIGEST=sha256:<digest> # <version>
```

The server needs Docker, Compose, and an SSH user in the `docker` group.
In GitHub, create the environment `production` with required reviewers. Give it these secrets:

| Secret | Value |
| --- | --- |
| `DEPLOY_SSH_KEY` | the private key of `deploy@203.0.113.10` |
| `DEPLOY_DOTENV` | the values only the server knows, e.g. `POSTGRES_PASSWORD` and the `DATABASE_URL` using it |

Add the server's host key to the repository variable `DEPLOY_KNOWN_HOSTS`.
Every release now deploys to `production` after approval. The deploy sets `FORGE_APP_IMAGE` to the release.
The proxy moves traffic to the new release once it answers, then the new worker starts.
Take a look at the [deploy docs](../deploy/index.md) and at [deploying](../github/deploying.md).

## Add services

Include a service in `./conf/compose.yaml` to develop with it and in `./conf/compose.prod.yaml` to deploy it:

| Service | Fragment | Shared per server | Reference |
| --- | --- | --- | --- |
| Postgres | `postgres` | yes | [Postgres](../compose/postgres.md) |
| Valkey | `valkey` | yes, with `VALKEY_PASSWORD` | [Valkey](../compose/valkey.md) |
| Mercure | `mercure` | no | [Mercure](../compose/mercure.md) |
| Mailpit | `mailpit` | yes, never in production | [Mailpit](../compose/mailpit.md) |

`DEPLOY_SHARED_SERVICES=postgres` in `./.env.production` runs Postgres once per server for every project there.
Each project keeps its own role and database.
[Shared services](../deploy/shared.md) explains how they move and what they need.
