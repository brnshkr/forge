# 🔐 Secrets [🔍](../../docker/deploy.sh 'Go to source')

Values only the server knows live in `shared/`, readable by their owner only, and each service reads only its own
files. `.env.local` never reaches a server, so a developer's settings stay on their machine.

| Service | Reads, later files winning |
| --- | --- |
| your application | `shared/.env.local`, `shared/.env.<DEPLOY_APP_ENV>.local`, `shared/.env.deploy.local` |
| Mercure | `shared/.env.mercure.local` |
| Mailpit | `shared/.env.mailpit.local` |

Postgres and Valkey take their values from the rendered `compose.yaml`, which is readable by its owner only too.

## Usage

Keep secrets in Symfony's vault and put its decryption key on the server,
together with whatever differs per server:

```sh
ssh deploy@203.0.113.10 'cat >>/srv/acme-shop/shared/.env.local' <<'EOF'
SYMFONY_DECRYPTION_SECRET=<base64 of config/secrets/prod/prod.decrypt.private.php>
EOF
```

Or let every deploy write them: the GitHub environment's `DEPLOY_DOTENV` secret ([GitHub docs](../github/deploying.md)),
or locally `DEPLOY_DOTENV_FILE=./.local/production.env`, writes `shared/.env.deploy.local`.
Its values win over `.env.local` and over your stage files' while the release is rendered.
`DEPLOY_DOTENV_MERCURE` and `DEPLOY_DOTENV_MAILPIT` (locally `DEPLOY_DOTENV_MERCURE_FILE` and `DEPLOY_DOTENV_MAILPIT_FILE`)
write the files of those services. Hand-written files survive, and the managed values win.

## Customizing

`DEPLOY_APP_ENV` picks the environment the system runs, `prod` unless set, and so its `shared/.env.<env>.local`.
To look at production in `dev`, deploy an image with your dev dependencies and `DEPLOY_APP_ENV=dev`;
`APP_DEBUG=1` alone already shows every error.

A public repository need name no server: the GitHub environment's `DEPLOY_HOSTS` and `DEPLOY_PATH` variables replace
the stage file's, and the logs mask every host, user, and path.

A server pulling private images logs in once, with a token that may only read packages:

```sh
ssh deploy@203.0.113.10 'docker login ghcr.io --username <owner> --password-stdin' <./.local/read-packages.token
```
