# 🧰 Tools [🔍](../../compose/ 'Go to source')

`node`, `semgrep`, `hadolint`, and `actionlint` run one tool each, from its upstream image.

## Usage

```yaml
# ./conf/compose.yaml

include:
  - path: oci://${FORGE_FRAGMENT_NAMESPACE:-${FORGE_NAMESPACE:?}}/forge-compose-semgrep:${FORGE_TAG:?}@${FORGE_SEMGREP_FRAGMENT_DIGEST:?}
```

```ini
# ./.env

FORGE_TAG=<tag>
SEMGREP_TAG=<tag>
SEMGREP_IMAGE_DIGEST=sha256:<digest> # <version>
FORGE_SEMGREP_FRAGMENT_DIGEST=sha256:<digest> # <version>
```

Each fragment sits behind a profile named like it. `docker compose up` leaves it out.
[🛠️ `make`](https://github.com/brnshkr/config/blob/master/docs/Makefile.md) starts it for its target.
The `-cli` and `-cli-chromium` images already carry hadolint and actionlint. A project on them needs neither fragment.

| Fragment | Image | Mounts `/app` |
| --- | --- | --- |
| `node` | `node` | read-write |
| `semgrep` | `semgrep/semgrep` | read-write |
| `hadolint` | `hadolint/hadolint` | read-only |
| `actionlint` | `rhysd/actionlint` | read-only |

Each runs as `HOST_UID` and `HOST_GID` with its home in `/tmp`.

### Without the shared Makefile

```sh
docker compose --env-file ./.env --file ./conf/compose.yaml run --rm semgrep semgrep scan --config p/default
```

## Customizing

| Variable | Changes |
| --- | --- |
| `NODE_CONTAINER_MEMORY_LIMIT` | how much memory `node` may use |
| `SEMGREP_CONTAINER_MEMORY_LIMIT` | how much memory `semgrep` may use |
| `HADOLINT_CONTAINER_MEMORY_LIMIT` | how much memory `hadolint` may use |
| `ACTIONLINT_CONTAINER_MEMORY_LIMIT` | how much memory `actionlint` may use |
| every `<TOOL>_CONTAINER_PIDS_LIMIT` | how many processes each tool may start |

The defaults are in the [fragment files](../../compose).
