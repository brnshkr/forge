# 🎣 Hooks [🔍](../../docker/deploy.sh 'Go to source')

Recipes run what your framework needs on each deploy. Your own scripts in `./conf/deploy/` run around them.

## Usage

A deploy picks the recipes from your `composer.lock`:

| Recipe | Picked by | Runs |
| --- | --- | --- |
| `symfony` | `symfony/framework-bundle` | `bin/console cache:warmup` in every new container before it serves |
| `doctrine` | `doctrine/doctrine-bundle` | `doctrine:database:create --if-not-exists`, then `doctrine:migrations:migrate` |

`doctrine:migrations:migrate` runs only with `doctrine/doctrine-migrations-bundle` installed.
The `symfony` recipe needs `bin/console` in your image. List it in `ARCHIVE_EXTRA_PATHS`, see [your image](../images/your-image.md).

Your scripts run in this order, each where it exists:

| Script | Runs | In the image of |
| --- | --- | --- |
| `before-migrate.sh` | before the `doctrine` recipe | the new release |
| `after-migrate.sh` | after the migrations, before the new application starts | the new release |
| `before-switch.sh` | once the new application is healthy, before `current` moves | the new release |
| `after-switch.sh` | once every host switched and started the rest | the new release |
| `after-rollback.sh` | after a rollback | the release then current |
| `after-restore.sh` | after a restore | the release then current |
| `before-remove.sh` | before a removal | the current release |
| `on-failure.sh` | after a failed deploy | the failed release, where it was pulled |

```sh
# ./conf/deploy/after-migrate.sh

bin/console app:import-prices
```

A failing `before-switch.sh` undoes the deploy. `on-failure.sh` gets `FORGE_FAILED_STEP` and `FORGE_RELEASE`.
Each script and recipe runs in a fresh container of the release's image, hardened like your application,
with `FORGE_ONE_OFF=1`.

## Customizing

| `DEPLOY_RECIPES` | Runs |
| --- | --- |
| unset | the recipes `composer.lock` picks, none without one |
| `symfony doctrine` | both |
| `symfony` | only the cache warmup, migrations by hand |
| empty | none |

With several connections or entity managers, list them by name.
Each connection's URL decides its server and database:

```ini
# ./.env.production

DEPLOY_DOCTRINE_CONNECTIONS=default customer_db
DEPLOY_DOCTRINE_ENTITY_MANAGERS=default customer
```
