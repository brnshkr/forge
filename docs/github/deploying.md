# 🚚 Deploying [🔍](../../.github/workflows/deploy.yaml 'Go to source')

Every stage file that sets `DEPLOY_HOSTS` deploys from CI ([Stages](../deploy/stages.md)):
a push to `dev/*` deploys `testing` as `dev-<short sha>`, and a release deploys `staging` and every other stage
before it publishes anything, then `production` once approved.

## Usage

Each target is a GitHub environment of the same name (_Settings → Environments_):

| Name | Kind | Holds |
| --- | --- | --- |
| `DEPLOY_SSH_KEY` | secret | the private key the deploy logs in with |
| `DEPLOY_KNOWN_HOSTS` | variable | the hosts' keys, the output of `ssh-keyscan` |
| `DEPLOY_DOTENV` | secret | the server's `shared/.env.deploy.local`, written on every deploy, its values winning over your stage files' |
| `DEPLOY_DOTENV_MERCURE`, `DEPLOY_DOTENV_MAILPIT` | secret | the server's `.env.mercure.local` and `.env.mailpit.local`, which only those services read |
| `DEPLOY_HOSTS`, `DEPLOY_PATH` | secret | the hosts and path, used instead of the stage file's |

The logs mask every host and path, and a secret is never printed; hosts in a committed stage file stay public with it.
Give `production` required reviewers, so a release waits for one of them.

## Customizing

CI deploys every stage whose file sets `DEPLOY_HOSTS`. A stage that keeps its hosts only in the environment's
`DEPLOY_HOSTS` secret has none in its file, so list the stages to deploy yourself:

```yaml
jobs:
  ci:
    uses: brnshkr/forge/.github/workflows/ci.yaml@<commit> # <tag>
    with:
      deploy-targets: '["staging", "production"]'
```

A workflow of your own redeploys, rolls back, or unlocks by hand:

```yaml
# ./.github/workflows/deploy.yaml

on:
  workflow_dispatch:
    inputs:
      target:
        type: choice
        options:
          - staging
          - production

      action:
        type: choice
        options:
          - deploy
          - rollback
          - restart
          - restore
          - remove
          - shared
          - unlock

      version:
        type: string

jobs:
  deploy:
    permissions:
      contents: read
      packages: read
    uses: brnshkr/forge/.github/workflows/deploy.yaml@<commit> # <tag>
    with:
      target: ${{ inputs.target }}
      action: ${{ inputs.action }}
      version: ${{ inputs.version }}
```
