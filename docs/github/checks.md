# ✅ Checks [🔍](../../.github/workflows/check.yaml 'Go to source')

`check.yaml` runs `make`, then `make ci`. The runner needs only Docker and Make.

## Usage

```yaml
# ./.github/workflows/ci.yaml

jobs:
  check:
    uses: brnshkr/forge/.github/workflows/check.yaml@<commit> # <tag>
    with:
      matrix-max-parallel: 4
    secrets:
      BOT_CLIENT_ID: ${{ secrets.BOT_CLIENT_ID }}
      BOT_PRIVATE_KEY: ${{ secrets.BOT_PRIVATE_KEY }}
```

When the fixers change files, your App commits them as `chore(hygiene): apply fixes`.
On `release/*` and in pull requests from forks, changed files fail the run instead.

Every [`TEST_MATRIX`](https://github.com/brnshkr/config/blob/master/docs/Makefile.md#test-matrix) row runs
in a job of its own. Require the `Matrix` job in your [rulesets](./setup.md#rulesets), not the rows.

## Customizing

| Input | Changes |
| --- | --- |
| `matrix-max-parallel` | how many `TEST_MATRIX` rows run at once |
| `install-command` | how dependencies install |
| `check-command` | how the repository is checked |
| `matrix-rows-command` | how the rows are listed |
| `matrix-command` | how one row runs |

The defaults are in [`check.yaml`](../../.github/workflows/check.yaml).

### Without the shared Makefile

Replace each command with your own. `matrix-rows-command` prints the rows as a JSON array,
and `matrix-command` runs the one in `ROW`. With `FORGE_NAMESPACE` in `.env`:

```yaml
# ./.github/workflows/ci.yaml

jobs:
  ci:
    uses: brnshkr/forge/.github/workflows/ci.yaml@<commit> # <tag>
    with:
      install-command: docker compose --env-file ./.env --file ./conf/compose.yaml run --rm cli composer install
      check-command: docker compose --env-file ./.env --file ./conf/compose.yaml run --rm cli composer test
      skip: '["matrix"]'
```
