# 🚚 Deploying [🔍](../../.github/workflows/deploy.yaml 'Go to source')

`deploy.yaml` deploys every stage file that sets `DEPLOY_HOSTS`, in the GitHub environment named like it.

## Usage

A push to `dev/*` deploys `testing`. A release deploys `staging` and every other target before it publishes anything,
then `production` once approved. See the [stages](../deploy/stages.md).

Create an environment per target under _Settings → Environments_:

| Name | Kind | Holds |
| --- | --- | --- |
| `DEPLOY_SSH_KEY` | secret | the private key the deploy logs in with |
| `DEPLOY_KNOWN_HOSTS` | variable | the servers' host keys, the output of `ssh-keyscan` |
| `DEPLOY_DOTENV` | secret | the server's `shared/.env.deploy.local`, see [secrets](../deploy/secrets.md) |
| `DEPLOY_DOTENV_MERCURE` | secret | the server's `shared/.env.mercure.local` |
| `DEPLOY_DOTENV_MAILPIT` | secret | the server's `shared/.env.mailpit.local` |
| `DEPLOY_HOSTS`, `DEPLOY_PATH` | secret | the hosts and path, instead of the stage file's |

Give `production` required reviewers. A release then waits for one of them.
The logs mask every host and path. Hosts in a committed stage file stay public.

## Choosing targets

A target that keeps its hosts only in its environment has none in its stage file. List the targets yourself:

```yaml
# ./.github/workflows/ci.yaml

jobs:
  ci:
    uses: brnshkr/forge/.github/workflows/ci.yaml@<commit> # <tag>
    with:
      deploy-targets: '["staging", "production"]'
```

## Deploying by hand

A workflow of your own redeploys, rolls back, or unlocks:

```yaml
# ./.github/workflows/deploy.yaml

name: Deploy

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

permissions:
  contents: read

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

Take a look at the [deploy docs](../deploy/index.md) for what each action does.
