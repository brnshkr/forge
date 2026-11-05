# 🖥️ Server [🔍](../../docker/deploy.sh 'Go to source')

Every target keeps its releases in `DEPLOY_PATH`, its secrets in `shared/`, and `current` on the release that serves.

## Usage

```text
/srv/acme-shop/
├── current -> releases/1970-01-02T00-00-00Z_1.2.3
├── forge.lock                    # while a deploy runs: when and who
├── releases/
│   ├── 1970-01-01T00-00-00Z_1.2.2/
│   │   └── forge.bad             # left by a rollback or a failed deploy: when and who
│   └── 1970-01-02T00-00-00Z_1.2.3/
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

A release is named for its UTC time and version. Names sort by time.

One deploy runs per host at a time. A second one finds `forge.lock` and fails, naming its owner and time.
Clear a lock whose deploy was killed with the `unlock` action.

`DEPLOY_PATH` may be a symbolic link, e.g. onto a data disk.
A deploy stops where `releases/` or `shared/` leads outside it.

A rollback points `current` at the newest earlier release without `forge.bad` and marks the one it leaves.
A second rollback goes further back. A restart applies changed `shared/` values.
A changed Compose file or `DEPLOY_APP_ENV` takes a deploy.

## Backups

Before `before-migrate.sh`, a deploy dumps every database of every Postgres in the release.
The dumps go to `shared/backups/<release>/`. On a shared Postgres it dumps only the target's own databases.
A backup is removed with its release.

A rollback keeps your data. With `DEPLOY_ROLLBACK_RESTORE=1` it also restores the databases.
That drops everything written since the deploy.

## Customizing

| Variable | Changes |
| --- | --- |
| `DEPLOY_KEEP_RELEASES` | how many releases each host keeps |
| `DEPLOY_WAIT_TIMEOUT` | how long a release may take to become healthy |
| `DEPLOY_ROLLBACK_RESTORE` | `1` also restores the databases on a rollback |
| `DEPLOY_REMOVE_DATA` | `1` also removes the volumes and `DEPLOY_PATH` on `remove` |

The defaults are in [`deploy.sh`](../../docker/deploy.sh).

A deploy removes bad releases first. It removes an image only the deleted releases used, never one a container runs.

## Removing a target

The `remove` action takes down the target's containers and its site on the proxy.
Its volumes and `DEPLOY_PATH` stay unless `DEPLOY_REMOVE_DATA=1`.
