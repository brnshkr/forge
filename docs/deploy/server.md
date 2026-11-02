# 🖥️ Server [🔍](../../docker/deploy.sh 'Go to source')

Every target keeps its releases side by side in `DEPLOY_PATH`, the values only the server knows in `shared/`,
and `current` pointing to the release that serves.

## Usage

```text
/srv/acme-shop/
├── current -> releases/2026-10-31T14-30-00Z_1.2.3
├── forge.lock                    # while a deploy runs: when and who
├── releases/
│   ├── 2026-10-30T09-12-44Z_1.2.2/
│   │   └── forge.bad             # left by a rollback or a failed deploy: when and who
│   └── 2026-10-31T14-30-00Z_1.2.3/
│       ├── compose.yaml          # rendered, every image pinned by its digest
│       ├── forge.shared          # the services this release shares
│       └── hooks/                # your scripts from ./conf/deploy/
└── shared/
    ├── .env.local                # values only this server knows
    ├── .env.deploy.local         # written by every deploy from DEPLOY_DOTENV
    ├── .env.mercure.local        # read by Mercure alone
    ├── .env.prod.local
    └── backups/
```

Release names sort by their UTC time. A second deploy finds the lock and fails, saying who holds it.
`DEPLOY_PATH` may be a symbolic link, e.g. onto a data disk, but a deploy stops where `releases/` or `shared/`
leads outside it, or a shared service's directory outside `DEPLOY_SHARED_PATH`.

| Command | Does |
| --- | --- |
| `make production-deploy VERSION=1.2.3` | deploys a published version |
| `make production-deploy-rollback` | goes back one release, again for each call |
| `make production-deploy-restart` | recreates your application, e.g. after changing `shared/.env.local` |
| `make production-deploy-restore` | restores the databases as they were before the current release |
| `make production-deploy-unlock` | clears the lock of a deploy that was killed |
| `make production-deploy-shared` | recreates the services the server shares, e.g. after a bump |
| `make production-deploy-remove` | takes the target off its servers |

A rollback points `current` at the newest earlier release without `forge.bad` and marks the one it leaves,
so a second rollback goes further back. A restart applies changed `shared/` values;
a changed Compose file or `DEPLOY_APP_ENV` takes a deploy.

## Backups

Before `before-migrate.sh`, a deploy dumps every database of every Postgres in the release, and the target's own
databases on a shared Postgres, into `shared/backups/<release>/`, removed together with its release.
A rollback keeps your data; with `DEPLOY_ROLLBACK_RESTORE=1` it also restores the databases,
which drops everything written since.

## Customizing

```dotenv
# ./.env.production

DEPLOY_KEEP_RELEASES=5
DEPLOY_WAIT_TIMEOUT=300
```

Cleaning up keeps `DEPLOY_KEEP_RELEASES`, bad releases going first, and removes each image only deleted releases used,
never one a container runs. `make production-deploy-remove` takes down the containers and the proxy's site file;
with `DEPLOY_REMOVE_DATA=1` also the volumes and `DEPLOY_PATH`.
