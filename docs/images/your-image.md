# 🏗️ Your image [🔍](../../docker/app/Dockerfile 'Go to source')

Every `.env.<stage>` file that sets `IMAGE_NAME` is one image of your repository, built at `IMAGE_TARGET`
from your tracked files only, so nothing your `.gitignore` lists ever reaches it.

## Usage

```dotenv
# ./.env

FORGE_TAG=<tag>
FORGE_APP_IMAGE_SUFFIX=-dev
FORGE_APP_IMAGE_DIGEST=sha256:<digest> # <version>
```

```dotenv
# ./.env.production

IMAGE_NAME=acme-shop
IMAGE_TARGET=prod
FORGE_RUNTIME_IMAGE_DIGEST=sha256:<digest> # <version>
EXTRA_PHP_EXTENSIONS=gd
```

By default, it builds on `forge-app:<tag>-dev` and runs on `forge-app:<tag>`, pinned by
`FORGE_RUNTIME_IMAGE_DIGEST`. Keep `forge-app` for PHP and Bun, set `FORGE_APP_IMAGE_NAME=forge-php-app` when the
app needs no Bun, or choose `forge-bun-app` for a Bun-only project. A project using a different build toolchain pins
it with `FORGE_BUILD_IMAGE_DIGEST`.

Without `./conf/docker/<IMAGE_NAME>.Dockerfile` or `./docker/<IMAGE_NAME>.Dockerfile`, Forge's own Dockerfile
builds it: it installs your Composer and Bun dependencies on `FORGE_BUILD_IMAGE`, runs `make dist` where your
Makefile has it, keeps only production dependencies, runs `composer dump-env prod` for Symfony, and copies the result
onto `FORGE_RUNTIME_IMAGE`, owned by `forge` and run by its unprivileged runtime user.
A deploy refuses a `-dev` `FORGE_RUNTIME_IMAGE`; development images are not production runtimes.

The image holds what your package archive ships, the paths your `.gitattributes` does not `export-ignore`,
plus your dependencies and whatever the build generated, so tests, docs, and tool configs never reach it.
`@brnshkr/config` writes that `.gitattributes` from your `composer.json`; an application lists what it runs from:

```makefile
# ./Makefile

ARCHIVE_EXTRA_PATHS = bin/console \
  config/ \
  public/ \
  templates/ \
  migrations/ \
  .env
```

Without a `.gitattributes` that leaves anything out, every tracked file ships.
The image's labels come from your repository and your manifest.

## Customizing

| Variable | Effect |
| --- | --- |
| `FORGE_BUILD_IMAGE`, `FORGE_RUNTIME_IMAGE` | replaces the image it builds or runs on, as a full pinned reference |
| `EXTRA_APT_PACKAGES`, `EXTRA_PHP_EXTENSIONS` | adds packages and PHP extensions |
| `IMAGE_INCLUDE` | ships these paths although the archive leaves them out |
| `IMAGE_EXCLUDE` | leaves these paths out although the archive ships them |
| `FORGE_VAR_DIR`, `FORGE_CACHE_DIR` | the directories it prepares for `www-data` ([Production](../compose/production.md)) |
| `IMAGE_SUFFIX`, `IMAGE_ALIASES` | appended to each tag, and more tags ([Releases docs](../releases.md#tags)) |

`var/` has to be empty in the image: its volume copies the image's files only once, so the build fails on a file there.

### Building it yourself

`./conf/docker/<IMAGE_NAME>.Dockerfile` takes over from Forge's:

```dockerfile
# ./conf/docker/acme-shop.Dockerfile

ARG FORGE_BUILD_IMAGE
ARG FORGE_RUNTIME_IMAGE

FROM ${FORGE_BUILD_IMAGE} AS build

WORKDIR /app

USER 0:0

RUN chown "${FORGE_CODE_OWNER}" /app

USER ${FORGE_CODE_OWNER}

COPY --chown=${FORGE_CODE_OWNER} . .

RUN composer install --no-dev --classmap-authoritative --no-interaction

FROM ${FORGE_RUNTIME_IMAGE} AS prod

LABEL \
  org.opencontainers.image.source="https://github.com/<owner>/acme-shop" \
  org.opencontainers.image.description="Online shop of Acme" \
  org.opencontainers.image.licenses="MIT" \
  org.opencontainers.image.title="acme-shop" \
  org.opencontainers.image.url="https://github.com/<owner>/acme-shop" \
  org.opencontainers.image.documentation="https://github.com/<owner>/acme-shop#readme" \
  org.opencontainers.image.vendor="acme" \
  org.opencontainers.image.authors="Acme"

WORKDIR /app

COPY --from=build --chown=${FORGE_CODE_OWNER} /app ./

USER 0:0

RUN <<'EOF'
  find . -type d -perm -0002 -exec chmod o-w,-t {} +

  install \
    -d \
    -o "${RUNTIME_USER_UID}" \
    -g "${RUNTIME_USER_GID}" \
    -m 0700 \
    "${FORGE_VAR_DIR}" \
    "${FORGE_CACHE_DIR}"
EOF

USER ${FORGE_RUNTIME_USER}
```

Every `ARG` takes its stage's value, and one without a default that nothing sets fails the build.
The context holds your tracked files and `.forge-export-ignored`, the paths your archive leaves out.
`@brnshkr/config`'s hadolint config requires the labels.

A `verify.sh` beside the Dockerfile runs before each push with the image, its name, and its target.
When and where the images are pushed is described in the [Releases docs](../releases.md).
