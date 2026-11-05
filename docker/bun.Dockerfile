# syntax=docker/dockerfile:1
# check=skip=InvalidDefaultArgInFrom;error=true

ARG BUN_VERSION
ARG BUN_DIGEST
ARG SHELLCHECK_VERSION
ARG SHELLCHECK_CHECKSUM
ARG HADOLINT_VERSION
ARG HADOLINT_CHECKSUM
ARG ACTIONLINT_VERSION
ARG ACTIONLINT_CHECKSUM
ARG CLI_APT_PACKAGES
ARG DEV_APT_PACKAGES
ARG IMAGE_NAME
ARG IMAGE_DESCRIPTION
ARG IMAGE_VENDOR
ARG IMAGE_AUTHORS
ARG IMAGE_LICENSES
ARG IMAGE_URL
ARG IMAGE_SOURCE

ARG USER_NAME=forge
ARG USER_UID=1000
ARG USER_GID=1000
ARG RUNTIME_USER_UID=33
ARG RUNTIME_USER_GID=33
ARG EXTRA_APT_PACKAGES=""

FROM oven/bun:${BUN_VERSION}-debian@${BUN_DIGEST} AS linters

SHELL ["/bin/bash", "-euxo", "pipefail", "-c"]

ARG SHELLCHECK_VERSION
ARG SHELLCHECK_CHECKSUM
ARG HADOLINT_VERSION
ARG HADOLINT_CHECKSUM
ARG ACTIONLINT_VERSION
ARG ACTIONLINT_CHECKSUM

WORKDIR /opt/linters/download

RUN \
  --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
  <<EOF
    apt-get update

    apt-get install -y --no-install-recommends -o Dpkg::Options::=--force-confold \
      curl \
      xz-utils

    mkdir -p /opt/linters/bin

    curl -fsSL -o hadolint \
      "https://github.com/hadolint/hadolint/releases/download/v${HADOLINT_VERSION}/hadolint-Linux-x86_64"

    curl -fsSL -o actionlint.tar.gz \
      "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz"

    curl -fsSL -o shellcheck.tar.xz \
      "https://github.com/koalaman/shellcheck/releases/download/v${SHELLCHECK_VERSION}/shellcheck-v${SHELLCHECK_VERSION}.linux.x86_64.tar.xz"

    printf '%s  %s\n' \
      "${HADOLINT_CHECKSUM#sha256:}" hadolint \
      "${ACTIONLINT_CHECKSUM#sha256:}" actionlint.tar.gz \
      "${SHELLCHECK_CHECKSUM#sha256:}" shellcheck.tar.xz \
      | sha256sum --check --strict -

    install -m 0755 hadolint /opt/linters/bin/hadolint

    tar -xzf actionlint.tar.gz actionlint
    install -m 0755 actionlint /opt/linters/bin/actionlint

    tar -xJf shellcheck.tar.xz --strip-components 1 "shellcheck-v${SHELLCHECK_VERSION}/shellcheck"
    install -m 0755 shellcheck /opt/linters/bin/shellcheck
EOF

FROM oven/bun:${BUN_VERSION}-debian@${BUN_DIGEST} AS cli

SHELL ["/bin/bash", "-euxo", "pipefail", "-c"]

WORKDIR /app

ARG USER_NAME
ARG USER_UID
ARG USER_GID
ARG CLI_APT_PACKAGES
ARG DEV_APT_PACKAGES
ARG EXTRA_APT_PACKAGES

ENV \
  BUN_INSTALL_CACHE_DIR=/cache/bun \
  DO_NOT_TRACK=1 \
  HOME=/home/forge \
  PATH=/app/node_modules/.bin:$PATH \
  XDG_CACHE_HOME=/cache/xdg

COPY --link --from=linters /opt/linters/bin/ /usr/local/bin/

RUN \
  --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
  --mount=type=bind,source=./docker/toolchain.sh,target=/tmp/toolchain.sh \
  --mount=type=bind,source=./docker/user.sh,target=/tmp/user.sh \
  <<EOF
    apt-get update
    apt-get upgrade -y

    apt-get install -y --no-install-recommends -o Dpkg::Options::=--force-confold \
      ${CLI_APT_PACKAGES} \
      ${DEV_APT_PACKAGES} \
      ${EXTRA_APT_PACKAGES}

    rm -rf /usr/local/bun-node-fallback-bin

    sh /tmp/toolchain.sh configure
    sh /tmp/user.sh "${USER_NAME}" "${USER_UID}" "${USER_GID}"
EOF

ARG IMAGE_NAME
ARG IMAGE_DESCRIPTION
ARG IMAGE_VENDOR
ARG IMAGE_AUTHORS
ARG IMAGE_LICENSES
ARG IMAGE_URL
ARG IMAGE_SOURCE

# NOTICE: `hadolint` cannot parse a URL or license built from build arguments
# hadolint ignore=DL3052,DL3054
LABEL \
  org.opencontainers.image.source="${IMAGE_SOURCE}" \
  org.opencontainers.image.description="${IMAGE_DESCRIPTION}" \
  org.opencontainers.image.licenses="${IMAGE_LICENSES}" \
  org.opencontainers.image.title="${IMAGE_NAME}" \
  org.opencontainers.image.url="${IMAGE_URL}" \
  org.opencontainers.image.documentation="${IMAGE_URL}" \
  org.opencontainers.image.vendor="${IMAGE_VENDOR}" \
  org.opencontainers.image.authors="${IMAGE_AUTHORS}"

USER ${USER_UID}:${USER_GID}

CMD ["bash"]

FROM cli AS cli-chromium

ARG USER_UID
ARG USER_GID

USER 0:0

ENV \
  PANTHER_NO_SANDBOX=1 \
  PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
  PUPPETEER_SKIP_DOWNLOAD=1

RUN \
  --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
  --mount=type=bind,source=./docker/chromium.sh,target=/tmp/chromium.sh \
  sh /tmp/chromium.sh

COPY --link ./docker/chromium/forge.sh /etc/chromium.d/forge

ARG IMAGE_NAME
ARG IMAGE_DESCRIPTION

LABEL \
  org.opencontainers.image.description="${IMAGE_DESCRIPTION}" \
  org.opencontainers.image.title="${IMAGE_NAME}"

USER ${USER_UID}:${USER_GID}

# NOTICE: Title and description sit in each final stage; build arguments here would split the cache across images
# hadolint ignore=DL3049
FROM oven/bun:${BUN_VERSION}-debian@${BUN_DIGEST} AS app-base

SHELL ["/bin/bash", "-euxo", "pipefail", "-c"]

WORKDIR /app

ARG USER_NAME
ARG USER_UID
ARG USER_GID
ARG RUNTIME_USER_UID
ARG RUNTIME_USER_GID
ARG EXTRA_APT_PACKAGES

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
  --mount=type=bind,source=./docker/user.sh,target=/tmp/user.sh \
  <<EOF
    apt-get update
    apt-get upgrade -y

    if [ -n "${EXTRA_APT_PACKAGES}" ]; then
      apt-get install -y --no-install-recommends -o Dpkg::Options::=--force-confold ${EXTRA_APT_PACKAGES}
    fi

    sh /tmp/user.sh "${USER_NAME}" "${USER_UID}" "${USER_GID}"
EOF

ARG IMAGE_VENDOR
ARG IMAGE_AUTHORS
ARG IMAGE_LICENSES
ARG IMAGE_URL
ARG IMAGE_SOURCE

# NOTICE: `hadolint` cannot parse a URL or license built from build arguments
# hadolint ignore=DL3052,DL3054
LABEL \
  org.opencontainers.image.source="${IMAGE_SOURCE}" \
  org.opencontainers.image.licenses="${IMAGE_LICENSES}" \
  org.opencontainers.image.url="${IMAGE_URL}" \
  org.opencontainers.image.documentation="${IMAGE_URL}" \
  org.opencontainers.image.vendor="${IMAGE_VENDOR}" \
  org.opencontainers.image.authors="${IMAGE_AUTHORS}"

USER ${USER_UID}:${USER_GID}

FROM app-base AS app

ARG RUNTIME_USER_UID
ARG RUNTIME_USER_GID

USER 0:0

RUN install -d -o "${RUNTIME_USER_UID}" -g "${RUNTIME_USER_GID}" -m 0700 \
  /app/var /app/var/cache

ARG IMAGE_NAME
ARG IMAGE_DESCRIPTION

LABEL \
  org.opencontainers.image.description="${IMAGE_DESCRIPTION}" \
  org.opencontainers.image.title="${IMAGE_NAME}"

USER ${RUNTIME_USER_UID}:${RUNTIME_USER_GID}

CMD ["bun", "run", "start"]

FROM app-base AS app-dev

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

    apt-get install -y --no-install-recommends -o Dpkg::Options::=--force-confold ${DEV_APT_PACKAGES}

    sh /tmp/toolchain.sh configure
EOF

ARG IMAGE_NAME
ARG IMAGE_DESCRIPTION

LABEL \
  org.opencontainers.image.description="${IMAGE_DESCRIPTION}" \
  org.opencontainers.image.title="${IMAGE_NAME}"

USER ${USER_UID}:${USER_GID}
