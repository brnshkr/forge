# 🔧 Tools [🔍](../../compose/ 'Go to source')

Some tools never ship in your image and run on their own upstream image instead.
[`@brnshkr/config`](https://github.com/brnshkr/config)'s Makefile starts each one for its target;
without that Makefile they are plain Compose services you run yourself.

## Usage

| Fragment | Image | Run by |
| --- | --- | --- |
| `forge/compose/node` | `node:<version>-<debian-suite>` | `make eslint-inspect` |
| `forge/compose/semgrep` | `semgrep/semgrep:<version>-nonroot` | `make semgrep` |
| `forge/compose/hadolint` | `hadolint/hadolint:v<version>-alpine` | `make hadolint` |
| `forge/compose/actionlint` | `rhysd/actionlint:<version>` | `make actionlint` |

```yaml
# ./conf/compose.yaml

include:
  - path: oci://${FORGE_REPOSITORY}/compose/semgrep:${SEMGREP_FRAGMENT_TAG:-${FORGE_TAG:?}}@${SEMGREP_FRAGMENT_DIGEST:?}
```

```dotenv
# ./.env

SEMGREP_TAG=<version>-nonroot
SEMGREP_IMAGE_DIGEST=sha256:<digest> # <version>
SEMGREP_FRAGMENT_DIGEST=sha256:<digest> # <version>
```

Each service sits in a profile of its own name, so `docker compose up` leaves it out:

```sh
docker compose --file ./conf/compose.yaml run --rm semgrep semgrep --version
```

## Customizing

Forge's CLI images already carry hadolint and actionlint, so a project on one of them needs neither fragment.
