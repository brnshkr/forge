# 🔐 Secrets [🔍](../../docker/deploy.sh 'Go to source')

Values only the server knows live in `shared/`, readable by their owner only.

## Usage

Each service reads only its own files, later files winning:

| Service | Reads |
| --- | --- |
| your application and workers | `shared/.env.local`, `shared/.env.<DEPLOY_APP_ENV>.local`, `shared/.env.deploy.local` |
| Mercure | `shared/.env.mercure.local` |
| Mailpit | `shared/.env.mailpit.local` |

Postgres and Valkey take their values from the release's `compose.yaml`, readable by its owner only too.
`.env.local` never reaches a server.

Keep secrets in Symfony's vault and put its decryption key on the server, with whatever differs per server:

```sh
ssh deploy@203.0.113.10 'cat >>/srv/acme-shop/shared/.env.local' <<'EOF'
SYMFONY_DECRYPTION_SECRET=<base64 of config/secrets/prod/prod.decrypt.private.php>
EOF
```

Or let every deploy write them. From CI, the GitHub environment's `DEPLOY_DOTENV` secret writes
`shared/.env.deploy.local`, see [deploying](../github/deploying.md). From your machine, `DEPLOY_DOTENV_FILE` does:

```sh
DEPLOY_DOTENV_FILE=./.local/production.env VERSION=1.2.3 sh ./.cache/deploy.sh deploy production
```

Its values win over `.env.local` and over your stage files.
`DEPLOY_DOTENV_MERCURE` and `DEPLOY_DOTENV_MAILPIT` write the files of those services.
From your machine they are `DEPLOY_DOTENV_MERCURE_FILE` and `DEPLOY_DOTENV_MAILPIT_FILE`.
Hand-written files survive. The managed values win.

## Customizing

| Variable | Changes |
| --- | --- |
| `DEPLOY_APP_ENV` | which environment the target runs, and so its `shared/.env.<env>.local` |

The defaults are in [`deploy.sh`](../../docker/deploy.sh).

## Public repositories

A public repository does not have to name its servers.
The GitHub environment's `DEPLOY_HOSTS` and `DEPLOY_PATH` secrets replace the stage file's.

## Private images

A server pulling private images logs in once, with a token that may only read packages:

```sh
ssh deploy@203.0.113.10 'docker login ghcr.io --username <owner> --password-stdin' <./.local/read-packages.token
```
