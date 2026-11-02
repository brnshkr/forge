# ⏭️ Skipping jobs [🔍](../../src/shared/release/skip.ts 'Go to source')

Most jobs already run only where your repository has something for them: images where a stage file sets `IMAGE_NAME`,
npm where `package.json` isn't private, Packagist where `composer.json` isn't a project, a deploy where a stage file
sets `DEPLOY_HOSTS`, and the matrix where `TEST_MATRIX` has rows. `skip` turns off what would still run.

## Usage

```yaml
jobs:
  ci:
    uses: brnshkr/forge/.github/workflows/ci.yaml@<commit> # <tag>
    with:
      skip: '["matrix", "deploy", "packagist"]'
```

Name a job or a whole group:

| Group | Jobs |
| --- | --- |
| `review` | `reword` |
| `check` | `hygiene`, `matrix` |
| `deploy` | `testing`, `staging`, `production` |
| `security` | `semgrep`, `gitleaks`, `osv-scanner`, `trivy` |
| `publish` | `images`, `npm`, `packagist`, `fragments`, `release`, `changelog`, `merge`, `dispatch`, `pages` |
| `bump` | `bump` |

`staging` skips every stage that deploys like it. An unknown name fails the run.
The check itself always runs; without `hygiene`, changed files fail it.
