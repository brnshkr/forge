# 🎣 Hooks [🔍](../../docker/deploy.sh 'Go to source')

Recipes run what your framework needs on each deploy, and your own scripts in `./conf/deploy/` run at fixed points
around them. Each runs in a fresh container of a release's image, as hardened as your application,
with `FORGE_ONE_OFF=1`.

## Usage

Recipes are detected from your `composer.lock`:

| Recipe | Detected by | Runs |
| --- | --- | --- |
| `symfony` | `symfony/framework-bundle` | `cache:warmup` in every new container before it serves |
| `doctrine` | `doctrine/doctrine-bundle` | `doctrine:database:create --if-not-exists`, then `doctrine:migrations:migrate` |

The `symfony` recipe needs `bin/console` in your image, and a deploy fails before uploading without it,
since your archive leaves it out unless `ARCHIVE_EXTRA_PATHS` lists it ([Your image](../images/your-image.md)).
`doctrine:migrations:migrate` only runs with `doctrine/doctrine-migrations-bundle` installed.

Your scripts run in this order, each where it exists:

| Script | Runs | In the image of |
| --- | --- | --- |
| `before-migrate.sh` | before the `doctrine` recipe creates databases and migrates | the new release |
| `after-migrate.sh` | after the migrations, before the new application starts | the new release |
| `before-switch.sh` | once the new application is healthy, before `current` moves; failing undoes the deploy | the new release |
| `after-switch.sh` | once every host switched and started the rest | the new release |
| `after-rollback.sh` | after a rollback | the release then current |
| `after-restore.sh` | after a restore | the release then current |
| `before-remove.sh` | before a removal | the current release |
| `on-failure.sh` | after a failed deploy, with `FORGE_FAILED_STEP` and `FORGE_RELEASE` | the failed release, skipped where it was never pulled |

```sh
# ./conf/deploy/after-migrate.sh

bin/console app:import-prices
```

## Customizing

Name the recipes yourself with `DEPLOY_RECIPES`, e.g. `DEPLOY_RECIPES=symfony` to migrate by hand,
or leave it empty for none. Several connections or entity managers are listed by name,
each connection's URL deciding its server and database:

```dotenv
# ./.env.production

DEPLOY_DOCTRINE_CONNECTIONS=default customer_db
DEPLOY_DOCTRINE_ENTITY_MANAGERS=default customer
```
