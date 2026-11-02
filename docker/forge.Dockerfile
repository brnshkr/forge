# syntax=docker/dockerfile:1
# check=skip=InvalidDefaultArgInFrom;error=true

ARG DEBIAN_SUITE
ARG PHP_VERSION
ARG PHP_DIGEST
ARG PHP_EXTENSION_INSTALLER_VERSION
ARG PHP_EXTENSION_INSTALLER_DIGEST
ARG COMPOSER_VERSION
ARG BUN_VERSION
ARG BUN_DIGEST
ARG SHELLCHECK_VERSION
ARG SHELLCHECK_CHECKSUM
ARG HADOLINT_VERSION
ARG HADOLINT_CHECKSUM
ARG ACTIONLINT_VERSION
ARG ACTIONLINT_CHECKSUM

ARG USER_NAME=forge
ARG USER_UID=1000
ARG USER_GID=1000
ARG APT_PACKAGES="\
  ca-certificates \
  gawk \
  git \
  graphviz \
  make \
  original-awk \
  unzip"
ARG EXTRA_APT_PACKAGES=""
ARG PHP_EXTENSIONS="\
  bcmath \
  exif \
  imagick \
  intl \
  opcache \
  pcntl \
  pcov \
  pdo_pgsql \
  redis \
  xdebug \
  zip"
ARG EXTRA_PHP_EXTENSIONS=""

FROM mlocati/php-extension-installer:${PHP_EXTENSION_INSTALLER_VERSION}@${PHP_EXTENSION_INSTALLER_DIGEST} AS php-extension-installer

FROM oven/bun:${BUN_VERSION}-debian@${BUN_DIGEST} AS bun

FROM php:${PHP_VERSION}-cli-${DEBIAN_SUITE}@${PHP_DIGEST} AS linters

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
      ca-certificates \
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

FROM php:${PHP_VERSION}-cli-${DEBIAN_SUITE}@${PHP_DIGEST} AS cli

SHELL ["/bin/bash", "-euxo", "pipefail", "-c"]

WORKDIR /app

ARG USER_NAME
ARG USER_UID
ARG USER_GID
ARG APT_PACKAGES
ARG EXTRA_APT_PACKAGES
ARG PHP_EXTENSIONS
ARG EXTRA_PHP_EXTENSIONS
ARG COMPOSER_VERSION

LABEL \
  org.opencontainers.image.source="https://github.com/brnshkr/forge" \
  org.opencontainers.image.description="PHP and Bun toolchain image @brnshkr projects build and test in" \
  org.opencontainers.image.licenses="MIT" \
  org.opencontainers.image.title="forge" \
  org.opencontainers.image.url="https://github.com/brnshkr/forge" \
  org.opencontainers.image.documentation="https://github.com/brnshkr/forge#readme" \
  org.opencontainers.image.vendor="brnshkr" \
  org.opencontainers.image.authors="Patrick Rupp"

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

COPY --link --from=bun /usr/local/bin/bun /usr/local/bin/bun

COPY --link --from=linters /opt/linters/bin/ /usr/local/bin/

RUN \
  --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
  --mount=type=bind,source=./docker/toolchain.sh,target=/tmp/toolchain.sh \
  <<EOF
    : "${COMPOSER_VERSION:?}"

    apt-get update
    apt-get upgrade -y

    if [ -n "${APT_PACKAGES}${EXTRA_APT_PACKAGES}" ]; then
      apt-get install -y --no-install-recommends -o Dpkg::Options::=--force-confold ${APT_PACKAGES} ${EXTRA_APT_PACKAGES}
    fi

    apt-mark showauto >/tmp/apt-auto

    install-php-extensions \
      @composer-${COMPOSER_VERSION} \
      ${PHP_EXTENSIONS} \
      ${EXTRA_PHP_EXTENSIONS}

    xargs apt-mark auto </tmp/apt-auto
    rm /tmp/apt-auto

    mv /usr/local/etc/php/php.ini-development /usr/local/etc/php/php.ini

    sh /tmp/toolchain.sh configure clean

    groupadd --gid "${USER_GID}" "${USER_NAME}"

    useradd \
      --uid "${USER_UID}" \
      --gid "${USER_GID}" \
      --no-create-home \
      --home-dir /home/forge \
      "${USER_NAME}"

    mkdir -p /cache /home/forge
    chmod 1777 /cache /home/forge
EOF

COPY --link ./docker/imagemagick/policy.xml /etc/ImageMagick-7/policy.xml

USER ${USER_UID}:${USER_GID}

CMD ["bash"]

FROM cli AS chromium

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
  <<EOF
    apt-get update

    apt-get install -y --no-install-recommends -o Dpkg::Options::=--force-confold \
      chromium \
      chromium-driver \
      fonts-liberation \
      fonts-noto-color-emoji
EOF

COPY --link ./docker/chromium/forge.sh /etc/chromium.d/forge

USER ${USER_UID}:${USER_GID}
