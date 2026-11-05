# syntax=docker/dockerfile:1
# check=skip=InvalidDefaultArgInFrom;error=true

ARG FORGE_APP_DEV_IMAGE
ARG FORGE_APP_IMAGE

ARG USER_UID=1000
ARG USER_GID=1000
ARG RUNTIME_USER_UID=33
ARG RUNTIME_USER_GID=33
ARG FORGE_VAR_DIR=/app/var

FROM ${FORGE_APP_DEV_IMAGE} AS build

SHELL ["/bin/bash", "-euxo", "pipefail", "-c"]

WORKDIR /app

ARG USER_UID
ARG USER_GID
ARG IMAGE_INCLUDE=""
ARG IMAGE_EXCLUDE=""
ARG FORGE_VAR_DIR

USER 0:0

RUN chown "${USER_UID}:${USER_GID}" /app

USER ${USER_UID}:${USER_GID}

COPY --chown=${USER_UID}:${USER_GID} ./ ./

RUN <<'EOF'
  if [ ! -d "${FORGE_VAR_DIR}" ]; then
    exit 0
  fi

  shipped_files=$(find "${FORGE_VAR_DIR}" -mindepth 1 ! -type d ! -name .gitkeep ! -name .gitignore)

  if [ -n "${shipped_files}" ]; then
    printf '%s %s\n%s\n' \
      "\`${FORGE_VAR_DIR}\` must be empty in the image, since its volume copies files only once" \
      "and no later image could change them:" \
      "${shipped_files}" >&2
    exit 1
  fi
EOF

RUN \
  --mount=type=cache,target=/cache/composer,mode=0777 \
  --mount=type=cache,target=/cache/bun,mode=0777 \
  <<EOF
    if [ -f composer.json ]; then
      APP_ENV=prod composer install --no-interaction --no-progress
    fi

    if [ -f bun.lock ]; then
      bun install --frozen-lockfile
    fi

    if [ -f Makefile ] && make -n dist >/dev/null 2>&1; then
      make dist
    fi

    if [ -f composer.json ]; then
      APP_ENV=prod composer install --no-dev --classmap-authoritative --no-interaction --no-progress
    fi

    if [ -d vendor/symfony/flex ]; then
      composer dump-env prod
    fi

    rm -rf node_modules "${FORGE_VAR_DIR}"
EOF

RUN <<'EOF'
  is_included() {
    path=$1

    for included_path in ${IMAGE_INCLUDE}; do
      included_path=${included_path#./}
      included_path=${included_path%/}

      case $path in
        "${included_path}" | "${included_path}"/*)
          return 0
        ;;
      esac
    done

    return 1
  }

  if [ -f .forge-export-ignored ]; then
    while IFS= read -r path; do
      if ! is_included "${path}"; then
        rm -f "./${path}"
        rmdir -p --ignore-fail-on-non-empty "$(dirname "./${path}")" 2>/dev/null || true
      fi
    done <.forge-export-ignored

    rm .forge-export-ignored
  fi

  for path in ${IMAGE_EXCLUDE}; do
    rm -rf "./${path#./}"
  done
EOF

# NOTICE: The labels come from the project's manifests and repository, added by `publish.yaml`
# hadolint ignore=DL3049
FROM ${FORGE_APP_IMAGE} AS prod

SHELL ["/bin/bash", "-euxo", "pipefail", "-c"]

WORKDIR /app

ARG USER_UID
ARG USER_GID
ARG RUNTIME_USER_UID
ARG RUNTIME_USER_GID
ARG EXTRA_APT_PACKAGES=""
ARG EXTRA_PHP_EXTENSIONS=""
ARG FORGE_VAR_DIR
ARG FORGE_CACHE_DIR=/app/var/cache

USER 0:0

RUN \
  --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
  <<EOF
    if [ -n "${EXTRA_APT_PACKAGES}" ]; then
      apt-get update
      apt-get install -y --no-install-recommends -o Dpkg::Options::=--force-confold ${EXTRA_APT_PACKAGES}
    fi

    if [ -n "${EXTRA_PHP_EXTENSIONS}" ]; then
      forge-install ${EXTRA_PHP_EXTENSIONS}
    fi
EOF

COPY --from=build --chown=${USER_UID}:${USER_GID} /app ./

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

USER ${RUNTIME_USER_UID}:${RUNTIME_USER_GID}
