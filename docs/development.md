# 💻 Development

Working on Forge itself. To use the images, fragments, or workflows, the [README](../README.md) and the other pages
are all you need.

## Setup

With Docker and Make installed, run this on a fresh clone:

```sh
make
```

It builds the `forge-cli` image, installs the dependencies inside it, and installs the Git hooks.
`make help` lists every target. [Config's docs](https://github.com/brnshkr/config/blob/master/docs/Makefile.md)
explain the shared ones.

## Layout

| Path | Holds |
| --- | --- |
| `./bin/` | the scripts the workflows run in every repository, from Forge's own checkout |
| `./scripts/` | Forge's own tools, like `make bump-tools` |
| `./src/` | the logic of both, tested to full coverage |
| `./docker/php.Dockerfile`, `./docker/bun.Dockerfile` | every published image |
| `./docker/verify.sh` | the check each built image passes before it is pushed |
| `./docker/app/Dockerfile` | the Dockerfile a project without its own is built with |
| `./docker/deploy.sh` | the deploy every target runs over SSH |

## Stages

Each stage is one image, named `<image>-<role>`. The images are `forge`, `forge-php`, and `forge-bun`.
The roles are `-cli`, `-cli-chromium`, `-app-dev`, and `-app`.

Each stage's `.env.<stage>` sets `IMAGE_NAME`, `IMAGE_TARGET`, `IMAGE_DESCRIPTION`, `IMAGE_DOCKERFILE`, and `IMAGE_ALIASES`.
`forge-php` stages also set `HAS_BUN=false`. `.env` sets `IMAGE_SUFFIX=-${IMAGE_TARGET}` once
and holds every pin and list the stages share.

`APP_ENV` picks the stage you work on, `forge-cli` by default. Set it in `.env.local`:

```ini
# ./.env.local

APP_ENV=forge-cli-chromium
```

`make build` builds the current stage. `make <stage>-build` builds another, e.g. `make forge-cli-chromium-build`.
Local images are tagged `local` plus the suffix, e.g. `ghcr.io/brnshkr/forge:local-cli`.
`make build` refuses image settings that differ from the stage's file.

## Build arguments

| Argument | Goes into | Extended by |
| --- | --- | --- |
| `CLI_APT_PACKAGES` | `-cli`, `-cli-chromium` | `EXTRA_APT_PACKAGES` |
| `DEV_APT_PACKAGES` | `-cli`, `-cli-chromium`, `-app-dev` | `EXTRA_APT_PACKAGES` |
| `PHP_EXTENSIONS` | every PHP image | `EXTRA_PHP_EXTENSIONS` |
| `APP_PHP_EXTENSIONS` | `-app`, `-app-dev` | `EXTRA_PHP_EXTENSIONS` |
| `DEV_PHP_EXTENSIONS` | `-cli`, `-cli-chromium`, `-app-dev` | `EXTRA_PHP_EXTENSIONS` |
| `HAS_BUN` | every PHP image | — |
| `USER_NAME`, `USER_UID`, `USER_GID` | the user owning the code, `forge` with `1000` | — |
| `RUNTIME_USER_UID`, `RUNTIME_USER_GID` | the user `-app` runs as, `33` | — |

```ini
# ./.env.local

EXTRA_PHP_EXTENSIONS=gd
```

`make build` picks it up. Without any of them, the build matches the published image.
Keep `git` in `DEV_APT_PACKAGES`. Every image needs it to build.

## Verifying an image

```sh
sh ./docker/verify.sh ghcr.io/brnshkr/forge:local-cli forge cli
```

It takes the image reference, name, and target, and prints a block per tool.
It ends with `Verified in <seconds>s.` or `Failed after <seconds>s.`. It honors `NO_COLOR` and `FORCE_COLOR`.
