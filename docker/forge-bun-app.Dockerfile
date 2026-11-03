# syntax=docker/dockerfile:1
# check=skip=InvalidDefaultArgInFrom;error=true

ARG BUN_VERSION
ARG BUN_DIGEST

ARG USER_NAME=forge
ARG USER_UID=1000
ARG USER_GID=1000
ARG RUNTIME_USER_UID=33
ARG RUNTIME_USER_GID=33
ARG EXTRA_APT_PACKAGES=""
ARG DEV_APT_PACKAGES="\
  git \
  make \
  original-awk"

FROM oven/bun:${BUN_VERSION}-debian@${BUN_DIGEST} AS base

SHELL ["/bin/bash", "-euxo", "pipefail", "-c"]

WORKDIR /app

ARG USER_NAME
ARG USER_UID
ARG USER_GID
ARG RUNTIME_USER_UID
ARG RUNTIME_USER_GID
ARG EXTRA_APT_PACKAGES

LABEL \
  org.opencontainers.image.source="https://github.com/brnshkr/forge" \
  org.opencontainers.image.description="Bun application runtime image @brnshkr projects serve from" \
  org.opencontainers.image.licenses="MIT" \
  org.opencontainers.image.title="forge-bun-app" \
  org.opencontainers.image.url="https://github.com/brnshkr/forge" \
  org.opencontainers.image.documentation="https://github.com/brnshkr/forge#readme" \
  org.opencontainers.image.vendor="brnshkr" \
  org.opencontainers.image.authors="Patrick Rupp"

ENV \
  BUN_INSTALL_CACHE_DIR=/app/var/cache/bun \
  DO_NOT_TRACK=1 \
  FORGE_RUNTIME_USER=${RUNTIME_USER_UID}:${RUNTIME_USER_GID} \
  HOME=/home/forge \
  PATH=/app/node_modules/.bin:$PATH \
  XDG_CACHE_HOME=/app/var/cache/xdg

USER 0:0

RUN \
  --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
  <<EOF
    apt-get update
    apt-get upgrade -y

    if [ -n "${EXTRA_APT_PACKAGES}" ]; then
      apt-get install -y --no-install-recommends -o Dpkg::Options::=--force-confold ${EXTRA_APT_PACKAGES}
    fi

    userdel --remove bun

    groupadd --gid "${USER_GID}" "${USER_NAME}"

    useradd \
      --uid "${USER_UID}" \
      --gid "${USER_GID}" \
      --no-create-home \
      --home-dir /home/forge \
      "${USER_NAME}"

    install -d -o "${USER_UID}" -g "${USER_GID}" -m 1777 /home/forge
EOF

USER ${USER_UID}:${USER_GID}

FROM base AS prod

ARG RUNTIME_USER_UID
ARG RUNTIME_USER_GID

USER 0:0

RUN install -d -o "${RUNTIME_USER_UID}" -g "${RUNTIME_USER_GID}" -m 0700 \
  /app/var /app/var/cache

USER ${RUNTIME_USER_UID}:${RUNTIME_USER_GID}

CMD ["bun", "run", "start"]

FROM base AS dev

ARG USER_UID
ARG USER_GID
ARG DEV_APT_PACKAGES

ENV \
  BUN_INSTALL_CACHE_DIR=/app/.cache/bun.cache \
  XDG_CACHE_HOME=/app/.cache/xdg.cache

COPY --link ./docker/app/Dockerfile /usr/local/share/forge/app.Dockerfile
COPY --link ./docker/deploy.sh /usr/local/share/forge/deploy.sh

USER 0:0

RUN \
  --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
  --mount=type=bind,source=./docker/toolchain.sh,target=/tmp/toolchain.sh \
  <<EOF
    apt-get update

    if [ -n "${DEV_APT_PACKAGES}" ]; then
      apt-get install -y --no-install-recommends -o Dpkg::Options::=--force-confold ${DEV_APT_PACKAGES}
    fi

    sh /tmp/toolchain.sh configure
EOF

USER ${USER_UID}:${USER_GID}
