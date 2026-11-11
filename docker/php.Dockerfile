# syntax=docker/dockerfile:1
# check=skip=InvalidDefaultArgInFrom;error=true

ARG DEBIAN_SUITE
ARG PHP_MINOR
ARG PHP_VERSION
ARG PHP_DIGEST
ARG PHP_EXTENSION_INSTALLER_VERSION
ARG PHP_EXTENSION_INSTALLER_DIGEST
ARG FRANKENPHP_VERSION
ARG FRANKENPHP_DIGEST
ARG COMPOSER_VERSION
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
ARG PHP_EXTENSIONS
ARG APP_PHP_EXTENSIONS
ARG DEV_PHP_EXTENSIONS
ARG IMAGE_NAME
ARG IMAGE_DESCRIPTION
ARG IMAGE_VENDOR
ARG IMAGE_AUTHORS
ARG IMAGE_LICENSES
ARG IMAGE_URL
ARG IMAGE_SOURCE

ARG HAS_BUN=true
ARG USER_NAME=forge
ARG USER_UID=1000
ARG USER_GID=1000
ARG RUNTIME_USER_UID=33
ARG RUNTIME_USER_GID=33
ARG EXTRA_APT_PACKAGES=""
ARG EXTRA_PHP_EXTENSIONS=""

FROM mlocati/php-extension-installer:${PHP_EXTENSION_INSTALLER_VERSION}@${PHP_EXTENSION_INSTALLER_DIGEST} AS php-extension-installer

FROM oven/bun:${BUN_VERSION}-debian@${BUN_DIGEST} AS bun-image

# NOTICE: `HAS_BUN` picks one of these as the Bun source the final stages copy; neither is an image of its own
# hadolint ignore=DL3049
FROM scratch AS bun-false

# hadolint ignore=DL3049
FROM scratch AS bun-true

COPY --link --from=bun-image /usr/local/bin/bun /usr/local/bin/bun

# NOTICE: A stage chosen by `HAS_BUN`, not an image on a registry
# hadolint ignore=DL3006
FROM bun-${HAS_BUN} AS bun

FROM bun-image AS linters

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

# NOTICE: Title and description sit in each final stage; build arguments here would split the cache across images
# hadolint ignore=DL3049
FROM php:${PHP_VERSION}-cli-${DEBIAN_SUITE}@${PHP_DIGEST} AS cli-base

SHELL ["/bin/bash", "-euxo", "pipefail", "-c"]

WORKDIR /app

ARG USER_NAME
ARG USER_UID
ARG USER_GID
ARG CLI_APT_PACKAGES
ARG DEV_APT_PACKAGES
ARG EXTRA_APT_PACKAGES
ARG PHP_EXTENSIONS
ARG DEV_PHP_EXTENSIONS
ARG EXTRA_PHP_EXTENSIONS
ARG COMPOSER_VERSION
ARG APT_UPGRADE_DATE=

ENV \
  BUN_INSTALL_CACHE_DIR=/cache/bun \
  COMPOSER_ALLOW_SUPERUSER=1 \
  COMPOSER_CACHE_DIR=/cache/composer \
  COMPOSER_HOME=/tmp/composer \
  DO_NOT_TRACK=1 \
  HOME=/home/forge \
  PATH=/app/vendor/bin:/app/node_modules/.bin:$PATH \
  PHP_INI_SCAN_DIR=:/app/conf/php \
  XDG_CACHE_HOME=/cache/xdg

COPY --link ./docker/php/90-forge.ini /usr/local/etc/php/conf.d/90-forge.ini

COPY --link --from=php-extension-installer /usr/bin/install-php-extensions /usr/local/bin/install-php-extensions
COPY --link --chmod=0755 ./docker/forge-install.sh /usr/local/bin/forge-install

COPY --link --from=linters /opt/linters/bin/ /usr/local/bin/

RUN \
  --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
  --mount=type=bind,source=./docker/toolchain.sh,target=/tmp/toolchain.sh \
  --mount=type=bind,source=./docker/user.sh,target=/tmp/user.sh \
  <<EOF
    : "${COMPOSER_VERSION:?}"

    apt-get update
    apt-get upgrade -y

    apt-get install -y --no-install-recommends -o Dpkg::Options::=--force-confold \
      ${CLI_APT_PACKAGES} \
      ${DEV_APT_PACKAGES} \
      ${EXTRA_APT_PACKAGES}

    apt-mark showauto >/tmp/apt-auto

    install-php-extensions \
      @composer-${COMPOSER_VERSION} \
      ${PHP_EXTENSIONS} \
      ${DEV_PHP_EXTENSIONS} \
      ${EXTRA_PHP_EXTENSIONS}

    xargs apt-mark auto </tmp/apt-auto
    rm /tmp/apt-auto

    mv /usr/local/etc/php/php.ini-development /usr/local/etc/php/php.ini

    sh /tmp/toolchain.sh configure clean
    sh /tmp/user.sh "${USER_NAME}" "${USER_UID}" "${USER_GID}"
EOF

COPY --link ./docker/imagemagick/policy.xml /etc/ImageMagick-7/policy.xml


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

FROM cli-base AS cli

ARG USER_UID
ARG USER_GID

# NOTICE: Copies the Bun binary, or nothing where `HAS_BUN` is false
# hadolint ignore=DL3067
COPY --link --from=bun / /

ARG IMAGE_NAME
ARG IMAGE_DESCRIPTION

LABEL \
  org.opencontainers.image.description="${IMAGE_DESCRIPTION}" \
  org.opencontainers.image.title="${IMAGE_NAME}"

USER ${USER_UID}:${USER_GID}

CMD ["bash"]

FROM cli-base AS cli-chromium

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

# NOTICE: Copies the Bun binary, or nothing where `HAS_BUN` is false
# hadolint ignore=DL3067
COPY --link --from=bun / /

ARG IMAGE_NAME
ARG IMAGE_DESCRIPTION

LABEL \
  org.opencontainers.image.description="${IMAGE_DESCRIPTION}" \
  org.opencontainers.image.title="${IMAGE_NAME}"

USER ${USER_UID}:${USER_GID}

CMD ["bash"]

# NOTICE: Title and description sit in each final stage; build arguments here would split the cache across images
# hadolint ignore=DL3049
FROM dunglas/frankenphp:${FRANKENPHP_VERSION}-php${PHP_MINOR}-${DEBIAN_SUITE}@${FRANKENPHP_DIGEST} AS app-base

SHELL ["/bin/bash", "-euxo", "pipefail", "-c"]

WORKDIR /app

ARG USER_NAME
ARG USER_UID
ARG USER_GID
ARG RUNTIME_USER_UID
ARG RUNTIME_USER_GID
ARG EXTRA_APT_PACKAGES
ARG PHP_EXTENSIONS
ARG APP_PHP_EXTENSIONS
ARG EXTRA_PHP_EXTENSIONS
ARG APT_UPGRADE_DATE=

ENV \
  BUN_INSTALL_CACHE_DIR=/app/var/cache/bun \
  DO_NOT_TRACK=1 \
  FORGE_CODE_OWNER=${USER_UID}:${USER_GID} \
  FORGE_RUNTIME_USER=${RUNTIME_USER_UID}:${RUNTIME_USER_GID} \
  HOME=/home/forge \
  PATH=/app/node_modules/.bin:$PATH \
  PHP_INI_SCAN_DIR=:/app/conf/php \
  SERVER_NAME=:80 \
  XDG_CACHE_HOME=/app/var/cache/xdg \
  XDG_CONFIG_HOME=/config \
  XDG_DATA_HOME=/data

COPY --link ./docker/php/90-forge.ini /usr/local/etc/php/conf.d/90-forge.ini

COPY --link ./docker/frankenphp/Caddyfile /etc/frankenphp/Caddyfile
COPY --link ./docker/frankenphp/forge/ /etc/frankenphp/forge/
COPY --link ./docker/frankenphp/Caddyfile.d/ /etc/frankenphp/Caddyfile.d/

COPY --link --from=php-extension-installer /usr/bin/install-php-extensions /usr/local/bin/install-php-extensions
COPY --link --chmod=0755 ./docker/forge-install.sh /usr/local/bin/forge-install

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

    apt-mark showauto >/tmp/apt-auto

    install-php-extensions \
      ${PHP_EXTENSIONS} \
      ${APP_PHP_EXTENSIONS} \
      ${EXTRA_PHP_EXTENSIONS}

    xargs apt-mark auto </tmp/apt-auto
    rm /tmp/apt-auto

    sh /tmp/user.sh "${USER_NAME}" "${USER_UID}" "${USER_GID}"

    # NOTICE: Copying drops upstream's cap_net_bind_service, which no-new-privileges refuses; low ports bind without it
    cp /usr/local/bin/frankenphp /tmp/frankenphp
    mv /tmp/frankenphp /usr/local/bin/frankenphp

    chown -R "${USER_UID}:${USER_GID}" /config /data
EOF

COPY --link ./docker/imagemagick/policy.xml /etc/ImageMagick-7/policy.xml

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

FROM app-base AS app

ARG RUNTIME_USER_UID
ARG RUNTIME_USER_GID

COPY --link ./docker/php/91-forge-production.ini /usr/local/etc/php/conf.d/91-forge-production.ini

RUN \
  --mount=type=bind,source=./docker/toolchain.sh,target=/tmp/toolchain.sh \
  <<EOF
    mv /usr/local/etc/php/php.ini-production /usr/local/etc/php/php.ini
    install -d -o "${RUNTIME_USER_UID}" -g "${RUNTIME_USER_GID}" -m 0700 /app/var
    install -d -o "${RUNTIME_USER_UID}" -g "${RUNTIME_USER_GID}" -m 0700 /app/var/cache
    chown -R "${RUNTIME_USER_UID}:${RUNTIME_USER_GID}" /config /data
    chmod 0700 /config /data

    sh /tmp/toolchain.sh clean
    apt-get purge -y --auto-remove make
EOF

# NOTICE: Copies the Bun binary, or nothing where `HAS_BUN` is false
# hadolint ignore=DL3067
COPY --link --from=bun / /

ARG IMAGE_NAME
ARG IMAGE_DESCRIPTION

LABEL \
  org.opencontainers.image.description="${IMAGE_DESCRIPTION}" \
  org.opencontainers.image.title="${IMAGE_NAME}"

USER ${RUNTIME_USER_UID}:${RUNTIME_USER_GID}

FROM app-base AS app-dev

ARG USER_UID
ARG USER_GID
ARG DEV_APT_PACKAGES
ARG DEV_PHP_EXTENSIONS
ARG COMPOSER_VERSION

ENV \
  BUN_INSTALL_CACHE_DIR=/cache/bun \
  COMPOSER_ALLOW_SUPERUSER=1 \
  COMPOSER_CACHE_DIR=/cache/composer \
  COMPOSER_HOME=/tmp/composer \
  PATH=/app/vendor/bin:/app/node_modules/.bin:$PATH

COPY --link ./docker/frankenphp/forge-dev/worker.1.caddyfile /etc/frankenphp/forge/worker.1.caddyfile

COPY --link ./docker/app/Dockerfile /usr/local/share/forge/app.Dockerfile

COPY --link ./docker/deploy.sh /usr/local/share/forge/deploy.sh

RUN \
  --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
  --mount=type=bind,source=./docker/toolchain.sh,target=/tmp/toolchain.sh \
  <<EOF
    : "${COMPOSER_VERSION:?}"

    apt-get update

    apt-get install -y --no-install-recommends -o Dpkg::Options::=--force-confold ${DEV_APT_PACKAGES}

    apt-mark showauto >/tmp/apt-auto

    install-php-extensions \
      @composer-${COMPOSER_VERSION} \
      ${DEV_PHP_EXTENSIONS}

    xargs apt-mark auto </tmp/apt-auto
    rm /tmp/apt-auto

    mv /usr/local/etc/php/php.ini-development /usr/local/etc/php/php.ini

    sh /tmp/toolchain.sh configure clean
EOF

# NOTICE: Copies the Bun binary, or nothing where `HAS_BUN` is false
# hadolint ignore=DL3067
COPY --link --from=bun / /

ARG IMAGE_NAME
ARG IMAGE_DESCRIPTION

LABEL \
  org.opencontainers.image.description="${IMAGE_DESCRIPTION}" \
  org.opencontainers.image.title="${IMAGE_NAME}"

USER ${USER_UID}:${USER_GID}
