# ⏭️ Skipping jobs [🔍](../../src/shared/release/skip.ts 'Go to source')

`skip` turns off jobs your repository doesn't want.

## Usage

```yaml
# ./.github/workflows/ci.yaml

jobs:
  ci:
    uses: brnshkr/forge/.github/workflows/ci.yaml@<commit> # <tag>
    with:
      skip: '["matrix", "deploy", "packagist"]'
```

Most jobs already run only where your repository has something for them:

| Job | Runs where |
| --- | --- |
| images | a stage file sets `IMAGE_NAME` |
| npm | `package.json` isn't private |
| Packagist | `composer.json` isn't a project |
| a deploy | a stage file sets `DEPLOY_HOSTS` |
| the matrix | `TEST_MATRIX` has rows |

Name a job or a whole group:

| Group | Jobs |
| --- | --- |
| `review` | `reword` |
| `check` | `hygiene`, `matrix` |
| `deploy` | `testing`, `staging`, `production` |
| `security` | `semgrep`, `gitleaks`, `osv-scanner`, `trivy` |
| `publish` | `images`, `npm`, `packagist`, `fragments`, `release`, `changelog`, `merge`, `dispatch`, `pages` |
| `bump` | `bump` |

`staging` skips every target that deploys like it. An unknown name fails the run.
The check itself always runs. Without `hygiene`, changed files fail it.
