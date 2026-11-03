#!/bin/sh

HOST_PORT=8080
HTTPS_HOST_PORT=8443
RUNTIME_MAX_ATTEMPTS=15
MERCURE_JWT_KEY=verify-hot-reload-0123456789abcdef
MERCURE_ISSUER=verify-hot-reload

verify_toolchain() {
  image_reference=$1

  shift

  docker run --rm "$image_reference" bash -euo pipefail -c '
    make --version
    git --version
    dot -V
    hadolint --version
    actionlint -version
    shellcheck --version

    for command_name do
      "$command_name" --version
    done
  ' bash "$@"
}

verify_absence() {
  image_reference=$1

  shift

  for command_name do
    if docker run --rm --entrypoint sh "$image_reference" -c 'command -v "$1"' sh "$command_name" >/dev/null; then
      printf "\`%s\` ships \`%s\`.\n" "$image_reference" "$command_name" >&2

      return 1
    fi
  done

  return 0
}

verify_app_tools() {
  image_reference=$1
  image_target=$2

  if [ "$image_target" = prod ]; then
    if ! verify_absence "$image_reference" git make; then
      return 1
    fi

    return 0
  fi

  docker run --rm --entrypoint sh "$image_reference" -euc '
    git --version
    make --version
  '
}

verify_php() {
  image_reference=$1

  docker run --rm --interactive --entrypoint php "$image_reference" <<'PHP'
<?php

foreach (['bcmath', 'exif', 'imagick', 'intl', 'pcntl', 'pdo_pgsql', 'redis', 'zip'] as $extension) {
  if (!extension_loaded($extension)) {
    fwrite(STDERR, "{$extension} is not loaded\n");
    exit(1);
  }
}

foreach (['avif', 'gif', 'jpeg', 'png', 'webp'] as $format) {
  $image = new Imagick();

  $image->newImage(16, 16, 'red');
  $image->setImageFormat($format);

  $copy = new Imagick();

  $copy->readImageBlob($image->getImageBlob());

  $formatReadBack = mb_strtolower($copy->getImageFormat());

  if ($formatReadBack !== $format) {
    fwrite(STDERR, "{$format} reads back as {$formatReadBack}\n");
    exit(1);
  }

  echo $format, ' reads back as ', $formatReadBack, "\n";
}

try {
  $image->setImageFormat('pdf');
  $image->getImageBlob();

  fwrite(STDERR, "pdf is not refused\n");
  exit(1);
} catch (ImagickException) {
  echo "pdf is refused\n";
}
PHP
}

verify_chromium() {
  image_reference=$1

  docker run --rm "$image_reference" bash -euo pipefail -c '
    chromium --version
    chromedriver --version
  '

  docker run --rm --interactive --entrypoint sh "$image_reference" <<'SH'
CHROMIUM_FLAGS=''

for file in /etc/chromium.d/*; do
  if [ "$file" != /etc/chromium.d/README ]; then
    . "$file"
  fi
done

for flag in --disable-background-networking --disable-component-update --metrics-recording-only --no-pings; do
  case " $CHROMIUM_FLAGS " in
    *" $flag "*)
    ;;

    *)
      echo "\`$flag\` is missing from Chromium's flags." >&2
      exit 1
    ;;
  esac
done
SH
}

verify_app_php() {
  image_reference=$1

  docker run --rm --interactive --entrypoint php "$image_reference" <<'PHP'
<?php

if (!extension_loaded('apcu')) {
  fwrite(STDERR, "apcu is not loaded\n");
  exit(1);
}
PHP
}

verify_app_users() {
  image_reference=$1

  docker run --rm --interactive --entrypoint sh "$image_reference" <<'SH'
if [ "$(id -u):$(id -g)" != "$FORGE_RUNTIME_USER" ]; then
  echo "The app does not run as \`$FORGE_RUNTIME_USER\`." >&2
  exit 1
fi

if touch ./forge-verify 2>/dev/null; then
  echo "\`$FORGE_RUNTIME_USER\` can write the code." >&2
  exit 1
fi

if ! touch ./var/forge-verify; then
  echo "\`$FORGE_RUNTIME_USER\` cannot write \`./var\`." >&2
  exit 1
fi

world_writable_directory=$(find . -type d -perm -0002 | head -n 1)

if [ -n "$world_writable_directory" ]; then
  echo "\`$world_writable_directory\` is world-writable." >&2
  exit 1
fi
SH
}

start_runtime() {
  container_name=$1
  image_reference=$2
  published_port=$3
  server_name=$4

  shift 4

  image_user=$(docker image inspect --format '{{.Config.User}}' "$image_reference")
  tmpfs_owner="uid=${image_user%%:*},gid=${image_user##*:}"

  docker run \
    --rm \
    --detach \
    --name "$container_name" \
    --publish "$published_port" \
    --env "SERVER_NAME=$server_name" \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --read-only \
    --tmpfs "/config:$tmpfs_owner" \
    --tmpfs "/data:$tmpfs_owner" \
    --tmpfs /run \
    --tmpfs /tmp \
    "$@" \
    "$image_reference" >/dev/null
}

verify_runtime() {
  image_reference=$1
  container_name=verify-runtime-$$
  attempt=0
  is_answering=''

  if ! start_runtime "$container_name" "$image_reference" "127.0.0.1:$HOST_PORT:80" :80; then
    return 1
  fi

  while [ "$attempt" -lt "$RUNTIME_MAX_ATTEMPTS" ]; do
    if curl --silent --fail "http://127.0.0.1:$HOST_PORT/" >/dev/null; then
      is_answering=1

      break
    fi

    attempt=$((attempt + 1))

    sleep 1
  done

  docker exec "$container_name" frankenphp version
  docker rm --force "$container_name" >/dev/null

  if [ -z "$is_answering" ]; then
    printf "\`%s\` does not answer on port \`%s\`.\n" "$image_reference" "$HOST_PORT" >&2

    return 1
  fi

  return 0
}

verify_hot_reload() {
  image_reference=$1
  container_name=verify-hot-reload-$$
  attempt=0
  subscription_status=''

  if ! start_runtime "$container_name" "$image_reference" "127.0.0.1:$HOST_PORT:80" :80 \
    --env FORGE_MERCURE=1 \
    --env FORGE_HOT_RELOAD=1 \
    --env "MERCURE_TRUSTED_ISSUERS=$MERCURE_ISSUER" \
    --env "MERCURE_PUBLISHER_JWT_KEY=$MERCURE_JWT_KEY" \
    --env "MERCURE_SUBSCRIBER_JWT_KEY=$MERCURE_JWT_KEY"; then
    return 1
  fi

  while [ "$attempt" -lt "$RUNTIME_MAX_ATTEMPTS" ]; do
    subscription_status=$(docker exec "$container_name" curl \
      --silent \
      --max-time 1 \
      --output /dev/null \
      --write-out '%{http_code}' \
      'http://localhost/.well-known/mercure?match=forge%2Fhot-reload')

    if [ "$subscription_status" = 200 ]; then
      break
    fi

    attempt=$((attempt + 1))

    sleep 1
  done

  docker rm --force "$container_name" >/dev/null

  if [ "$subscription_status" != 200 ]; then
    printf "\`%s\` refuses the hot reload subscription with \`%s\`.\n" "$image_reference" "$subscription_status" >&2

    return 1
  fi

  return 0
}

fetch_response_headers() {
  container_name=$1
  protocol_flag=$2

  docker exec "$container_name" curl \
    --silent \
    --fail \
    --insecure \
    "$protocol_flag" \
    --dump-header - \
    --output /dev/null \
    https://localhost/
}

verify_response_headers() {
  image_reference=$1
  response_headers=$2
  protocol=$3

  if ! printf '%s\n' "$response_headers" | grep -q "^$protocol "; then
    printf "\`%s\` does not answer over %s.\n" "$image_reference" "$protocol" >&2

    return 1
  fi

  for header_name in Content-Security-Policy Permissions-Policy; do
    if ! printf '%s\n' "$response_headers" | grep -qi "^$header_name:"; then
      printf "\`%s\` sends no \`%s\` over %s.\n" "$image_reference" "$header_name" "$protocol" >&2

      return 1
    fi
  done

  return 0
}

verify_security_headers() {
  image_reference=$1
  container_name=verify-headers-$$
  attempt=0
  http2_headers=''
  http3_headers=''

  if ! start_runtime "$container_name" "$image_reference" "127.0.0.1:$HTTPS_HOST_PORT:443" localhost; then
    return 1
  fi

  while [ "$attempt" -lt "$RUNTIME_MAX_ATTEMPTS" ]; do
    if http2_headers=$(fetch_response_headers "$container_name" --http2); then
      break
    fi

    attempt=$((attempt + 1))

    sleep 1
  done

  http3_headers=$(fetch_response_headers "$container_name" --http3-only)

  docker rm --force "$container_name" >/dev/null

  if ! verify_response_headers "$image_reference" "$http2_headers" HTTP/2; then
    return 1
  fi

  if ! printf '%s\n' "$http2_headers" | grep -qi '^Alt-Svc:.*h3='; then
    printf "\`%s\` does not advertise HTTP/3.\n" "$image_reference" >&2

    return 1
  fi

  if ! verify_response_headers "$image_reference" "$http3_headers" HTTP/3; then
    return 1
  fi

  return 0
}

verify_cli() {
  image_reference=$1
  image_name=$2

  case "$image_name" in
    forge)
      if ! verify_php "$image_reference" || ! verify_toolchain "$image_reference" php composer bun; then
        return 1
      fi
    ;;

    forge-php)
      if ! verify_php "$image_reference" || ! verify_toolchain "$image_reference" php composer; then
        return 1
      fi

      if ! verify_absence "$image_reference" bun; then
        return 1
      fi
    ;;

    forge-bun)
      if ! verify_toolchain "$image_reference" bun || ! verify_absence "$image_reference" php composer; then
        return 1
      fi
    ;;
  esac

  return 0
}

verify_app() {
  image_reference=$1
  image_target=$2

  if ! verify_php "$image_reference" || ! verify_app_php "$image_reference"; then
    return 1
  fi

  if [ "$image_target" = prod ] && ! verify_app_users "$image_reference"; then
    return 1
  fi

  if ! verify_app_tools "$image_reference" "$image_target"; then
    return 1
  fi

  if [ "$image_target" = dev ]; then
    if ! docker run --rm --entrypoint test "$image_reference" -f /usr/local/share/forge/app.Dockerfile; then
      printf "\`%s\` has no generic app Dockerfile.\n" "$image_reference" >&2

      return 1
    fi

    if ! docker run --rm --entrypoint test "$image_reference" -x /usr/local/share/forge/deploy.sh; then
      printf "\`%s\` has no executable deploy script.\n" "$image_reference" >&2

      return 1
    fi
  fi

  if ! verify_runtime "$image_reference" || ! verify_security_headers "$image_reference"; then
    return 1
  fi

  if [ "$image_target" = dev ] && ! verify_hot_reload "$image_reference"; then
    return 1
  fi

  return 0
}

verify_bun_app() {
  image_reference=$1
  image_target=$2
  container_name=verify-bun-app-$$
  attempt=0
  is_answering=''

  if ! verify_absence "$image_reference" php composer; then
    return 1
  fi

  docker run --rm "$image_reference" bun --version

  if [ "$image_target" = prod ] && ! verify_app_users "$image_reference"; then
    return 1
  fi

  if ! verify_app_tools "$image_reference" "$image_target"; then
    return 1
  fi

  if [ "$image_target" = dev ]; then
    if ! docker run --rm --entrypoint test "$image_reference" -f /usr/local/share/forge/app.Dockerfile; then
      printf "\`%s\` has no generic app Dockerfile.\n" "$image_reference" >&2

      return 1
    fi

    if ! docker run --rm --entrypoint test "$image_reference" -x /usr/local/share/forge/deploy.sh; then
      printf "\`%s\` has no executable deploy script.\n" "$image_reference" >&2

      return 1
    fi
  fi

  if ! docker run \
    --rm \
    --detach \
    --name "$container_name" \
    --publish "127.0.0.1:$HOST_PORT:80" \
    --sysctl net.ipv4.ip_unprivileged_port_start=0 \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --read-only \
    --tmpfs /tmp \
    --entrypoint bun \
    "$image_reference" \
    -e 'Bun.serve({ hostname: "0.0.0.0", port: 80, fetch: () => new Response("OK") })' >/dev/null; then
    return 1
  fi

  while [ "$attempt" -lt "$RUNTIME_MAX_ATTEMPTS" ]; do
    if curl --silent --fail "http://127.0.0.1:$HOST_PORT/" >/dev/null; then
      is_answering=1

      break
    fi

    attempt=$((attempt + 1))

    sleep 1
  done

  docker exec "$container_name" bun --version
  docker rm --force "$container_name" >/dev/null

  if [ -z "$is_answering" ]; then
    printf "\`%s\` does not answer on port \`%s\`.\n" "$image_reference" "$HOST_PORT" >&2

    return 1
  fi

  return 0
}

main() {
  image_reference=$1
  image_name=$2
  image_target=$3

  case "$image_name" in
    forge | forge-php | forge-bun)
      if ! verify_cli "$image_reference" "$image_name"; then
        return 1
      fi

      if [ "$image_target" = chromium ] && ! verify_chromium "$image_reference"; then
        return 1
      fi
    ;;

    forge-php-app)
      if ! verify_app "$image_reference" "$image_target"; then
        return 1
      fi

      if ! verify_absence "$image_reference" bun; then
        return 1
      fi
    ;;

    forge-app)
      if ! verify_app "$image_reference" "$image_target"; then
        return 1
      fi

      docker run --rm "$image_reference" bun --version
    ;;

    forge-bun-app)
      if ! verify_bun_app "$image_reference" "$image_target"; then
        return 1
      fi
    ;;

    *)
      printf "Unknown image \`%s\`.\n" "$image_name" >&2

      return 1
    ;;
  esac

  return 0
}

main "$@"
