# shellcheck shell=sh

export CHROMIUM_FLAGS="$CHROMIUM_FLAGS --disable-background-networking"
export CHROMIUM_FLAGS="$CHROMIUM_FLAGS --disable-component-update"
export CHROMIUM_FLAGS="$CHROMIUM_FLAGS --metrics-recording-only"
export CHROMIUM_FLAGS="$CHROMIUM_FLAGS --no-pings"
