# 🧩 Without @brnshkr/config [🔍](../../.github/workflows/ci.yaml 'Go to source')

The workflows run `make` targets from [`@brnshkr/config`'s Makefile](https://github.com/brnshkr/config#-usage).
Without it, write those targets yourself or replace each call through its input.

## Usage

| Input | Runs by default | Receives |
| --- | --- | --- |
| `install-command` | `make`, if your repository has a Makefile | — |
| `check-command` | `make ci TEST_MATRIX=` | — |
| `matrix-rows-command` | `make -s test-matrix-rows` | — |
| `matrix-command` | `make test-matrix -- "$ROW"` | `ROW` |
| `semgrep-command` | `make semgrep -- --sarif-output="$SARIF_FILE"` | `SARIF_FILE` |
| `build-command` | `make build`, if your Makefile has a `build` target | — |
| `changelog-notes-command` | `make changelog -- --notes` | `CHANGELOG_URL`, `VERSION` |
| `changelog-write-command` | `make changelog -- --write` | `CHANGELOG_URL`, `VERSION` |
| `bump-command` | `make bump -- --format=tsv` | — |

`bump-command` runs on every bump, so without a `bump` target set it or skip the `bump` job.
A release commits only the changelog directory, the Makefile's `CHANGELOG_DIR` or `changelog-directory`,
and leaves it out of the npm package.
Your stages, Dockerfiles, and Compose files need nothing from your Makefile.
