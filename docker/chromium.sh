#!/bin/sh

set -eu

install_chromium() {
  apt-get update

  apt-get install -y --no-install-recommends -o Dpkg::Options::=--force-confold \
    chromium \
    chromium-driver \
    fonts-liberation \
    fonts-noto-color-emoji

  return 0
}

install_chromium
