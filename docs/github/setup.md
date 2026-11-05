# ⚙️ Setup [🔍](../../.github/workflows/ 'Go to source')

What your organization and repository set up once before the workflows run.

## Organization

| Setting | Value |
| --- | --- |
| _Actions → General → Fork pull request workflows_ | require approval for all external contributors |
| _Actions → General → Workflow permissions_ | read repository contents |
| _Actions → General → Policies_ | allow your organization's own actions and workflows, plus the ones below |
| _Packages_ | allow public packages |

Every action and workflow to allow, ready to paste:

```text
actions/cache/restore@*, actions/cache/save@*, actions/cache@*, actions/checkout@*, actions/create-github-app-token@*, actions/deploy-pages@*, actions/download-artifact@*, actions/setup-node@*, actions/upload-artifact@*, actions/upload-pages-artifact@*, aquasecurity/setup-trivy@*, aquasecurity/trivy-action@*, brnshkr/forge/.github/workflows/bump.yaml@*, brnshkr/forge/.github/workflows/check.yaml@*, brnshkr/forge/.github/workflows/ci.yaml@*, brnshkr/forge/.github/workflows/deploy.yaml@*, brnshkr/forge/.github/workflows/image.yaml@*, brnshkr/forge/.github/workflows/maintenance.yaml@*, brnshkr/forge/.github/workflows/publish.yaml@*, brnshkr/forge/.github/workflows/reword.yaml@*, brnshkr/forge/.github/workflows/security.yaml@*, docker/build-push-action@*, docker/login-action@*, docker/setup-buildx-action@*, github/codeql-action/upload-sarif@*, oven-sh/setup-bun@*
```

## Variables

| Variable | Needed | Does |
| --- | --- | --- |
| `RUNNER_IMAGE` | always, unless you pass `runner` | which runner every job runs on |
| `MINIMUM_RELEASE_AGE` | optional | how long a new version waits before the bump takes it, unless `.env` sets it |
| `MIRROR_REGISTRY`, `MIRROR_NAMESPACE` | optional | where every release is mirrored, see [publishing](./publishing.md) |
| `DEPLOY_KNOWN_HOSTS` | for a deploy | the servers' host keys, see [deploying](./deploying.md) |

```sh
gh variable set RUNNER_IMAGE --org acme --body ubuntu-<version> --visibility all
```

## Bot

The workflows push through a GitHub App of your organization. The App:

- commits the check's fixes
- opens the bump pull request and keeps it up to date
- commits a release's changelog, creates its tags, and merges it back
- rewords Dependabot's commits
- tells your other repositories about a new release

Create one with _Contents_, _Pull requests_, and _Workflows_ write access, and install it on all your repositories.
GitHub signs its commits and tags as the App.

| Secret | Set for | Holds |
| --- | --- | --- |
| `BOT_CLIENT_ID`, `BOT_PRIVATE_KEY` | Actions and Dependabot | your App's client ID and private key |
| `NPM_CONFIG_TOKEN` | Actions | a token for a package's first npm release, see [publishing](./publishing.md#trusted-publishing) |
| `PACKAGIST_USERNAME`, `PACKAGIST_TOKEN` | Actions | your Packagist login, to tell Packagist about a release |

A workflow Dependabot starts sees only Dependabot's secrets. Set the bot's there too.

## Rulesets

Protect your branches and release tags under _Settings → Rules → Rulesets_:

| Target | Rule |
| --- | --- |
| branches `dev/*` and `release/*` | require the `ci / Check / Check` and `ci / Check / Matrix` checks, only your App may bypass |
| tags `v*.*.*` | block updates and deletions, with an admin bypass to withdraw a release |

The check names start with your caller's job, `ci` in the [example](./index.md#usage).
The App needs its bypass to push fixes, the changelog, and the merge back.
