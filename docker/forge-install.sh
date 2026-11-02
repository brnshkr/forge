#!/bin/sh

set -eu

AUTO_MARKS=/tmp/forge-install-auto-marks

install_extensions() {
  apt-get update
  apt-mark showauto >"$AUTO_MARKS"

  printf '%s\n' "$PHPIZE_DEPS" | xargs apt-get install -y --no-install-recommends -o Dpkg::Options::=--force-confold

  install-php-extensions "$@"

  xargs apt-mark auto <"$AUTO_MARKS"
  rm -rf "$AUTO_MARKS" /var/lib/apt/lists/*

  return 0
}

remove_build_tools() {
  apt-get purge -y --auto-remove \
    autoconf \
    binutils \
    dpkg-dev \
    g++ \
    gcc \
    libc6-dev \
    re2c

  apt-get autoremove -y --purge

  rm -rf /usr/src/php

  return 0
}

main() {
  if [ "$#" -gt 0 ]; then
    install_extensions "$@"
  fi

  remove_build_tools

  return 0
}

main "$@"
