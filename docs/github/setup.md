# ⚙️ Setup [🔍](../../.github/workflows/ 'Go to source')

What your organization and repository need once before the workflows run.

## Organization

| Setting | Value |
| --- | --- |
| _Actions → General → Fork pull request workflows_ | require approval for all external contributors |
| _Actions → General → Workflow permissions_ | read repository contents |
| _Actions → General → Policies_ | allow your organization's own actions and workflows, plus those below |
| _Packages_ | allow public packages |

Every action and workflow to allow, ready to paste:

```text
actions/cache/restore@*, actions/cache/save@*, actions/cache@*, actions/checkout@*, actions/create-github-app-token@*, actions/deploy-pages@*, actions/download-artifact@*, actions/setup-node@*, actions/upload-artifact@*, actions/upload-pages-artifact@*, aquasecurity/setup-trivy@*, aquasecurity/trivy-action@*, brnshkr/forge/.github/workflows/bump.yaml@*, brnshkr/forge/.github/workflows/check.yaml@*, brnshkr/forge/.github/workflows/ci.yaml@*, brnshkr/forge/.github/workflows/deploy.yaml@*, brnshkr/forge/.github/workflows/maintenance.yaml@*, brnshkr/forge/.github/workflows/publish.yaml@*, brnshkr/forge/.github/workflows/reword.yaml@*, brnshkr/forge/.github/workflows/security.yaml@*, docker/build-push-action@*, docker/login-action@*, docker/setup-buildx-action@*, github/codeql-action/upload-sarif@*, oven-sh/setup-bun@*
```

## Variables

| Variable | Needed | Effect |
| --- | --- | --- |
| `RUNNER_IMAGE` | always, unless you pass a `runner` input | the runner label every job runs on |
| `MINIMUM_RELEASE_AGE` | optional | seconds a new image version waits before the bump takes it, unless your `.env` sets it |

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

Create one with _Contents_, _Pull requests_, and _Workflows_ write access and install it on all your repositories.
Its commits and tags are created through GitHub's API, so GitHub signs them as the App.

| Secret | Set for | Needed by | Notes |
| --- | --- | --- | --- |
| `BOT_CLIENT_ID`, `BOT_PRIVATE_KEY` | Actions, Dependabot | check, bump, publish, reword | client ID and private key of your GitHub App; a workflow Dependabot starts only sees Dependabot's secrets |
| `NPM_CONFIG_TOKEN` | Actions | a package's first npm release | delete it after that release, see [trusted publishing](./publishing.md#trusted-publishing) |
| `PACKAGIST_USERNAME`, `PACKAGIST_TOKEN` | Actions | notifying Packagist | Packagist only crawls your repository and never receives code |

## Rulesets

Protect your branches and release tags with rulesets (_Settings → Rules → Rulesets_):

| Target | Rule |
| --- | --- |
| branches `dev/*` and `release/*` | require the `ci / Check / Check` and `ci / Check / Matrix` checks, with only your GitHub App allowed to bypass |
| tags `v*.*.*` | block updates and deletions, with an admin bypass for withdrawing a release |

The check names start with your caller's job, `ci` in the [example](./index.md#usage).
The App needs its bypass because it pushes fixes, the changelog, and the merge back to those branches.
