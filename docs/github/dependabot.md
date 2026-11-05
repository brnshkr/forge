# 🤖 Dependabot [🔍](../../.github/workflows/reword.yaml 'Go to source')

`reword.yaml` squashes a Dependabot pull request into one commit with only Dependabot's subject.

## Usage

```yaml
# ./.github/workflows/ci.yaml

jobs:
  reword:
    if: ${{ github.event_name == 'pull_request' }}
    uses: brnshkr/forge/.github/workflows/reword.yaml@<commit> # <tag>
    secrets:
      BOT_CLIENT_ID: ${{ secrets.BOT_CLIENT_ID }}
      BOT_PRIVATE_KEY: ${{ secrets.BOT_PRIVATE_KEY }}
```

Dependabot's commits carry a body commitlint refuses. Your App pushes the squashed commit.
A push with the workflow's own token would start no check.

Dependabot stops rebasing the pull request afterwards. Comment `@dependabot recreate` to start it over.
Set the bot's secrets for Dependabot too, see the [setup](./setup.md#bot).
