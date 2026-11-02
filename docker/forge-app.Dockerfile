# syntax=docker/dockerfile:1
# check=skip=InvalidDefaultArgInFrom;error=true

ARG DEBIAN_SUITE
ARG PHP_MINOR
ARG PHP_EXTENSION_INSTALLER_VERSION
ARG PHP_EXTENSION_INSTALLER_DIGEST
ARG FRANKENPHP_VERSION
ARG FRANKENPHP_DIGEST
ARG COMPOSER_VERSION
ARG BUN_VERSION
ARG BUN_DIGEST

ARG USER_NAME=forge
ARG USER_UID=1000
ARG USER_GID=1000
ARG RUNTIME_USER_UID=33
ARG RUNTIME_USER_GID=33
ARG APT_PACKAGES=""
ARG EXTRA_APT_PACKAGES=""
ARG DEV_APT_PACKAGES="\
  git \
  make \
  original-awk \
  unzip"
ARG PHP_EXTENSIONS="\
  apcu \
  bcmath \
  exif \
  imagick \
  intl \
  opcache \
  pcntl \
  pdo_pgsql \
  redis \
  zip"
ARG EXTRA_PHP_EXTENSIONS=""
ARG DEV_PHP_EXTENSIONS="\
  pcov \
  xdebug"

FROM mlocati/php-extension-installer:${PHP_EXTENSION_INSTALLER_VERSION}@${PHP_EXTENSION_INSTALLER_DIGEST} AS php-extension-installer

FROM oven/bun:${BUN_VERSION}-debian@${BUN_DIGEST} AS bun

FROM dunglas/frankenphp:${FRANKENPHP_VERSION}-php${PHP_MINOR}-${DEBIAN_SUITE}@${FRANKENPHP_DIGEST} AS base

SHELL ["/bin/bash", "-euxo", "pipefail", "-c"]

WORKDIR /app

ARG USER_NAME
ARG USER_UID
ARG USER_GID
ARG RUNTIME_USER_UID
ARG RUNTIME_USER_GID
ARG APT_PACKAGES
ARG EXTRA_APT_PACKAGES
ARG PHP_EXTENSIONS
ARG EXTRA_PHP_EXTENSIONS

LABEL \
  org.opencontainers.image.source="https://github.com/brnshkr/forge" \
  org.opencontainers.image.description="Application runtime image every @brnshkr project serves from" \
  org.opencontainers.image.licenses="MIT" \
  org.opencontainers.image.title="forge-app" \
  org.opencontainers.image.url="https://github.com/brnshkr/forge" \
  org.opencontainers.image.documentation="https://github.com/brnshkr/forge#readme" \
  org.opencontainers.image.vendor="brnshkr" \
  org.opencontainers.image.authors="Patrick Rupp"

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
COPY --link --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --link --chmod=0755 ./docker/forge-install.sh /usr/local/bin/forge-install

RUN \
  --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
  <<EOF
    apt-get update
    apt-get upgrade -y

    if [ -n "${APT_PACKAGES}${EXTRA_APT_PACKAGES}" ]; then
      apt-get install -y --no-install-recommends -o Dpkg::Options::=--force-confold ${APT_PACKAGES} ${EXTRA_APT_PACKAGES}
    fi

    apt-mark showauto >/tmp/apt-auto

    install-php-extensions \
      ${PHP_EXTENSIONS} \
      ${EXTRA_PHP_EXTENSIONS}

    xargs apt-mark auto </tmp/apt-auto
    rm /tmp/apt-auto

    groupadd --gid "${USER_GID}" "${USER_NAME}"

    useradd \
      --uid "${USER_UID}" \
      --gid "${USER_GID}" \
      --no-create-home \
      --home-dir /home/forge \
      "${USER_NAME}"

    # NOTICE: Copying drops upstream's cap_net_bind_service, which no-new-privileges refuses; low ports bind without it
    cp /usr/local/bin/frankenphp /tmp/frankenphp
    mv /tmp/frankenphp /usr/local/bin/frankenphp

    mkdir -p /cache /home/forge
    chmod 1777 /cache /home/forge
    chown -R "${USER_UID}:${USER_GID}" /config /data
EOF

COPY --link ./docker/imagemagick/policy.xml /etc/ImageMagick-7/policy.xml

FROM base AS prod

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
EOF

USER ${RUNTIME_USER_UID}:${RUNTIME_USER_GID}

FROM base AS dev

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

    if [ -n "${DEV_APT_PACKAGES}" ]; then
      apt-get install -y --no-install-recommends -o Dpkg::Options::=--force-confold ${DEV_APT_PACKAGES}
    fi

    apt-mark showauto >/tmp/apt-auto

    install-php-extensions \
      @composer-${COMPOSER_VERSION} \
      ${DEV_PHP_EXTENSIONS}

    xargs apt-mark auto </tmp/apt-auto
    rm /tmp/apt-auto

    mv /usr/local/etc/php/php.ini-development /usr/local/etc/php/php.ini

    sh /tmp/toolchain.sh configure clean
EOF

USER ${USER_UID}:${USER_GID}
