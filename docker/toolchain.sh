#!/bin/sh

set -eu

XDEBUG_SETTINGS=/usr/local/etc/php/conf.d/99-xdebug.ini

configure_toolchain() {
  if command -v php >/dev/null 2>&1; then
    printf '%s\n' \
      'xdebug.mode=off' \
      'xdebug.start_with_request=trigger' \
      'xdebug.client_host=host.docker.internal' \
      'xdebug.client_port=9003' \
      'xdebug.discover_client_host=false' \
      >"$XDEBUG_SETTINGS"

    mkdir -p /app/vendor
    chmod 1777 /app/vendor
  fi

  if command -v bun >/dev/null 2>&1; then
    ln -sfn /usr/local/bin/bun /usr/local/bin/bunx

    mkdir -p /app/node_modules
    chmod 1777 /app/node_modules
  fi

  if command -v original-awk >/dev/null 2>&1; then
    update-alternatives --set awk /usr/bin/original-awk
  fi

  git config --system --add safe.directory /app

  return 0
}

main() {
  for step in "$@"; do
    case "$step" in
      configure)
        configure_toolchain
      ;;

      clean)
        forge-install
      ;;

      *)
        printf "Unknown step \`%s\`.\n" "$step" >&2

        return 1
      ;;
    esac
  done

  return 0
}

main "$@"
