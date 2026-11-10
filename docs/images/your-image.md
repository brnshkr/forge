# 🏗️ Your image [🔍](../../docker/app/Dockerfile 'Go to source')

Build your project's own image from a stage file, with or without a Dockerfile of your own.

## Usage

Every `.env.<stage>` file that sets `IMAGE_NAME` is one image:

```ini
# ./.env.production

IMAGE_NAME=acme-shop
IMAGE_TARGET=prod
FORGE_APP_IMAGE_DIGEST=sha256:<digest> # <version>
EXTRA_PHP_EXTENSIONS=gd
```

```ini
# ./.env

FORGE_TAG=<tag>
FORGE_APP_DEV_IMAGE_DIGEST=sha256:<digest> # <version>
```

Every push builds, verifies, and scans it. Every release publishes it to `ghcr.io/<owner>/acme-shop` by default.
[Publishing](../github/publishing.md) covers another registry and a mirror such as Docker Hub.
It is built at `IMAGE_TARGET` from tracked files only.

Without a Dockerfile of your own, Forge's Dockerfile builds it in two stages:

1. On `FORGE_APP_DEV_IMAGE`: installs the Composer and Bun dependencies,
   runs `APP_ENV=prod make dist` where your Makefile has it, keeps production dependencies only,
   and runs `composer dump-env prod` for Symfony.
2. On `FORGE_APP_IMAGE`: copies the result, owned by `forge`, and runs it as `www-data`.

The image holds what your package archive ships: every path `.gitattributes` does not `export-ignore`,
plus the dependencies and the build output. Config writes that `.gitattributes` from your `composer.json`.
List the paths your app needs at runtime, then run `make configs`:

```makefile
# ./Makefile

ARCHIVE_EXTRA_PATHS = bin/console config/ public/ templates/ migrations/ .env
```

Without such a `.gitattributes`, every tracked file ships.
`var/` must ship empty. Its volume copies files only once, so the build fails on a file there.

### Dockerfile of your own

Forge picks `IMAGE_DOCKERFILE`, else `./conf/docker/<IMAGE_NAME>.Dockerfile`, else `./docker/<IMAGE_NAME>.Dockerfile`.
Start from Forge's own and change it:

```sh
docker run --rm --entrypoint cat docker.io/brnshkr/forge:<tag>-app-dev@sha256:<digest> \
  /usr/local/share/forge/app.Dockerfile >./docker/acme-shop.Dockerfile
```

It declares `ARG FORGE_APP_DEV_IMAGE` and `ARG FORGE_APP_IMAGE`,
builds on `FROM ${FORGE_APP_DEV_IMAGE}`, and ends on `FROM ${FORGE_APP_IMAGE}`.
Every `FORGE_<ROLE>_IMAGE` argument resolves from its digest.
Every other `ARG` takes its value from the stage's env files. One without a default that nothing sets fails the build.
The context is the tracked files plus `.forge-export-ignored`.
The hadolint rules of [@brnshkr/config](https://github.com/brnshkr/config) require the OCI labels.

A `verify.sh` beside the Dockerfile runs before each push.
It gets the image reference, the image name, and the target as arguments.

## Customizing

| Variable | Falls back to | Changes |
| --- | --- | --- |
| `IMAGE_NAME` | — | names the image |
| `IMAGE_TARGET` | — | which Dockerfile stage is built |
| `IMAGE_DOCKERFILE` | — | a Dockerfile anywhere in the repository |
| `IMAGE_DESCRIPTION` | — | the image's description |
| `IMAGE_ALIASES` | — | more tags |
| `IMAGE_SUFFIX` | — | appended to every tag |
| `IMAGE_INCLUDE` | — | paths to ship that the archive leaves out |
| `IMAGE_EXCLUDE` | — | paths to leave out that the archive ships |
| `EXTRA_APT_PACKAGES` | — | Debian packages to add |
| `EXTRA_PHP_EXTENSIONS` | — | PHP extensions to add |
| `FORGE_VAR_DIR` | — | where the app writes |
| `FORGE_CACHE_DIR` | — | where the app caches |
| `FORGE_APP_DEV_IMAGE` | from `FORGE_TAG` and its digest | the build image, as a full pinned reference |
| `FORGE_APP_IMAGE` | from `FORGE_TAG` and its digest | the runtime image, as a full pinned reference |

The defaults are in [`Dockerfile`](../../docker/app/Dockerfile).

Another `FORGE_VAR_DIR` or `FORGE_CACHE_DIR` must exist in the image, owned by the runtime user.
