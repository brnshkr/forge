# 💻 Development

Setup and day-to-day commands for working **on** @brnshkr/forge itself.
If you only use the images, fragments, or workflows, the [README](../README.md) and the other pages are all you need.

## Setup

With Docker and Make installed, one command sets everything up:

```sh
make
```

It builds the `forge` image, installs the dependencies inside it, and installs the Git hooks.
`make help` lists every target,
and [`@brnshkr/config`'s docs](https://github.com/brnshkr/config/blob/master/docs/Makefile.md) explain the shared ones.

## Layout

| Path | Holds |
| --- | --- |
| `./bin/` | the scripts the workflows run in every repository, from Forge's own checkout |
| `./scripts/` | Forge's own tools, like `make bump-tools`, which moves the tool versions in `.env` |
| `./src/` | the logic of both, tested to full coverage |
| `./docker/verify.sh` | the check each built image passes before it is pushed |
| `./docker/app/Dockerfile` | the Dockerfile a project without its own is built with |
| `./docker/deploy.sh` | the deploy every target runs, over SSH |

## Stages

Every `.env.<stage>` file describes one image with its `IMAGE_NAME` and `IMAGE_TARGET`
(plus `IMAGE_SUFFIX` and `IMAGE_ALIASES` where needed). The pins all stages share live in `.env`.

Each image has its stages: `forge`, `forge-php`, and `forge-bun`, each also with `-chromium`, plus `forge-app`,
`forge-php-app`, and `forge-bun-app`, each with a `-dev` stage. `APP_ENV` selects the one you work on, `forge` by
default. To switch, set it in your
`.env.local` file:

```dotenv
# ./.env.local

APP_ENV=forge-chromium
```

The app aliases follow their toolchains: `forge-app-dev` uses `TOOLCHAIN_ALIASES`, `forge-php-app-dev` uses
`PHP_ALIASES`, and `forge-bun-app-dev` uses `BUN_ALIASES`.

`make build` builds the current stage's image and `make <stage>-build` another one, e.g. `make forge-chromium-build`.
Local builds are tagged `local` plus the stage's suffix, e.g. `forge:local-chromium`.  
`make build` refuses image settings that differ from the stage's file.

## Build arguments

Every default in the Dockerfiles is a build argument, so you can change an image without touching its Dockerfile:

| Argument | Replaces | Extended by |
| --- | --- | --- |
| `USER_NAME`, `USER_UID`, `USER_GID` | the unprivileged user, which owns the code | — |
| `RUNTIME_USER_UID`, `RUNTIME_USER_GID` | the app runtime user, Debian's `www-data` for PHP | — |
| `APT_PACKAGES` | the installed packages | `EXTRA_APT_PACKAGES` |
| `DEV_APT_PACKAGES` | the packages the FrankenPHP app `-dev` images install | `EXTRA_APT_PACKAGES` |
| `PHP_EXTENSIONS` | the installed PHP extensions | `EXTRA_PHP_EXTENSIONS` |
| `DEV_PHP_EXTENSIONS` | the PHP extensions PHP runtime `-dev` images install | `EXTRA_PHP_EXTENSIONS` |

```dotenv
# ./.env.local

EXTRA_PHP_EXTENSIONS=gd
```

`make build` picks it up, and without any of them the build matches the published image.  
Keep `git` in whatever list replaces the packages, since every image needs it to build.
