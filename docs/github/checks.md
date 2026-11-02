# ✅ Checks [🔍](../../.github/workflows/check.yaml 'Go to source')

The runner only needs Docker and Make. The job runs `make`, then `make ci`.

## Usage

```yaml
jobs:
  check:
    uses: brnshkr/forge/.github/workflows/check.yaml@<commit> # <tag>
    with:
      matrix-max-parallel: 4
    secrets:
      BOT_CLIENT_ID: ${{ secrets.BOT_CLIENT_ID }}
      BOT_PRIVATE_KEY: ${{ secrets.BOT_PRIVATE_KEY }}
```

If the fixers changed any files, your App commits them as `chore(hygiene): apply fixes`.
On `release/*` and in pull requests from forks, changed files fail the run instead.

## Customizing

Every [`TEST_MATRIX`](https://github.com/brnshkr/config/blob/master/docs/Makefile.md#test-matrix) row then runs
in a job of its own, and `matrix-max-parallel` limits how many run at once.
Require the `Matrix` job in your [rulesets](./setup.md#rulesets) instead of the rows.
