# 📌 Pins [🔍](../.env 'Go to source')

Forge pins every tool in its `.env`. The bump keeps those pins current, in Forge and in your project.

## Forge's pins

Each tool is a version plus a digest, and the image reference built from both:

```ini
# ./.env

BUILDKIT_VERSION=<version>
BUILDKIT_DIGEST=sha256:<digest>
BUILDKIT_IMAGE=moby/buildkit:v${BUILDKIT_VERSION}@${BUILDKIT_DIGEST}
```

Gitleaks, OSV-Scanner, Node, and Semgrep are pinned the same way. `make bump` moves them:

| Pinned | Bumped |
| --- | --- |
| every digest and checksum | on every bump |
| `php`, `bun` | patch only |
| every other tool | minor |
| `DEBIAN_SUITE`, every major | by hand |

Below 1.0.0 a minor counts as a major and moves by hand too.
Security fixes arrive with the digests. Debian, PHP, and FrankenPHP rebuild the same tag.
`forge`'s app roles pick FrankenPHP by the PHP minor and Bun by the Bun minor.
`forge-php` picks FrankenPHP only, `forge-bun` Bun only. A patch bump never asks for a missing image.

## Your project's pins

The bump runs from `maintenance.yaml`, or on its own:

```yaml
# ./.github/workflows/bump.yaml

name: Bump

on:
  workflow_dispatch: {}

permissions:
  contents: read

jobs:
  bump:
    uses: brnshkr/forge/.github/workflows/bump.yaml@<commit> # <tag>
    secrets:
      BOT_CLIENT_ID: ${{ secrets.BOT_CLIENT_ID }}
      BOT_PRIVATE_KEY: ${{ secrets.BOT_PRIVATE_KEY }}
```

Each run opens one pull request on `chore/versions` that lists every move, or updates the one already open.
It moves every image pinned by digest:

- `*_IMAGE=` values in `.env` and every `.env.<stage>`
- `*_TAG` values with their `*_IMAGE_DIGEST` or `*_FRAGMENT_DIGEST` in those files
- `image:` and `oci://` references in every Compose file `COMPOSE_FILES` lists

With `DOTENV = ./conf/.env` in your Makefile, it reads `./conf/.env` and every `./conf/.env.<stage>` instead.

```ini
# ./.env

FORGE_TAG=<major>.<minor>
FORGE_CLI_IMAGE_DIGEST=sha256:<digest> # <major>.<minor>.<patch>
POSTGRES_IMAGE=postgres:<major>.<minor>-<suffix>@sha256:<digest> # <major>.<minor>
```

A tag moves only its last number and keeps its suffix. `postgres:<major>.<minor>-<suffix>` goes to the newest minor.
A single-number tag like `forge:<major>-cli` only gets new digests, and so does `0.<minor>`.
A prerelease moves to newer prereleases of its version, then to its release,
e.g. `<version>-alpha.<number>` to `<version>-rc.<number>` and on to `<version>`.
The bump writes the version each digest stands for after it. Only Docker Hub and GHCR are supported.

Then `bump-command` moves your project's other pins, like its dependencies.
It prints one `pin<TAB>from<TAB>to` line per move.

### Without the shared Makefile

`bump-command` defaults to `make bump -- --format=tsv` and runs on every bump.
Without a `bump` target, set it or skip the `bump` job, see [skipping jobs](./github/skipping-jobs.md).

## Release age

A new version or digest moves only once the bump has seen it for `MINIMUM_RELEASE_AGE` seconds.
Images under `docker.io/brnshkr` and `ghcr.io/brnshkr` move right away.
Set it in your `.env`, or leave it empty to move everything at once:

```ini
# ./.env

MINIMUM_RELEASE_AGE=1209600
```

Without it, your organization's `MINIMUM_RELEASE_AGE` variable applies, see the [setup](./github/setup.md#variables).
Without that, the bump uses its [default](../src/shared/bump/release-age.ts).
