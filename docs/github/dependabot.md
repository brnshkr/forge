# 🤖 Dependabot [🔍](../../.github/workflows/reword.yaml 'Go to source')

Dependabot's commits carry a body commitlint refuses. `reword` squashes a Dependabot pull request into one commit
with only Dependabot's subject, and pushes it as your App, since a push with the workflow's own token starts no check.

## Usage

```yaml
jobs:
  reword:
    if: ${{ github.event_name == 'pull_request' }}
    uses: brnshkr/forge/.github/workflows/reword.yaml@<commit> # <tag>
    secrets:
      BOT_CLIENT_ID: ${{ secrets.BOT_CLIENT_ID }}
      BOT_PRIVATE_KEY: ${{ secrets.BOT_PRIVATE_KEY }}
```

Dependabot then stops rebasing the pull request; comment `@dependabot recreate` to start it over.
