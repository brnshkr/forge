# 📌 Pins [🔍](../.env 'Go to source')

Every tool and image version Forge uses is pinned in its `.env`, nowhere else, and bumped like this:

| Pinned | Bumped |
| --- | --- |
| every digest and checksum | on every bump |
| `php`, `bun` | patch only |
| every other tool | minor |
| `DEBIAN_SUITE`, every major | by hand |

Below 1.0.0 a minor counts as a major, so it moves by hand too.
Security fixes arrive with the digests, since Debian, PHP, and FrankenPHP ship them by rebuilding the same tag.
`forge-app` picks FrankenPHP by the PHP minor and Bun by the Bun minor. `forge-php-app` picks FrankenPHP only;
`forge-bun-app` picks Bun only. Patch bumps therefore never ask for a missing image.

## Your project's pins

Your repository's bump runs from `maintenance.yaml`, or on its own:

```yaml
jobs:
  bump:
    uses: brnshkr/forge/.github/workflows/bump.yaml@<commit> # <tag>
    secrets:
      BOT_CLIENT_ID: ${{ secrets.BOT_CLIENT_ID }}
      BOT_PRIVATE_KEY: ${{ secrets.BOT_PRIVATE_KEY }}
```

Each run opens a pull request, or updates the one already open, listing every move.
It moves all images pinned by digest:

- `*_IMAGE=` values in `.env` and every `.env.<stage>`
- `*_TAG` values together with their `*_IMAGE_DIGEST` or `*_FRAGMENT_DIGEST` in those files
- `image:` and `oci://` references in every Compose file `COMPOSE_FILES` lists

With `DOTENV = ./conf/.env` in your Makefile, it reads `./conf/.env` and every `./conf/.env.<stage>` instead.

```dotenv
# ./.env

FORGE_TAG=<major>.<minor>
FORGE_CLI_IMAGE_DIGEST=sha256:<digest> # <major>.<minor>.<patch>
POSTGRES_IMAGE=postgres:<major>.<minor>-<suffix>@sha256:<digest> # <major>.<minor>
```

A tag only moves its last number and keeps its suffix, so `postgres:<major>.<minor>-<suffix>` goes to the newest minor.
A tag with a single number, like `forge:<major>`, only gets a new digest, and so does `0.<minor>`.
A prerelease moves to any newer prerelease of its version and then to its release,
e.g. `<version>-alpha.<number>` to `<version>-rc.<number>` and on to `<version>`.  
The bump writes the version each digest stands for after it.
References outside Docker Hub and GHCR are not supported.

Then its `bump-command`, `make bump -- --format=tsv` by default, moves your repository's other pins,
like its dependencies, and prints one `pin<TAB>from<TAB>to` line per move.

## Release age

A new version or digest only moves once the bump has seen it for `MINIMUM_RELEASE_AGE` seconds.
Images under `ghcr.io/brnshkr` move right away.
Set it in your `.env`, or leave it empty to move everything at once:

```dotenv
# ./.env

MINIMUM_RELEASE_AGE=1209600
```

Without it, your organization's `MINIMUM_RELEASE_AGE` variable applies ([Setup docs](./github/setup.md#variables)),
and without that, a week.
