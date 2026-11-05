#!/bin/sh

set -eu

DEFAULT_KEEP_RELEASES=5
DEFAULT_WAIT_TIMEOUT=300
DEFAULT_REGISTRY=ghcr.io
DEFAULT_SHARED_PATH=/srv/forge-shared
DEFAULT_VAR_DIRECTORY=/app/var
SHARED_PROJECT=forge-shared
HOOKS_DIRECTORY=./conf/deploy
HOOKS='before-migrate after-migrate before-switch after-switch after-rollback after-restore before-remove on-failure'
RUN_DIRECTORY=/run/forge
UNUSED_IMAGE=forge.invalid/unused

fail() {
  message=$1

  printf '%s\n' "$message" >&2

  exit 1
}

announce() {
  host_entry=$1
  announced_step=$2

  printf '%s: %s\n' "$host_entry" "$announced_step"

  return 0
}

get_value() {
  values_file=$1
  key=$2
  value=''

  while IFS= read -r line; do
    case $line in
      "$key="*)
        value=${line#*=}
      ;;
    esac
  done <"$values_file"

  printf '%s' "$value"

  return 0
}

is_value_set() {
  values_file=$1
  key=$2

  while IFS= read -r line; do
    case $line in
      "$key="*)
        return 0
      ;;
    esac
  done <"$values_file"

  return 1
}

is_listed() {
  word=$1
  word_list=$2

  case " $word_list " in
    *" $word "*)
      return 0
    ;;
  esac

  return 1
}

quote_shell_word() {
  unquoted_word=$1

  printf "'%s'" "$(printf '%s' "$unquoted_word" | sed "s/'/'\\\\''/g")"

  return 0
}

quote_shell_words() {
  quoted_words=''

  for unquoted_word do
    quoted_words="$quoted_words $(quote_shell_word "$unquoted_word")"
  done

  printf '%s' "${quoted_words# }"

  return 0
}

layer_stage() {
  stage=$1
  values_file=$WORK_DIRECTORY/$stage.env

  set --

  for env_file in "$DOTENV_BASE" "$DOTENV_BASE.$stage" "$DOTENV_BASE.$stage.local" "${DEPLOY_DOTENV_FILE:-}"; do
    if [ -f "$env_file" ]; then
      set -- "$@" --env-file "$env_file"
    fi
  done

  docker compose "$@" --file "$WORK_DIRECTORY/empty.yaml" config --environment >"$values_file"

  printf '%s' "$values_file"

  return 0
}

check_path() {
  name=$1
  path=$2
  example_path=$3

  case $path in
    /*[!A-Za-z0-9._/-]* | '' | [!/]*)
      fail "Set \`$name\` to an absolute path of letters, digits, \`.\`, \`_\`, \`-\`, and \`/\`, e.g. \`$example_path\`."
    ;;

    / | *//* | */ | */./* | */. | */../* | */..)
      fail "\`$name\` holds an empty, \`.\`, or \`..\` segment."
    ;;
  esac

  return 0
}

check_names() {
  name=$1
  names=$2

  for checked_name in $names; do
    case $checked_name in
      *[!A-Za-z0-9_]*)
        fail "\`$name\` holds \`$checked_name\`; use letters, digits, and \`_\`."
      ;;
    esac
  done

  return 0
}

check_stage_name() {
  stage=$1

  case $stage in
    '' | .* | *[!A-Za-z0-9._-]*)
      fail "\`$stage\` does not name a stage, which takes only letters, digits, \`.\`, \`_\`, and \`-\`, and never starts with \`.\`."
    ;;
  esac

  return 0
}

check_target() {
  target=$1

  case $target in
    '' | [!a-z0-9]* | *[!a-z0-9_-]*)
      fail "\`$target\` is no deploy target, which takes only lowercase letters, digits, \`_\`, and \`-\`."
    ;;
  esac

  return 0
}

check_flags() {
  for flag_name do
    flag=$(get_value "$TARGET_VALUES_FILE" "$flag_name")

    case $flag in
      '' | 0 | 1)
      ;;

      *)
        fail "\`$flag_name\` holds \`$flag\`; use \`0\` or \`1\`."
      ;;
    esac
  done

  return 0
}

check_site_addresses() {
  name=$1
  site_addresses=$2

  case $site_addresses in
    *[!A-Za-z0-9.*:/,[\]\ -]*)
      fail "\`$name\` holds an invalid site address."
    ;;
  esac

  return 0
}

is_host_valid() {
  host_entry=$1

  read_host "$host_entry"

  case $HOST_USER in
    -* | *[!A-Za-z0-9._-]*)
      return 1
    ;;
  esac

  case $HOST_PORT in
    '')
    ;;

    0* | *[!0-9]*)
      return 1
    ;;

    *)
      if [ "$HOST_PORT" -gt 65535 ]; then
        return 1
      fi
    ;;
  esac

  case $HOST_NAME in
    *:*)
      if [ -z "$IS_BRACKETED_HOST" ]; then
        return 1
      fi
    ;;
  esac

  case $HOST_NAME in
    '' | -* | *[!A-Za-z0-9.:-]*)
      return 1
    ;;
  esac

  return 0
}

read_connection_settings() {
  target=$1
  is_lenient=$2

  if [ ! -f "$DOTENV_BASE.$target" ] && [ -z "$is_lenient" ]; then
    fail "\`$DOTENV_BASE.$target\` does not exist, so \`$target\` is not a target."
  fi

  printf 'services: {}\n' >"$WORK_DIRECTORY/empty.yaml"

  if ! TARGET_VALUES_FILE=$(layer_stage "$target"); then
    if [ -z "$is_lenient" ]; then
      exit 1
    fi

    TARGET_VALUES_FILE=$WORK_DIRECTORY/environment.env
    env >"$TARGET_VALUES_FILE"
  fi

  DEPLOY_HOSTS=$(get_value "$TARGET_VALUES_FILE" DEPLOY_HOSTS)
  DEPLOY_PATH=$(get_value "$TARGET_VALUES_FILE" DEPLOY_PATH)
  DEPLOY_USER=$(get_value "$TARGET_VALUES_FILE" DEPLOY_USER)
  DEPLOY_PORT=$(get_value "$TARGET_VALUES_FILE" DEPLOY_PORT)

  if [ -z "$DEPLOY_HOSTS" ]; then
    fail "Set \`DEPLOY_HOSTS\` in \`$DOTENV_BASE.$target\` to the hosts to deploy to, e.g. \`deploy@203.0.113.10\`."
  fi

  for host_entry in $DEPLOY_HOSTS; do
    if ! is_host_valid "$host_entry"; then
      fail "\`$host_entry\` in \`DEPLOY_HOSTS\` is invalid."
    fi
  done

  check_path DEPLOY_PATH "$DEPLOY_PATH" /srv/acme-shop

  return 0
}

read_settings() {
  target=$1

  for dotenv_kind in deploy mercure mailpit; do
    dotenv_file=$(get_dotenv_file "$dotenv_kind")

    if [ -n "$dotenv_file" ] && [ ! -f "$dotenv_file" ]; then
      fail "\`$dotenv_file\` does not exist."
    fi
  done

  DEPLOY_SHARED_PATH=$(get_value "$TARGET_VALUES_FILE" DEPLOY_SHARED_PATH)
  DEPLOY_SHARED_PATH=${DEPLOY_SHARED_PATH:-$DEFAULT_SHARED_PATH}
  KEEP_RELEASES=$(get_value "$TARGET_VALUES_FILE" DEPLOY_KEEP_RELEASES)
  KEEP_RELEASES=${KEEP_RELEASES:-$DEFAULT_KEEP_RELEASES}
  WAIT_TIMEOUT=$(get_value "$TARGET_VALUES_FILE" DEPLOY_WAIT_TIMEOUT)
  WAIT_TIMEOUT=${WAIT_TIMEOUT:-$DEFAULT_WAIT_TIMEOUT}
  VAR_DIRECTORY=$(get_value "$TARGET_VALUES_FILE" FORGE_VAR_DIR)
  VAR_DIRECTORY=${VAR_DIRECTORY:-$DEFAULT_VAR_DIRECTORY}
  project_base=$(get_value "$TARGET_VALUES_FILE" COMPOSE_PROJECT_NAME)

  check_path DEPLOY_SHARED_PATH "$DEPLOY_SHARED_PATH" "$DEFAULT_SHARED_PATH"
  check_path FORGE_VAR_DIR "$VAR_DIRECTORY" "$DEFAULT_VAR_DIRECTORY"

  case $DEPLOY_SHARED_PATH/:$DEPLOY_PATH/ in
    "$DEPLOY_PATH"/*:* | *:"$DEPLOY_SHARED_PATH"/*)
      fail "\`DEPLOY_PATH\` and \`DEPLOY_SHARED_PATH\` overlap."
    ;;
  esac

  check_names DEPLOY_DOCTRINE_CONNECTIONS "$(get_value "$TARGET_VALUES_FILE" DEPLOY_DOCTRINE_CONNECTIONS)"
  check_names DEPLOY_DOCTRINE_ENTITY_MANAGERS "$(get_value "$TARGET_VALUES_FILE" DEPLOY_DOCTRINE_ENTITY_MANAGERS)"
  check_names POSTGRES_DB "$(get_value "$TARGET_VALUES_FILE" POSTGRES_DB)"
  check_names POSTGRES_EXTRA_DATABASES "$(get_value "$TARGET_VALUES_FILE" POSTGRES_EXTRA_DATABASES)"
  check_site_addresses SERVER_NAME "$(get_value "$TARGET_VALUES_FILE" SERVER_NAME)"
  check_site_addresses MAILPIT_SERVER_NAME "$(get_value "$TARGET_VALUES_FILE" MAILPIT_SERVER_NAME)"
  check_flags VALKEY_REQUIRE_ACL DEPLOY_ROLLBACK_RESTORE DEPLOY_REMOVE_DATA FORGE_HOT_RELOAD

  image_stage=$(get_value "$TARGET_VALUES_FILE" DEPLOY_IMAGE)

  if [ -n "$image_stage" ]; then
    check_stage_name "$image_stage"
  fi

  case $KEEP_RELEASES in
    *[!0-9]* | '' | 0*)
      fail "Set \`DEPLOY_KEEP_RELEASES\` to a number of releases above zero, e.g. \`5\`."
    ;;
  esac

  case $WAIT_TIMEOUT in
    *[!0-9]* | '' | 0*)
      fail "Set \`DEPLOY_WAIT_TIMEOUT\` to the seconds a release may take to become healthy, e.g. \`300\`."
    ;;
  esac

  case $project_base in
    *[!a-z0-9_-]* | '')
      fail "Set \`COMPOSE_PROJECT_NAME\` to the project's name in lowercase, e.g. \`acme-shop\`."
    ;;
  esac

  PROJECT_NAME=$project_base

  if [ "$target" != production ]; then
    PROJECT_NAME=$project_base-$target
  fi

  return 0
}

read_host() {
  host_entry=$1
  HOST_USER=$DEPLOY_USER
  HOST_PORT=$DEPLOY_PORT
  HOST_NAME=$host_entry
  IS_BRACKETED_HOST=''

  case $HOST_NAME in
    *@*)
      HOST_USER=${HOST_NAME%%@*}
      HOST_NAME=${HOST_NAME#*@}
    ;;
  esac

  case $HOST_NAME in
    \[*\]:*)
      HOST_PORT=${HOST_NAME##*\]:}
      HOST_NAME=${HOST_NAME%\]:*}
      HOST_NAME=${HOST_NAME#\[}
      IS_BRACKETED_HOST=1
    ;;

    \[*\])
      HOST_NAME=${HOST_NAME#\[}
      HOST_NAME=${HOST_NAME%\]}
      IS_BRACKETED_HOST=1
    ;;

    *:*:*)
    ;;

    *:*)
      HOST_PORT=${HOST_NAME##*:}
      HOST_NAME=${HOST_NAME%:*}
    ;;
  esac

  return 0
}

run_remote() {
  host_entry=$1
  remote_command=$2

  read_host "$host_entry"

  set -- -o ControlMaster=auto -o "ControlPath=$WORK_DIRECTORY/%C" -o ControlPersist=60

  if [ -n "$HOST_USER" ]; then
    set -- "$@" -l "$HOST_USER"
  fi

  if [ -n "$HOST_PORT" ]; then
    set -- "$@" -p "$HOST_PORT"
  fi

  set -- "$@" -- "$HOST_NAME" "$remote_command"

  ssh "$@"
}

run_remote_script() {
  host_entry=$1

  shift

  run_remote "$host_entry" "sh -s -- $(quote_shell_words "$@")"
}

close_connection() {
  host_entry=$1

  read_host "$host_entry"

  set -- -o "ControlPath=$WORK_DIRECTORY/%C" -O exit

  if [ -n "$HOST_USER" ]; then
    set -- "$@" -l "$HOST_USER"
  fi

  if [ -n "$HOST_PORT" ]; then
    set -- "$@" -p "$HOST_PORT"
  fi

  ssh "$@" -- "$HOST_NAME" 2>/dev/null || true

  return 0
}

on_every_host() {
  step=$1
  CURRENT_STEP=$step

  shift

  if [ "$step" = run_hook ]; then
    CURRENT_STEP=$2
  fi

  for host_entry in $DEPLOY_HOSTS; do
    "$step" "$host_entry" "$@"
  done

  return 0
}

compose_release() {
  host_entry=$1
  composed_release=$2

  shift 2

  run_remote "$host_entry" "cd $(quote_shell_word "$DEPLOY_PATH/releases/$composed_release") \
    && docker compose --file compose.yaml $(quote_shell_words "$@")"
}

compose_shared() {
  host_entry=$1
  shared_service=$2

  shift 2

  run_remote "$host_entry" "cd $(quote_shell_word "$DEPLOY_SHARED_PATH/$shared_service") \
    && docker compose --file compose.yaml $(quote_shell_words "$@")"
}

get_actor() {
  if [ -n "${GITHUB_RUN_ID:-}" ]; then
    printf '%s/%s/actions/runs/%s' "$GITHUB_SERVER_URL" "$GITHUB_REPOSITORY" "$GITHUB_RUN_ID"
  else
    printf 'a local deploy'
  fi

  return 0
}

get_stamp() {
  printf '%s,%s' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(get_actor)"

  return 0
}

lock() {
  host_entry=$1

  announce "$host_entry" lock

  lock_status=0

  lock_output=$(run_remote_script "$host_entry" "$DEPLOY_PATH" "$LOCK_STAMP" <<'SH'
set -eu

deploy_path=$1
lock_stamp=$2

mkdir -p "$deploy_path/releases"
mkdir -p -m 0700 "$deploy_path/shared"

if ! mkdir "$deploy_path/forge.lock" 2>/dev/null; then
  cat "$deploy_path/forge.lock/owner" 2>/dev/null || printf 'unknown,unknown\n'

  exit 3
fi

printf '%s\n' "$lock_stamp" >"$deploy_path/forge.lock/owner"
SH
  ) || lock_status=$?

  if [ "$lock_status" -eq 3 ]; then
    lock_owner=${lock_output#*,}

    fail "\`$host_entry\` is locked by \`${lock_owner%,*}\` since \`${lock_output%%,*}\`. Once that run is gone, run \`make $TARGET-deploy-unlock\` or the workflow's \`unlock\` action."
  fi

  if [ "$lock_status" -ne 0 ]; then
    exit "$lock_status"
  fi

  LOCKING_HOSTS="$LOCKING_HOSTS $host_entry"

  return 0
}

release_lock() {
  host_entry=$1

  announce "$host_entry" unlock
  run_remote_script "$host_entry" "$DEPLOY_PATH" "$LOCK_STAMP" <<'SH'
set -eu

deploy_path=$1
lock_stamp=$2

if [ "$(cat "$deploy_path/forge.lock/owner" 2>/dev/null)" = "$lock_stamp" ]; then
  rm -rf "$deploy_path/forge.lock"
fi
SH

  return 0
}

unlock() {
  host_entry=$1

  announce "$host_entry" unlock
  run_remote "$host_entry" "rm -rf $(quote_shell_word "$DEPLOY_PATH/forge.lock")"

  return 0
}

restore_ports() {
  for freed_port in $FREED_PORTS; do
    freed_host=${freed_port%%=*}
    freed_release=${freed_port#*=}

    if [ "$(get_current_release "$freed_host")" != "$freed_release" ]; then
      continue
    fi

    announce "$freed_host" "restore $APPLICATION_SERVICE of $freed_release on its ports"

    if is_listed "$freed_host" "$CREATED_PROXIES"; then
      compose_shared "$freed_host" proxy down || true
    fi

    compose_release "$freed_host" "$freed_release" up --detach --no-deps "$APPLICATION_SERVICE" || true
  done

  return 0
}

undo_roll_out() {
  host_entry=$1
  release_name=$2

  announce "$host_entry" "remove $APPLICATION_SERVICE of $release_name"

  run_remote_script "$host_entry" "$DEPLOY_PATH" "$release_name" "$APPLICATION_SERVICE" <<'SH'
set -eu

deploy_path=$1
release=$2
service=$3
old_containers=$(cat "$deploy_path/forge.old" 2>/dev/null || true)

cd "$deploy_path/releases/$release"

containers=$(docker compose --file compose.yaml ps --all --quiet "$service")

for container in $containers; do
  case " $(printf '%s ' $old_containers)" in
    *" $container "*)
    ;;

    *)
      docker rm --force "$container" >/dev/null
    ;;
  esac
done

rm -f "$deploy_path/forge.old"
SH
}

undo_started_applications() {
  for started_entry in $STARTED_APPLICATIONS; do
    started_host=${started_entry%%=*}
    started_releases=${started_entry#*=}
    started_release=${started_releases%%=*}
    previous_release=${started_releases#*=}

    if [ "$(get_current_release "$started_host")" = "$started_release" ]; then
      if [ -z "$IS_SWITCHING" ]; then
        continue
      fi

      switch_back "$started_host" "$started_release" "$previous_release" || true
    fi

    if [ -n "$HAS_PROXY" ]; then
      undo_roll_out "$started_host" "$started_release" || true

      if [ -n "$previous_release" ]; then
        announce "$started_host" "restore $APPLICATION_SERVICE of $previous_release"
        compose_release "$started_host" "$previous_release" up --detach --no-deps "$APPLICATION_SERVICE" || true
      fi
    elif [ -n "$previous_release" ] && ! is_listed "$started_host=$previous_release" "$FREED_PORTS"; then
      announce "$started_host" "restore $APPLICATION_SERVICE of $previous_release"
      compose_release "$started_host" "$previous_release" up --detach --no-deps "$APPLICATION_SERVICE" || true
    fi

    if [ -n "$previous_release" ] && is_listed "$started_host" "$REST_STARTED_HOSTS"; then
      restore_rest "$started_host" "$previous_release" || true
    fi
  done

  return 0
}

restore_rest() {
  host_entry=$1
  previous_release=$2
  previous_file=$WORK_DIRECTORY/previous.yaml

  run_remote "$host_entry" "cat $(quote_shell_word "$DEPLOY_PATH/releases/$previous_release/compose.yaml")" >"$previous_file"

  set --

  for service in $(list_services "$previous_file"); do
    if [ "$service" != "$APPLICATION_SERVICE" ]; then
      set -- "$@" "$service"
    fi
  done

  announce "$host_entry" "restore the rest of $previous_release"
  compose_release "$host_entry" "$previous_release" up --detach --no-deps --remove-orphans "$@"
}

run_failure_hooks() {
  for uploaded_host in $UPLOADED_HOSTS; do
    if is_listed "$uploaded_host" "$PULLED_HOSTS"; then
      run_hook "$uploaded_host" "$UPLOADED_RELEASE" on-failure \
        --env "FORGE_FAILED_STEP=$CURRENT_STEP" --env "FORGE_RELEASE=$UPLOADED_RELEASE" || true
    elif [ -f "$WORK_DIRECTORY/release/hooks/on-failure.sh" ]; then
      announce "$uploaded_host" "skip on-failure.sh, since $UPLOADED_RELEASE was never pulled"
    fi
  done

  return 0
}

release_locks() {
  exit_status=$1

  if [ "$exit_status" -ne 0 ]; then
    undo_started_applications
    restore_ports

    for uploaded_host in $UPLOADED_HOSTS; do
      if [ "$(get_current_release "$uploaded_host")" != "$UPLOADED_RELEASE" ]; then
        mark_bad "$uploaded_host" "$UPLOADED_RELEASE" || true
      fi
    done

    run_failure_hooks
  fi

  for locking_host in $LOCKING_HOSTS; do
    release_lock "$locking_host" || true
  done

  for host_entry in ${DEPLOY_HOSTS:-}; do
    close_connection "$host_entry"
  done

  rm -rf "${WORK_DIRECTORY:?}"

  return 0
}

get_origin_owner() {
  origin_url=$(git remote get-url origin)
  origin_path=${origin_url%.git}
  origin_path=${origin_path%/*}
  origin_owner=${origin_path##*/}

  printf '%s' "${origin_owner##*:}" | tr '[:upper:]' '[:lower:]'

  return 0
}

resolve_image() {
  target=$1
  version=$2
  image_repository=$(get_value "$TARGET_VALUES_FILE" DEPLOY_IMAGE_REPOSITORY)

  if [ -z "$image_repository" ]; then
    image_stage=$(get_value "$TARGET_VALUES_FILE" DEPLOY_IMAGE)
    image_values_file=$(layer_stage "${image_stage:-$target}")
    image_name=$(get_value "$image_values_file" IMAGE_NAME)

    if [ -z "$image_name" ]; then
      fail "\`$DOTENV_BASE.${image_stage:-$target}\` sets no \`IMAGE_NAME\`, so it builds no image to deploy."
    fi

    runtime_image=$(get_value "$image_values_file" FORGE_APP_IMAGE)

    case ${runtime_image%%@*} in
      *-app-dev)
        fail "\`FORGE_APP_IMAGE\` is an \`-app-dev\` image, which ships development tools; use the matching \`-app\` image instead."
      ;;
    esac

    image_registry=$(get_value "$TARGET_VALUES_FILE" DEPLOY_REGISTRY)
    image_namespace=$(get_value "$TARGET_VALUES_FILE" DEPLOY_NAMESPACE)
    image_repository=${image_registry:-$DEFAULT_REGISTRY}/${image_namespace:-$(get_origin_owner)}/$image_name
  fi

  image_digest=${DEPLOY_DIGEST:-}

  if [ -z "$image_digest" ]; then
    image_digest=$(docker buildx imagetools inspect "$image_repository:$version" --format '{{.Manifest.Digest}}')
  fi

  printf '%s@%s' "$image_repository" "$image_digest"

  return 0
}

has_package() {
  package_name=$1

  if [ ! -f composer.lock ]; then
    return 1
  fi

  while IFS= read -r line; do
    case $line in
      *"\"name\": \"$package_name\","*)
        return 0
      ;;
    esac
  done <composer.lock

  return 1
}

read_recipes() {
  if is_value_set "$TARGET_VALUES_FILE" DEPLOY_RECIPES; then
    RECIPES=$(get_value "$TARGET_VALUES_FILE" DEPLOY_RECIPES)
  else
    RECIPES=''

    if has_package symfony/framework-bundle; then
      RECIPES="$RECIPES symfony"
    fi

    if has_package doctrine/doctrine-bundle; then
      RECIPES="$RECIPES doctrine"
    fi
  fi

  for recipe in $RECIPES; do
    if ! is_listed "$recipe" 'symfony doctrine'; then
      fail "Unknown recipe \`$recipe\`, expected \`symfony\` or \`doctrine\`."
    fi
  done

  return 0
}

list_services() {
  rendered_file=$1

  awk '
    /^services:/ { is_in_services = 1; next }
    /^[^ ]/ { is_in_services = 0 }
    is_in_services && /^  [^ ]/ { service = substr($0, 3, length($0) - 3); print service }
  ' "$rendered_file"

  return 0
}

does_publish_ports() {
  rendered_file=$1
  service_name=$2

  awk -v service_name="$service_name" '
    /^services:/ { is_in_services = 1; next }
    /^[^ ]/ { is_in_services = 0 }
    is_in_services && /^  [^ ]/ { service = substr($0, 3, length($0) - 3) }
    is_in_services && service == service_name && /^    ports:/ { is_publishing = 1 }
    END { exit is_publishing ? 0 : 1 }
  ' "$rendered_file"
}

get_environment_values() {
  rendered_file=$1
  key=$2

  awk -v key="$key" '
    /^services:/ { is_in_services = 1; next }
    /^[^ ]/ { is_in_services = 0 }
    is_in_services && index($0, "      " key ": ") == 1 {
      value = substr($0, length(key) + 9)
      gsub(/^"|"$/, "", value)
      print value
    }
  ' "$rendered_file"

  return 0
}

get_application_mount() {
  rendered_file=$1

  awk '
    /^services:/ { is_in_services = 1; next }
    /^[^ ]/ { is_in_services = 0 }
    is_in_services && /^  [^ ]/ { service = substr($0, 3, length($0) - 3) }
    is_in_services && /^      - type: / { mount_type = substr($0, 15) }
    is_in_services && /^        source: / { mount_source = substr($0, 17) }
    is_in_services && mount_type == "bind" && /^        target: \/app$/ { print service " " mount_source; exit }
  ' "$rendered_file"

  return 0
}

is_hot_reloading() {
  rendered_file=$1

  [ "$(get_value "$TARGET_VALUES_FILE" FORGE_HOT_RELOAD)" = 1 ] \
    || get_environment_values "$rendered_file" FORGE_HOT_RELOAD | grep -qx 1
}

is_watching() {
  rendered_file=$1

  {
    get_value "$TARGET_VALUES_FILE" FORGE_WORKER_CONFIG
    printf '\n'
    get_environment_values "$rendered_file" FORGE_WORKER_CONFIG
  } | grep -qw watch
}

check_development() {
  rendered_file=$1
  application_mount=$(get_application_mount "$rendered_file")

  if is_hot_reloading "$rendered_file"; then
    fail "A release runs no hot reload, which watches every file; unset \`FORGE_HOT_RELOAD\`."
  fi

  if is_watching "$rendered_file"; then
    fail "A release runs no \`watch\`, which restarts the workers on every file change; remove it from \`FORGE_WORKER_CONFIG\`."
  fi

  if [ -n "$application_mount" ]; then
    fail "\`${application_mount%% *}\` mounts \`${application_mount#* }\` over \`/app\`, which only development does; include the fragments without \`-dev\` instead."
  fi

  return 0
}

get_service_image() {
  rendered_file=$1
  service_name=$2

  awk -v service_name="$service_name" '
    /^services:/ { is_in_services = 1; next }
    /^[^ ]/ { is_in_services = 0 }
    is_in_services && /^  [^ ]/ { service = substr($0, 3, length($0) - 3) }
    is_in_services && service == service_name && /^    image: / { print substr($0, 12) }
  ' "$rendered_file"

  return 0
}

read_services() {
  rendered_file=$1
  image_reference=$2
  ALL_SERVICES=$(list_services "$rendered_file" | tr '\n' ' ')
  IMAGE_SERVICES=''
  OTHER_SERVICES=''
  POSTGRES_SERVICES=''

  for service in $ALL_SERVICES; do
    service_image=$(get_service_image "$rendered_file" "$service")

    if [ "$service_image" = "$image_reference" ]; then
      IMAGE_SERVICES="$IMAGE_SERVICES $service"
    else
      OTHER_SERVICES="$OTHER_SERVICES $service"
    fi

    case $service_image in
      *postgres*)
        POSTGRES_SERVICES="$POSTGRES_SERVICES $service"
      ;;
    esac
  done

  APPLICATION_SERVICE=''

  for service in php-app bun-app $IMAGE_SERVICES; do
    if [ -z "$APPLICATION_SERVICE" ] && is_listed "$service" "$IMAGE_SERVICES"; then
      APPLICATION_SERVICE=$service
    fi
  done

  return 0
}

compose_config() {
  project_name=$1
  override_file=$2
  output_file=$3
  services=${4:-}
  http_port=$(get_value "$TARGET_VALUES_FILE" APP_HTTP_PORT)
  https_port=$(get_value "$TARGET_VALUES_FILE" APP_HTTPS_PORT)

  set --

  for env_file in "$DOTENV_BASE" "$DOTENV_BASE.$TARGET" "$DOTENV_BASE.$TARGET.local" "${DEPLOY_DOTENV_FILE:-}"; do
    if [ -f "$env_file" ]; then
      set -- "$@" --env-file "$env_file"
    fi
  done

  remaining_files=$(get_value "$TARGET_VALUES_FILE" COMPOSE_FILE)

  while [ -n "$remaining_files" ]; do
    set -- "$@" --file "${remaining_files%%:*}"

    case $remaining_files in
      *:*)
        remaining_files=${remaining_files#*:}
      ;;

      *)
        remaining_files=''
      ;;
    esac
  done

  if [ -n "$override_file" ]; then
    set -- "$@" --file "$override_file"
  fi

  set -- "$@" --project-name "$project_name" config --no-env-resolution --no-path-resolution

  for service in $services; do
    set -- "$@" "$service"
  done

  COMPOSE_PROJECT_NAME=$project_name \
    APP_HTTP_PORT=${http_port:-80} \
    APP_HTTPS_PORT=${https_port:-443} \
    DEPLOY_APP_ENV=$(get_value "$TARGET_VALUES_FILE" DEPLOY_APP_ENV) \
    FORGE_APP_IMAGE=$RENDER_IMAGE \
    FORGE_PROXY_SITES_DIR=$DEPLOY_SHARED_PATH/sites \
    FORGE_RELEASE=$RENDER_RELEASE \
    FORGE_SHARED_DIR=$RENDER_SHARED_DIRECTORY \
    FORGE_WARMUP_COMMAND=$RENDER_WARMUP_COMMAND \
    docker compose "$@" >"$output_file.unfiltered"

  sed '/^      [A-Z_][A-Z0-9_]*: null$/d' "$output_file.unfiltered" >"$output_file"
  rm "$output_file.unfiltered"

  return 0
}

write_release_override() {
  override_file=$1

  {
    printf 'services:\n'

    for service in $IMAGE_SERVICES; do
      if [ "$service" = "$APPLICATION_SERVICE" ] && [ -n "$HAS_PROXY" ]; then
        cat <<YAML
  $service:
    networks:
      default: {}
      $SHARED_PROJECT:
        aliases:
          - $PROJECT_NAME-app
    ports: !reset []
    environment:
      FORGE_HTTP_REDIRECT: 0
      SERVER_NAME: ":80"
      SYMFONY_TRUSTED_PROXIES: REMOTE_ADDR
YAML
      else
        cat <<YAML
  $service:
    networks:
      default: {}
      $SHARED_PROJECT: {}
YAML
      fi
    done

    if is_listed mailpit "$RELEASE_SERVICES"; then
      cat <<YAML
  mailpit:
    networks:
      default: {}
      $SHARED_PROJECT: {}
YAML
    fi

    cat <<YAML
networks:
  $SHARED_PROJECT:
    external: true
YAML
  } >"$override_file"

  return 0
}

write_shared_override() {
  override_file=$1
  shared_service=$2

  {
    cat <<YAML
services:
  $shared_service:
    container_name: $SHARED_PROJECT-$shared_service
YAML

    if [ "$shared_service" = valkey ] && [ "$(get_value "$TARGET_VALUES_FILE" VALKEY_REQUIRE_ACL)" = 1 ]; then
      VALKEY_ADMIN_PASSWORD=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')

      cat <<YAML
    environment:
      VALKEYCLI_AUTH: $VALKEY_ADMIN_PASSWORD
YAML
    fi

    if [ "$shared_service" = mailpit ]; then
      cat <<YAML
    environment:
      MP_SMTP_AUTH_ACCEPT_ANY: "false"
      MP_SMTP_AUTH_FILE: $RUN_DIRECTORY/mailpit.passwd
    volumes:
      - type: bind
        source: $DEPLOY_SHARED_PATH/mailpit.passwd
        target: $RUN_DIRECTORY/mailpit.passwd
        read_only: true
        bind:
          create_host_path: false
YAML
    fi

    cat <<YAML
networks:
  default:
    name: $SHARED_PROJECT
    external: true
YAML
  } >"$override_file"

  return 0
}

name_shared_volumes() {
  override_file=$1
  rendered_file=$2
  volume_keys=$(awk '
    /^volumes:/ { is_in_volumes = 1; next }
    /^[^ ]/ { is_in_volumes = 0 }
    is_in_volumes && /^  [^ ]/ { volume_key = substr($0, 3); sub(/:.*/, "", volume_key); print volume_key }
  ' "$rendered_file")

  if [ -z "$volume_keys" ]; then
    return 0
  fi

  {
    printf 'volumes:\n'

    for volume_key in $volume_keys; do
      printf '  %s:\n    name: %s\n' "$volume_key" "$volume_key"
    done
  } >>"$override_file"

  return 0
}

require_valkey_acl() {
  rendered_file=$1

  awk '
    /^    command:$/ { is_in_command = 1; print; next }
    is_in_command && !/^      - / { print "      - --aclfile"; print "      - /data/users.acl"; is_in_command = 0 }
    { print }
    END { if (is_in_command) { print "      - --aclfile"; print "      - /data/users.acl" } }
  ' "$rendered_file" >"$rendered_file.acl"

  mv "$rendered_file.acl" "$rendered_file"

  if ! grep -q -- '- --aclfile$' "$rendered_file"; then
    fail "\`valkey\` has no \`command\` for \`--aclfile\`."
  fi

  return 0
}

render() {
  target=$1
  release_name=$2
  render_directory=$WORK_DIRECTORY/release
  full_file=$WORK_DIRECTORY/full.yaml

  RENDER_RELEASE=$release_name
  RENDER_WARMUP_COMMAND=''

  if is_listed symfony "$RECIPES"; then
    RENDER_WARMUP_COMMAND='bin/console cache:warmup'
  fi

  RENDER_SHARED_DIRECTORY=$DEPLOY_PATH/shared

  compose_config "$PROJECT_NAME" '' "$full_file"
  read_services "$full_file" "$RENDER_IMAGE"

  if [ "$target" = production ] && is_listed mailpit "$ALL_SERVICES"; then
    fail "Production runs no \`mailpit\`, which catches every mail; send through a real \`MAILER_DSN\` instead."
  fi

  check_development "$full_file"

  HAS_PROXY=''
  SHARED_SERVICES=''

  if is_listed proxy "$ALL_SERVICES"; then
    HAS_PROXY=1
    SHARED_SERVICES=proxy
  fi

  for service in $(get_value "$TARGET_VALUES_FILE" DEPLOY_SHARED_SERVICES); do
    if ! is_listed "$service" 'valkey postgres mailpit'; then
      fail "Unknown shared service \`$service\`, expected \`valkey\`, \`postgres\`, or \`mailpit\`."
    fi

    if ! is_listed "$service" "$ALL_SERVICES"; then
      fail "\`DEPLOY_SHARED_SERVICES\` lists \`$service\`, which \`$target\` does not run."
    fi

    SHARED_SERVICES="$SHARED_SERVICES $service"
  done

  RELEASE_SERVICES=''

  for service in $ALL_SERVICES; do
    if ! is_listed "$service" "$SHARED_SERVICES"; then
      RELEASE_SERVICES="$RELEASE_SERVICES $service"
    fi
  done

  mkdir -p "$render_directory"

  release_override=''

  if [ -n "$SHARED_SERVICES" ]; then
    release_override=$WORK_DIRECTORY/release-override.yaml

    write_release_override "$release_override"

    RENDER_SHARED_DIRECTORY=$DEPLOY_SHARED_PATH

    for service in $SHARED_SERVICES; do
      write_shared_override "$WORK_DIRECTORY/shared-override.yaml" "$service"

      compose_config "$SHARED_PROJECT-$service" "$WORK_DIRECTORY/shared-override.yaml" \
        "$WORK_DIRECTORY/shared-$service.yaml" "$service"

      name_shared_volumes "$WORK_DIRECTORY/shared-override.yaml" "$WORK_DIRECTORY/shared-$service.yaml"

      compose_config "$SHARED_PROJECT-$service" "$WORK_DIRECTORY/shared-override.yaml" \
        "$WORK_DIRECTORY/shared-$service.yaml" "$service"

      if [ "$service" = valkey ] && [ "$(get_value "$TARGET_VALUES_FILE" VALKEY_REQUIRE_ACL)" = 1 ]; then
        require_valkey_acl "$WORK_DIRECTORY/shared-$service.yaml"
      fi
    done
  fi

  RENDER_SHARED_DIRECTORY=$DEPLOY_PATH/shared

  compose_config "$PROJECT_NAME" "$release_override" "$render_directory/compose.yaml" "$RELEASE_SERVICES"
  read_services "$render_directory/compose.yaml" "$RENDER_IMAGE"

  for service in $SHARED_SERVICES; do
    printf '%s\n' "$service"
  done >"$render_directory/forge.shared"

  for hook in $HOOKS; do
    if [ -f "$HOOKS_DIRECTORY/$hook.sh" ]; then
      mkdir -p "$render_directory/hooks"
      cp "$HOOKS_DIRECTORY/$hook.sh" "$render_directory/hooks/$hook.sh"
    fi
  done

  return 0
}

check_shipped_var() {
  host_entry=$1

  announce "$host_entry" "check $VAR_DIRECTORY"

  shipped_files=$(run_remote "$host_entry" "docker run --rm --entrypoint find $(quote_shell_words "$RENDER_IMAGE" "$VAR_DIRECTORY") \
    -mindepth 1 ! -type d ! -name .gitkeep ! -name .gitignore")

  if [ -n "$shipped_files" ]; then
    fail "\`$VAR_DIRECTORY\` must be empty in the image, since its volume copies files only once and no later image could change them: $shipped_files"
  fi

  if is_listed symfony "$RECIPES" && ! run_remote "$host_entry" "docker run --rm --entrypoint test $(quote_shell_word "$RENDER_IMAGE") -f bin/console"; then
    fail "The image ships no \`bin/console\`, which Symfony runs from; add it to \`ARCHIVE_EXTRA_PATHS\`."
  fi

  return 0
}

get_dotenv_file() {
  dotenv_kind=$1

  case $dotenv_kind in
    deploy)
      printf '%s' "${DEPLOY_DOTENV_FILE:-}"
    ;;

    mercure)
      printf '%s' "${DEPLOY_DOTENV_MERCURE_FILE:-}"
    ;;

    mailpit)
      printf '%s' "${DEPLOY_DOTENV_MAILPIT_FILE:-}"
    ;;
  esac

  return 0
}

write_dotenv_files() {
  host_entry=$1

  for dotenv_kind in deploy mercure mailpit; do
    dotenv_file=$(get_dotenv_file "$dotenv_kind")

    dotenv_directory=$DEPLOY_PATH/shared

    if [ -z "$dotenv_file" ]; then
      continue
    fi

    if [ "$dotenv_kind" = mailpit ] && is_listed mailpit "$SHARED_SERVICES"; then
      dotenv_directory=$DEPLOY_SHARED_PATH
    fi

    dotenv_path=$(quote_shell_word "$dotenv_directory/.env.$dotenv_kind.local")

    announce "$host_entry" "write .env.$dotenv_kind.local"

    run_remote "$host_entry" "mkdir -p $(quote_shell_word "$dotenv_directory") && umask 077 \
      && cat >$dotenv_path && chmod 0600 $dotenv_path" <"$dotenv_file"
  done

  return 0
}

upload() {
  host_entry=$1
  release_name=$2

  upload_status=$WORK_DIRECTORY/upload.status

  upload_script=$(cat <<'SH'
set -eu

release_directory=$1

umask 077
mkdir -m 0711 "$release_directory"
tar -x -C "$release_directory"
chmod 0711 "$release_directory"

if [ -d "$release_directory/hooks" ]; then
  chmod -R a+rX "$release_directory/hooks"
fi
SH
  )

  announce "$host_entry" "upload $release_name"

  UPLOADED_HOSTS="$UPLOADED_HOSTS $host_entry"
  UPLOADED_RELEASE=$release_name

  : >"$upload_status"

  { tar -c -C "$WORK_DIRECTORY/release" . || printf '%s' "$?" >"$upload_status"; } \
    | run_remote "$host_entry" "sh -c $(quote_shell_word "$upload_script") sh $(quote_shell_word "$DEPLOY_PATH/releases/$release_name")"

  if [ -s "$upload_status" ]; then
    exit 1
  fi

  return 0
}

pull() {
  host_entry=$1
  release_name=$2

  announce "$host_entry" pull
  compose_release "$host_entry" "$release_name" pull --quiet

  PULLED_HOSTS="$PULLED_HOSTS $host_entry"

  return 0
}

report_shared_drift() {
  host_entry=$1
  shared_service=$2
  running_file=$3
  running_image=$(get_service_image "$running_file" "$shared_service")
  pinned_image=$(get_service_image "$WORK_DIRECTORY/shared-$shared_service.yaml" "$shared_service")

  if [ "$running_image" != "$pinned_image" ]; then
    printf "%s: \`%s\` runs \`%s\`, this deploy pins \`%s\`; \`make %s-deploy-shared\` moves it.\n" \
      "$host_entry" "$shared_service" "$running_image" "$pinned_image" "$TARGET"
  fi

  return 0
}

free_ports() {
  host_entry=$1
  previous_release=$(get_current_release "$host_entry")
  previous_file=$WORK_DIRECTORY/previous.yaml

  if [ -z "$HAS_PROXY" ] || [ -z "$previous_release" ]; then
    return 0
  fi

  run_remote "$host_entry" "cat $(quote_shell_word "$DEPLOY_PATH/releases/$previous_release/compose.yaml")" >"$previous_file"

  if does_publish_ports "$previous_file" "$APPLICATION_SERVICE"; then
    announce "$host_entry" "stop $APPLICATION_SERVICE of $previous_release for the proxy"
    compose_release "$host_entry" "$previous_release" rm --stop --force "$APPLICATION_SERVICE"

    FREED_PORTS="$FREED_PORTS $host_entry=$previous_release"
  fi

  return 0
}

write_valkey_users() {
  host_entry=$1

  users_script=$(cat <<'SH'
set -eu

read -r password
umask 077
touch /data/users.acl
grep -v -e '^user default ' -e '^user forge ' /data/users.acl >/data/users.acl.new || true
printf 'user default off\nuser forge on >%s ~* &* +@all\n' "$password" >>/data/users.acl.new
chmod 0600 /data/users.acl.new
mv /data/users.acl.new /data/users.acl
SH
  )

  printf '%s\n' "$VALKEY_ADMIN_PASSWORD" \
    | compose_shared "$host_entry" valkey run --rm -T --no-deps --entrypoint sh valkey -c "$users_script"

  return 0
}

has_valkey_acl() {
  host_entry=$1

  run_remote "$host_entry" "grep -q -- '- --aclfile$' $(quote_shell_word "$DEPLOY_SHARED_PATH/valkey/compose.yaml") 2>/dev/null"
}

check_shared_valkey() {
  host_entry=$1

  if ! is_listed valkey "$SHARED_SERVICES" || [ "$(get_value "$TARGET_VALUES_FILE" VALKEY_REQUIRE_ACL)" != 1 ]; then
    return 0
  fi

  if run_remote "$host_entry" "[ -f $(quote_shell_word "$DEPLOY_SHARED_PATH/valkey/compose.yaml") ]" \
    && ! has_valkey_acl "$host_entry"; then
    fail "\`$SHARED_PROJECT-valkey\` on \`$host_entry\` runs without ACLs; run \`make $TARGET-deploy-shared\`."
  fi

  return 0
}

run_valkey_admin() {
  host_entry=$1
  admin_output=$(run_remote "$host_entry" "docker exec -i $SHARED_PROJECT-valkey valkey-cli --user forge")

  if printf '%s\n' "$admin_output" | grep -qv '^OK$'; then
    fail "\`$SHARED_PROJECT-valkey\` rejected the ACL change."
  fi

  return 0
}

prepare_shared_valkey() {
  host_entry=$1

  if ! is_listed valkey "$SHARED_SERVICES"; then
    return 0
  fi

  if ! has_valkey_acl "$host_entry"; then
    return 0
  fi

  if [ -z "$(get_value "$TARGET_VALUES_FILE" VALKEY_PASSWORD)" ]; then
    fail "The shared \`valkey\` requires ACLs; set \`VALKEY_PASSWORD\` for \`$TARGET\`."
  fi

  announce "$host_entry" "prepare $PROJECT_NAME on $SHARED_PROJECT-valkey"

  password_hash=$(get_value "$TARGET_VALUES_FILE" VALKEY_PASSWORD \
    | run_remote "$host_entry" "docker exec -i $SHARED_PROJECT-valkey sha256sum")

  printf 'ACL SETUSER %s reset on #%s ~%s:* &%s:* +@all -@dangerous\nACL SAVE\n' \
    "$PROJECT_NAME" "${password_hash%% *}" "$PROJECT_NAME" "$PROJECT_NAME" | run_valkey_admin "$host_entry"

  return 0
}

ensure_shared() {
  host_entry=$1
  is_forced=${2:-}
  running_file=$WORK_DIRECTORY/running-shared.yaml

  if [ -z "$SHARED_SERVICES" ]; then
    return 0
  fi

  run_remote "$host_entry" "docker network inspect $SHARED_PROJECT >/dev/null 2>&1 || docker network create $SHARED_PROJECT >/dev/null"

  for service in $SHARED_SERVICES; do
    shared_directory=$DEPLOY_SHARED_PATH/$service

    run_remote "$host_entry" "cat $(quote_shell_word "$shared_directory/compose.yaml") 2>/dev/null || true" >"$running_file"

    if [ -s "$running_file" ] && [ -z "$is_forced" ]; then
      report_shared_drift "$host_entry" "$service" "$running_file"
      compose_shared "$host_entry" "$service" up --detach --wait --wait-timeout "$WAIT_TIMEOUT"

      continue
    fi

    announce "$host_entry" "start $SHARED_PROJECT-$service"

    if [ "$service" = proxy ]; then
      CREATED_PROXIES="$CREATED_PROXIES $host_entry"
    fi

    run_remote "$host_entry" "mkdir -p $(quote_shell_words "$DEPLOY_SHARED_PATH/sites" "$shared_directory") \
      && (umask 077 && cat >$(quote_shell_word "$shared_directory/compose.yaml"))" <"$WORK_DIRECTORY/shared-$service.yaml"

    if [ "$service" = valkey ] && grep -q -- '- --aclfile$' "$WORK_DIRECTORY/shared-$service.yaml"; then
      write_valkey_users "$host_entry"
    fi

    compose_shared "$host_entry" "$service" up --detach --wait --wait-timeout "$WAIT_TIMEOUT" --remove-orphans
  done

  return 0
}

get_target_databases() {
  target_databases=''

  for database in $(get_value "$TARGET_VALUES_FILE" POSTGRES_DB) $(get_value "$TARGET_VALUES_FILE" POSTGRES_EXTRA_DATABASES); do
    target_databases="$target_databases $database"
  done

  printf '%s' "${target_databases# }"

  return 0
}

check_identifier() {
  identifier_name=$1
  identifier=$2

  case $identifier in
    *[!a-z0-9_]* | '')
      fail "Set \`$identifier_name\` to lowercase letters, digits, and \`_\`, \`$identifier\` given."
    ;;
  esac

  return 0
}

prepare_shared_postgres() {
  host_entry=$1
  role=$(get_value "$TARGET_VALUES_FILE" POSTGRES_USER)
  databases=$(get_target_databases)

  if ! is_listed postgres "$SHARED_SERVICES"; then
    return 0
  fi

  check_identifier POSTGRES_USER "$role"

  for database in $databases; do
    check_identifier POSTGRES_DB "$database"
  done

  announce "$host_entry" "prepare $role on $SHARED_PROJECT-postgres"

  get_value "$TARGET_VALUES_FILE" POSTGRES_PASSWORD | run_remote "$host_entry" \
    "umask 077 && cat >$(quote_shell_word "$DEPLOY_PATH/shared/.forge-postgres-password")"

  set -- "$DEPLOY_PATH" "$SHARED_PROJECT-postgres" "$role" "$PROJECT_NAME"

  for database in $databases; do
    set -- "$@" "$database"
  done

  run_remote_script "$host_entry" "$@" <<'SH'
set -eu

password_file=$1/shared/.forge-postgres-password
container=$2
role=$3
project=$4

shift 4

query() {
  docker exec -i "$container" sh -c \
    'psql --username "$POSTGRES_USER" --dbname postgres --tuples-only --no-align --quiet --set ON_ERROR_STOP=1 --set VERBOSITY=terse'
}

password=$(sed "s/'/''/g" "$password_file")

rm -f "$password_file"

owner=$(printf "SELECT COALESCE(shobj_description(oid, 'pg_authid'), '') FROM pg_roles WHERE rolname = '%s';\n" "$role" | query)

if [ -z "$(printf "SELECT 1 FROM pg_roles WHERE rolname = '%s';\n" "$role" | query)" ]; then
  printf "CREATE ROLE \"%s\" LOGIN PASSWORD '%s';\n" "$role" "$password" | query
elif [ -z "$owner" ]; then
  printf '%s\n' "Role \`$role\` belongs to no project; adopt it with \`COMMENT ON ROLE \"$role\" IS '$project'\`." >&2

  exit 1
elif [ "$owner" != "$project" ]; then
  printf '%s\n' "Role \`$role\` belongs to \`$owner\`." >&2

  exit 1
else
  printf "ALTER ROLE \"%s\" PASSWORD '%s';\n" "$role" "$password" | query
fi

printf "COMMENT ON ROLE \"%s\" IS '%s';\n" "$role" "$project" | query

for database do
  database_owner=$(printf "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '%s';\n" "$database" | query)

  if [ -z "$database_owner" ]; then
    printf 'CREATE DATABASE "%s" OWNER "%s";\n' "$database" "$role" | query
  elif [ "$database_owner" != "$role" ]; then
    printf '%s\n' "Database \`$database\` belongs to \`$database_owner\`." >&2

    exit 1
  fi

  printf 'REVOKE CONNECT ON DATABASE "%s" FROM PUBLIC;\nGRANT CONNECT ON DATABASE "%s" TO "%s";\n' \
    "$database" "$database" "$role" | query
done
SH

  return 0
}

move_postgres() {
  host_entry=$1
  source_container=$2
  destination_container=$3
  role=$(get_value "$TARGET_VALUES_FILE" POSTGRES_USER)
  databases=$(get_target_databases)

  announce "$host_entry" "move $databases from $source_container to $destination_container"

  set -- "$source_container" "$destination_container" "$role"

  for database in $databases; do
    set -- "$@" "$database"
  done

  run_remote_script "$host_entry" "$@" <<'SH'
set -eu

source_container=$1
destination_container=$2
role=$3
dump_status=$(mktemp)

trap 'rm -f "$dump_status"' EXIT

shift 3

for database do
  tables=$(printf "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema');\n" \
    | docker exec -i "$destination_container" sh -c \
      'psql --username "$POSTGRES_USER" --dbname "$1" --tuples-only --no-align --quiet' sh "$database")

  if [ "$tables" != 0 ]; then
    printf '%s\n' "\`$database\` on \`$destination_container\` already holds tables, so nothing was moved." >&2

    exit 1
  fi

  {
    docker exec "$source_container" sh -c 'pg_dump --username "$POSTGRES_USER" --format custom "$1"' sh "$database" \
      || printf '%s' "$?" >"$dump_status"
  } | docker exec -i "$destination_container" sh -c \
    'pg_restore --username "$POSTGRES_USER" --no-owner --role "$1" --dbname "$2"' sh "$role" "$database"

  if [ -s "$dump_status" ]; then
    printf '%s\n' "\`$source_container\` did not dump \`$database\`." >&2

    exit 1
  fi
done
SH
}

move_valkey() {
  host_entry=$1
  source_container=$2
  destination_container=$3
  project_container=$4
  database=$(get_value "$TARGET_VALUES_FILE" VALKEY_DB)
  key_pattern='*'

  if has_valkey_acl "$host_entry"; then
    key_pattern="$PROJECT_NAME:*"
  fi

  announce "$host_entry" "move keys of database ${database:-0} from $source_container to $destination_container"

  run_remote_script "$host_entry" "$source_container" "$destination_container" "$project_container" \
    "${database:-0}" "$SHARED_PROJECT" "$key_pattern" <<'SH'
set -eu

source_container=$1
destination_container=$2
project_container=$3
database=$4
shared_network=$5
key_pattern=$6
shared_container=$shared_network-valkey
migrate_authentication=''

query() {
  container=$1

  shift

  if [ "$key_pattern" != '*' ] && [ "$container" = "$shared_container" ]; then
    docker exec "$container" valkey-cli --user forge "$@"
  else
    docker exec "$container" valkey-cli "$@"
  fi
}

if [ "$key_pattern" != '*' ] && [ "$destination_container" = "$shared_container" ]; then
  migrate_authentication="forge $(docker exec "$destination_container" printenv VALKEYCLI_AUTH)"
fi

docker network connect "$shared_network" "$project_container" 2>/dev/null || true

trap 'docker network disconnect "$shared_network" "$project_container" 2>/dev/null || true' EXIT

destination_keys=$(query "$destination_container" -n "$database" --scan --pattern "$key_pattern")

if [ -n "$destination_keys" ]; then
  printf '%s\n' "Database \`$database\` on \`$destination_container\` already holds keys, so nothing was moved." >&2

  exit 1
fi

migrate() {
  if [ "$#" -eq 0 ]; then
    return 0
  fi

  if [ -n "$migrate_authentication" ]; then
    migrate_reply=$(query "$source_container" -n "$database" \
      MIGRATE "$destination_container" 6379 '' "$database" 5000 COPY AUTH2 ${migrate_authentication} KEYS "$@")
  else
    migrate_reply=$(query "$source_container" -n "$database" \
      MIGRATE "$destination_container" 6379 '' "$database" 5000 COPY KEYS "$@")
  fi

  case $migrate_reply in
    OK | NOKEY)
    ;;

    *)
      printf '%s\n' "\`$source_container\` did not move every key." >&2

      exit 1
    ;;
  esac
}

source_keys=$(query "$source_container" -n "$database" --scan --pattern "$key_pattern")

set --

while IFS= read -r key; do
  set -- "$@" "$key"

  if [ "$#" -ge 100 ]; then
    migrate "$@"
    set --
  fi
done <<EOF
$source_keys
EOF

migrate "$@"
SH
}

move_data() {
  host_entry=$1
  previous_release=$(get_current_release "$host_entry")
  previous_file=$WORK_DIRECTORY/previous.yaml

  if [ -z "$previous_release" ]; then
    return 0
  fi

  run_remote "$host_entry" "cat $(quote_shell_word "$DEPLOY_PATH/releases/$previous_release/compose.yaml")" >"$previous_file"

  previous_services=$(list_services "$previous_file" | tr '\n' ' ')

  previous_shared=$(get_shared_services "$host_entry" "$previous_release")

  for service in postgres valkey; do
    source_container=''

    if is_listed "$service" "$previous_services" && is_listed "$service" "$SHARED_SERVICES"; then
      source_container=$PROJECT_NAME-$service
      destination_container=$SHARED_PROJECT-$service
    elif is_listed "$service" "$previous_shared" && is_listed "$service" "$RELEASE_SERVICES"; then
      source_container=$SHARED_PROJECT-$service
      destination_container=$PROJECT_NAME-$service
    fi

    if [ -z "$source_container" ]; then
      continue
    fi

    if [ "$service" = postgres ]; then
      move_postgres "$host_entry" "$source_container" "$destination_container"
    else
      move_valkey "$host_entry" "$source_container" "$destination_container" "$PROJECT_NAME-$service"
    fi
  done

  return 0
}

get_shared_services() {
  host_entry=$1
  release_name=$2

  shared_services=$(run_remote "$host_entry" \
    "cat $(quote_shell_word "$DEPLOY_PATH/releases/$release_name/forge.shared") 2>/dev/null || true") || return $?

  printf '%s' "$shared_services" | tr '\n' ' '

  return 0
}

start_other_services() {
  host_entry=$1
  release_name=$2

  if [ -z "$OTHER_SERVICES" ]; then
    return 0
  fi

  set --

  for service in $OTHER_SERVICES; do
    set -- "$@" "$service"
  done

  announce "$host_entry" "start$OTHER_SERVICES"
  compose_release "$host_entry" "$release_name" up --detach --wait --wait-timeout "$WAIT_TIMEOUT" "$@"

  return 0
}

format_databases() {
  databases=$1

  printf '%s\n' "$databases" | awk '
    { for (i = 1; i <= NF; i++) { names[++count] = "`" $i "`" } }
    END {
      if (count == 1) { printf "database %s", names[1]; exit }
      printf "databases "
      for (i = 1; i < count; i++) { printf "%s%s", names[i], (count > 2 ? ", " : " ") }
      printf "and %s", names[count]
    }
  '

  return 0
}

create_databases() {
  host_entry=$1
  release_name=$2
  databases=$(get_value "$TARGET_VALUES_FILE" POSTGRES_EXTRA_DATABASES)

  if [ -z "$databases" ]; then
    return 0
  fi

  database_list=$(format_databases "$databases")

  for service in $POSTGRES_SERVICES; do
    announce "$host_entry" "create $database_list in $service"

    set -- "$DEPLOY_PATH/releases/$release_name" "$service"

    for database in $databases; do
      set -- "$@" "$database"
    done

    run_remote_script "$host_entry" "$@" <<'SH'
set -eu

release_directory=$1
service=$2

shift 2

cd "$release_directory"

for database do
  docker compose --file compose.yaml exec -T "$service" sh -c '
    if [ -z "$(psql --username "$POSTGRES_USER" --dbname postgres --tuples-only --no-align \
      --command "SELECT 1 FROM pg_database WHERE datname = '"'"'$1'"'"'")" ]; then
      createdb --username "$POSTGRES_USER" "$1"
    fi
  ' sh "$database"
done
SH
  done

  return 0
}

back_up() {
  host_entry=$1
  release_name=$2

  for service in $POSTGRES_SERVICES; do
    announce "$host_entry" "back up $service"

    run_remote_script "$host_entry" "$DEPLOY_PATH" "$release_name" "$service" <<'SH'
set -eu

deploy_path=$1
release=$2
service=$3
backup_directory=$deploy_path/shared/backups/$release/$service

umask 077
mkdir -p "$backup_directory"
cd "$deploy_path/releases/$release"

databases=$(docker compose --file compose.yaml exec -T "$service" \
  sh -c 'psql --username "$POSTGRES_USER" --dbname postgres --tuples-only --no-align --command "SELECT datname FROM pg_database WHERE NOT datistemplate"')

for database in $databases; do
  case $database in
    *[!A-Za-z0-9._-]* | .*)
      printf '%s\n' "Database \`$database\` in \`$service\` has no safe backup file name." >&2

      exit 1
    ;;
  esac

  docker compose --file compose.yaml exec -T "$service" \
    sh -c 'pg_dump --username "$POSTGRES_USER" --format custom "$1"' sh "$database" >"$backup_directory/$database.dump"
done
SH
  done

  if is_listed postgres "$SHARED_SERVICES"; then
    back_up_shared_postgres "$host_entry" "$release_name"
  fi

  return 0
}

back_up_shared_postgres() {
  host_entry=$1
  release_name=$2

  set -- "$DEPLOY_PATH/shared/backups/$release_name/$SHARED_PROJECT-postgres" "$SHARED_PROJECT-postgres"

  for database in $(get_target_databases); do
    set -- "$@" "$database"
  done

  announce "$host_entry" "back up $SHARED_PROJECT-postgres"

  run_remote_script "$host_entry" "$@" <<'SH'
set -eu

backup_directory=$1
container=$2

shift 2

umask 077
mkdir -p "$backup_directory"

for database do
  docker exec "$container" sh -c 'pg_dump --username "$POSTGRES_USER" --format custom "$1"' sh "$database" \
    >"$backup_directory/$database.dump"
done
SH
}

restore() {
  host_entry=$1
  release_name=$2
  backup_release=$3

  for service in $POSTGRES_SERVICES; do
    announce "$host_entry" "restore $service from $backup_release"

    run_remote_script "$host_entry" "$DEPLOY_PATH" "$release_name" "$service" "$backup_release" <<'SH'
set -eu

deploy_path=$1
release=$2
service=$3
backup_release=$4
backup_directory=$deploy_path/shared/backups/$backup_release/$service

if [ ! -d "$backup_directory" ]; then
  printf '%s\n' "No backup of \`$service\` was taken before \`$backup_release\`." >&2

  exit 1
fi

cd "$deploy_path/releases/$release"

for dump in "$backup_directory"/*.dump; do
  database=$(basename "$dump" .dump)

  docker compose --file compose.yaml exec -T "$service" \
    sh -c 'pg_restore --username "$POSTGRES_USER" --clean --if-exists --dbname "$1"' sh "$database" <"$dump"
done
SH
  done

  release_shared=$(get_shared_services "$host_entry" "$release_name")

  if is_listed postgres "$release_shared"; then
    restore_shared_postgres "$host_entry" "$backup_release"
  fi

  return 0
}

restore_shared_postgres() {
  host_entry=$1
  backup_release=$2

  announce "$host_entry" "restore $SHARED_PROJECT-postgres from $backup_release"

  run_remote_script "$host_entry" "$DEPLOY_PATH/shared/backups/$backup_release/$SHARED_PROJECT-postgres" \
    "$SHARED_PROJECT-postgres" "$backup_release" <<'SH'
set -eu

backup_directory=$1
container=$2
backup_release=$3

if [ ! -d "$backup_directory" ]; then
  printf '%s\n' "No backup of \`$container\` was taken before \`$backup_release\`." >&2

  exit 1
fi

for dump in "$backup_directory"/*.dump; do
  database=$(basename "$dump" .dump)

  docker exec -i "$container" \
    sh -c 'pg_restore --username "$POSTGRES_USER" --clean --if-exists --dbname "$1"' sh "$database" <"$dump"
done
SH
}

run_in_application() {
  host_entry=$1
  release_name=$2

  shift 2

  compose_release "$host_entry" "$release_name" run --rm --no-deps --no-TTY --env FORGE_ONE_OFF=1 "$@"
}

run_hook() {
  host_entry=$1
  release_name=$2
  hook=$3
  hook_path=$DEPLOY_PATH/releases/$release_name/hooks/$hook.sh

  shift 3

  if ! run_remote "$host_entry" "[ -f $(quote_shell_word "$hook_path") ]"; then
    return 0
  fi

  announce "$host_entry" "$hook.sh"

  run_in_application "$host_entry" "$release_name" "$@" \
    --volume "$hook_path:$RUN_DIRECTORY/$hook.sh:ro" \
    "$APPLICATION_SERVICE" sh "$RUN_DIRECTORY/$hook.sh"

  return 0
}

migrate() {
  host_entry=$1
  release_name=$2

  connections=$(get_value "$TARGET_VALUES_FILE" DEPLOY_DOCTRINE_CONNECTIONS)
  entity_managers=$(get_value "$TARGET_VALUES_FILE" DEPLOY_DOCTRINE_ENTITY_MANAGERS)

  run_hook "$host_entry" "$release_name" before-migrate

  if is_listed doctrine "$RECIPES"; then
    for connection in ${connections:-default}; do
      announce "$host_entry" "doctrine:database:create $connection"

      run_in_application "$host_entry" "$release_name" "$APPLICATION_SERVICE" \
        bin/console doctrine:database:create --if-not-exists "--connection=$connection"
    done

    if has_package doctrine/doctrine-migrations-bundle; then
      for entity_manager in ${entity_managers:-default}; do
        announce "$host_entry" "doctrine:migrations:migrate $entity_manager"

        run_in_application "$host_entry" "$release_name" "$APPLICATION_SERVICE" \
          bin/console doctrine:migrations:migrate --no-interaction --allow-no-migration "--em=$entity_manager"
      done
    fi
  fi

  run_hook "$host_entry" "$release_name" after-migrate

  return 0
}

get_current_release() {
  host_entry=$1

  current_link=$(quote_shell_word "$DEPLOY_PATH/current")

  run_remote "$host_entry" "if [ -L $current_link ]; then basename \"\$(readlink $current_link)\"; fi"

  return 0
}

mark_bad() {
  host_entry=$1
  bad_release=$2

  run_remote "$host_entry" "printf '%s\n' $(quote_shell_word "$(get_stamp)") \
    >$(quote_shell_word "$DEPLOY_PATH/releases/$bad_release/forge.bad")"

  return 0
}

roll_out() {
  host_entry=$1
  release_name=$2

  run_remote_script "$host_entry" "$DEPLOY_PATH/releases/$release_name" "$APPLICATION_SERVICE" "$WAIT_TIMEOUT" <<'SH'
set -eu

release_directory=$1
service=$2
wait_timeout=$3

cd "$release_directory"

old_containers=$(docker compose --file compose.yaml ps --quiet "$service")
old_count=0

for container in $old_containers; do
  old_count=$((old_count + 1))
done

if docker compose --file compose.yaml up --detach --no-deps --no-recreate --wait --wait-timeout "$wait_timeout" \
  --scale "$service=$((old_count + 1))" "$service"; then
  printf '%s\n' $old_containers >../../forge.old

  exit 0
fi

for container in $(docker compose --file compose.yaml ps --all --quiet "$service"); do
  case " $(printf '%s ' $old_containers)" in
    *" $container "*)
    ;;

    *)
      docker rm --force "$container" >/dev/null
    ;;
  esac
done

exit 1
SH
}

stop_old_copies() {
  host_entry=$1

  run_remote_script "$host_entry" "$DEPLOY_PATH" <<'SH'
set -eu

deploy_path=$1

if [ -f "$deploy_path/forge.old" ]; then
  for container in $(cat "$deploy_path/forge.old"); do
    if docker inspect "$container" >/dev/null 2>&1; then
      docker stop "$container" >/dev/null
      docker rm "$container" >/dev/null
    fi
  done

  rm -f "$deploy_path/forge.old"
fi
SH
}

start_application() {
  host_entry=$1
  release_name=$2

  if [ -z "$APPLICATION_SERVICE" ]; then
    return 0
  fi

  previous_release=$(get_current_release "$host_entry")

  announce "$host_entry" "start $APPLICATION_SERVICE"

  if [ -n "$HAS_PROXY" ] && roll_out "$host_entry" "$release_name"; then
    STARTED_APPLICATIONS="$STARTED_APPLICATIONS $host_entry=$release_name=$previous_release"

    return 0
  fi

  if [ -z "$HAS_PROXY" ] && compose_release "$host_entry" "$release_name" \
    up --detach --no-deps --wait --wait-timeout "$WAIT_TIMEOUT" "$APPLICATION_SERVICE"; then
    STARTED_APPLICATIONS="$STARTED_APPLICATIONS $host_entry=$release_name=$previous_release"

    return 0
  fi

  mark_bad "$host_entry" "$release_name"

  if [ -z "$HAS_PROXY" ] && [ -n "$previous_release" ] && [ "$previous_release" != "$release_name" ]; then
    announce "$host_entry" "restore $APPLICATION_SERVICE of $previous_release"
    compose_release "$host_entry" "$previous_release" \
      up --detach --no-deps --wait --wait-timeout "$WAIT_TIMEOUT" "$APPLICATION_SERVICE"
  fi

  fail "\`$APPLICATION_SERVICE\` of \`$release_name\` did not become healthy on \`$host_entry\`."
}

write_site() {
  host_entry=$1
  server_name=$(get_value "$TARGET_VALUES_FILE" SERVER_NAME)
  mailpit_server_name=$(get_value "$TARGET_VALUES_FILE" MAILPIT_SERVER_NAME)
  site_file=$WORK_DIRECTORY/site.caddyfile

  if [ -z "$HAS_PROXY" ]; then
    return 0
  fi

  {
    cat <<CADDYFILE
$server_name {
	header -Server

	reverse_proxy $PROJECT_NAME-app:80 {
		lb_try_duration 10s
	}
}
CADDYFILE

    if [ -n "$mailpit_server_name" ]; then
      mailpit_project=$SHARED_PROJECT

      if is_listed mailpit "$ALL_SERVICES"; then
        mailpit_project=$PROJECT_NAME
      fi

      cat <<CADDYFILE

$mailpit_server_name {
	header -Server

	reverse_proxy $mailpit_project-mailpit:8025
}
CADDYFILE
    fi
  } >"$site_file"

  announce "$host_entry" "route $server_name"
  run_remote "$host_entry" "cat >$(quote_shell_word "$DEPLOY_SHARED_PATH/sites/$PROJECT_NAME.caddyfile")" <"$site_file"
  compose_shared "$host_entry" proxy exec -T proxy frankenphp reload --config /etc/frankenphp/Caddyfile

  return 0
}

check_mailpit_login() {
  host_entry=$1
  dotenv_directory=$DEPLOY_PATH/shared

  if [ -z "$HAS_PROXY" ] || [ -z "$(get_value "$TARGET_VALUES_FILE" MAILPIT_SERVER_NAME)" ]; then
    return 0
  fi

  if is_listed mailpit "$SHARED_SERVICES"; then
    dotenv_directory=$DEPLOY_SHARED_PATH
  fi

  if ! run_remote_script "$host_entry" "$dotenv_directory/.env.mailpit.local" <<'SH'
set -eu

grep -q -E "^MP_UI_AUTH(_FILE)?=(\"[^\"]|'[^']|[^\"'[:space:]#])" "$1" 2>/dev/null
SH
  then
    fail "\`MAILPIT_SERVER_NAME\` needs \`MP_UI_AUTH\` or \`MP_UI_AUTH_FILE\` in \`$dotenv_directory/.env.mailpit.local\` on \`$host_entry\`."
  fi

  return 0
}

switch_current() {
  host_entry=$1
  release_name=$2

  site_path=$(quote_shell_word "$DEPLOY_SHARED_PATH/sites/$PROJECT_NAME.caddyfile")

  announce "$host_entry" "switch to $release_name"

  if [ -n "$HAS_PROXY" ]; then
    run_remote "$host_entry" "if [ -f $site_path ]; then cp $site_path $site_path.previous; else rm -f $site_path.previous; fi"
  fi

  run_remote "$host_entry" "ln -sfn $(quote_shell_words "releases/$release_name" "$DEPLOY_PATH/current")"
  write_site "$host_entry"

  return 0
}

switch_back() {
  host_entry=$1
  release_name=$2
  previous_release=$3

  announce "$host_entry" "switch back from $release_name"

  if [ -n "$previous_release" ]; then
    run_remote "$host_entry" "ln -sfn $(quote_shell_words "releases/$previous_release" "$DEPLOY_PATH/current")"
  else
    run_remote "$host_entry" "rm -f $(quote_shell_word "$DEPLOY_PATH/current")"
  fi

  if [ -z "$HAS_PROXY" ]; then
    return 0
  fi

  run_remote_script "$host_entry" "$DEPLOY_SHARED_PATH/sites/$PROJECT_NAME.caddyfile" <<'SH'
set -eu

site=$1

if [ -f "$site.previous" ]; then
  mv "$site.previous" "$site"
else
  rm -f "$site"
fi
SH

  compose_shared "$host_entry" proxy exec -T proxy frankenphp reload --config /etc/frankenphp/Caddyfile

  return 0
}

start_rest() {
  host_entry=$1
  release_name=$2

  announce "$host_entry" 'start the rest'

  REST_STARTED_HOSTS="$REST_STARTED_HOSTS $host_entry"

  compose_release "$host_entry" "$release_name" up --detach --wait --wait-timeout "$WAIT_TIMEOUT" --remove-orphans

  return 0
}

check_layout() {
  host_entry=$1

  run_remote_script "$host_entry" "$DEPLOY_PATH" "$DEPLOY_SHARED_PATH" <<'SH'
set -eu

check_inside() {
  root=$1

  shift

  if [ ! -d "$root" ]; then
    return 0
  fi

  resolved_root=$(cd -P "$root" && pwd)

  for directory do
    if [ ! -e "$root/$directory" ] && [ ! -L "$root/$directory" ]; then
      continue
    fi

    resolved_directory=$(cd -P "$root/$directory" 2>/dev/null && pwd) || resolved_directory=''

    case $resolved_directory in
      "$resolved_root"/*)
      ;;

      *)
        printf '%s\n' "\`$root/$directory\` resolves outside \`$root\`." >&2

        exit 1
      ;;
    esac
  done

  return 0
}

check_inside "$1" releases shared shared/backups
check_inside "$2" sites proxy postgres valkey mailpit

for release_path in "$1"/releases/*; do
  if [ ! -e "$release_path" ] && [ ! -L "$release_path" ]; then
    continue
  fi

  check_inside "$1/releases" "${release_path##*/}"
done

for file in "$1"/shared/.env* "$1"/releases/*/compose.yaml "$2"/.env* \
  "$2"/mailpit.passwd "$2"/*/compose.yaml "$2"/sites/*.caddyfile; do
  if [ -L "$file" ]; then
    printf '%s\n' "\`$file\` is a symbolic link." >&2

    exit 1
  fi
done
SH
}

clean_up() {
  host_entry=$1

  announce "$host_entry" 'clean up'

  run_remote_script "$host_entry" "$DEPLOY_PATH" "$KEEP_RELEASES" \
    "$DEPLOY_SHARED_PATH/sites/$PROJECT_NAME.caddyfile.previous" <<'SH'
set -eu

deploy_path=$1
keep_releases=$2
previous_site=$3

rm -f "$previous_site"

cd "$deploy_path/releases"

current_release=$(basename "$(readlink ../current)")
kept_count=1
deleted_releases=''
kept_releases=$current_release
newest_first=''

for release in *; do
  newest_first="$release $newest_first"
done

for release in $newest_first; do
  if [ "$release" = "$current_release" ]; then
    continue
  elif [ -f "$release/forge.bad" ] || [ "$kept_count" -ge "$keep_releases" ]; then
    deleted_releases="$deleted_releases $release"
  else
    kept_count=$((kept_count + 1))
    kept_releases="$kept_releases $release"
  fi
done

kept_images=$(for release in $kept_releases; do grep -o '[^ ]*@sha256:[0-9a-f]*' "$release/compose.yaml" 2>/dev/null || true; done)

for release in $deleted_releases; do
  for image in $(grep -o '[^ ]*@sha256:[0-9a-f]*' "$release/compose.yaml" 2>/dev/null | sort -u); do
    case " $(printf '%s ' $kept_images)" in
      *" $image "*)
      ;;

      *)
        docker image rm "$image" >/dev/null 2>&1 || true
      ;;
    esac
  done

  rm -rf "./${release:?}" "../shared/backups/${release:?}"
done
SH

  return 0
}

load_release() {
  host_entry=$1
  release_name=$2
  loaded_file=$WORK_DIRECTORY/$release_name.yaml

  run_remote "$host_entry" "cat $(quote_shell_word "$DEPLOY_PATH/releases/$release_name/compose.yaml")" >"$loaded_file"

  SHARED_SERVICES=$(get_shared_services "$host_entry" "$release_name")
  HAS_PROXY=''

  if grep -q -- "- $PROJECT_NAME-app\$" "$loaded_file"; then
    HAS_PROXY=1
  fi

  application_image=''

  for service in php-app bun-app; do
    application_image=${application_image:-$(get_service_image "$loaded_file" "$service")}
  done

  if [ -z "$application_image" ]; then
    fail "\`$release_name\` runs neither \`php-app\` nor \`bun-app\`, so \`$host_entry\` cannot tell its application."
  fi

  read_services "$loaded_file" "$application_image"

  return 0
}

require_current_release() {
  host_entry=$1
  CURRENT_RELEASE=$(get_current_release "$host_entry")

  if [ -z "$CURRENT_RELEASE" ]; then
    fail "\`$host_entry\` has no release yet."
  fi

  load_release "$host_entry" "$CURRENT_RELEASE"

  return 0
}

stop_image_services() {
  host_entry=$1
  release_name=$2

  set --

  for service in $IMAGE_SERVICES; do
    set -- "$@" "$service"
  done

  compose_release "$host_entry" "$release_name" stop "$@"
}

deploy() {
  version=${VERSION:-}

  case $version in
    '' | *[!A-Za-z0-9._-]*)
      fail "Set \`VERSION\` to the image tag to deploy, e.g. \`1.2.3\` or \`dev-1a2b3c4\`."
    ;;
  esac

  release_name=$(date -u +%Y-%m-%dT%H-%M-%SZ)_$version
  RENDER_IMAGE=$(resolve_image "$TARGET" "$version")

  read_recipes
  render "$TARGET" "$release_name"

  on_every_host lock
  on_every_host check_layout
  check_shipped_var "${DEPLOY_HOSTS%% *}"
  on_every_host check_shared_valkey
  on_every_host upload "$release_name"
  on_every_host write_dotenv_files
  on_every_host check_mailpit_login
  on_every_host pull "$release_name"
  on_every_host free_ports
  on_every_host ensure_shared
  on_every_host prepare_shared_postgres
  on_every_host prepare_shared_valkey
  on_every_host start_other_services "$release_name"
  on_every_host create_databases "$release_name"
  on_every_host move_data
  on_every_host back_up "$release_name"
  on_every_host migrate "$release_name"
  on_every_host start_application "$release_name"
  on_every_host run_hook "$release_name" before-switch

  IS_SWITCHING=1

  on_every_host switch_current "$release_name"
  on_every_host start_rest "$release_name"
  on_every_host run_hook "$release_name" after-switch
  on_every_host stop_old_copies

  IS_SWITCHING=''

  on_every_host clean_up

  return 0
}

find_rollback_release() {
  host_entry=$1

  run_remote_script "$host_entry" "$DEPLOY_PATH" <<'SH'
set -eu

deploy_path=$1

cd "$deploy_path/releases"

current_release=$(basename "$(readlink ../current)")
is_past_current=''
newest_first=''

for release in *; do
  newest_first="$release $newest_first"
done

for release in $newest_first; do
  if [ "$release" = "$current_release" ]; then
    is_past_current=1
  elif [ -n "$is_past_current" ] && [ ! -f "$release/forge.bad" ]; then
    printf '%s\n' "$release"

    exit 0
  fi
done
SH
}

roll_back_host() {
  host_entry=$1

  require_current_release "$host_entry"

  left_release=$CURRENT_RELEASE
  rollback_release=$(find_rollback_release "$host_entry")

  if [ -z "$rollback_release" ]; then
    fail "\`$host_entry\` has no release before \`$left_release\` to roll back to."
  fi

  announce "$host_entry" "roll back to $rollback_release"
  mark_bad "$host_entry" "$left_release"

  if [ "$(get_value "$TARGET_VALUES_FILE" DEPLOY_ROLLBACK_RESTORE)" = 1 ]; then
    stop_image_services "$host_entry" "$left_release"
    restore "$host_entry" "$left_release" "$left_release"
  fi

  load_release "$host_entry" "$rollback_release"
  pull "$host_entry" "$rollback_release"
  start_application "$host_entry" "$rollback_release"
  switch_current "$host_entry" "$rollback_release"
  stop_old_copies "$host_entry"
  start_rest "$host_entry" "$rollback_release"
  run_hook "$host_entry" "$rollback_release" after-rollback

  return 0
}

restart_host() {
  host_entry=$1

  require_current_release "$host_entry"
  announce "$host_entry" "restart $CURRENT_RELEASE"

  if [ -n "$HAS_PROXY" ]; then
    roll_out "$host_entry" "$CURRENT_RELEASE"
    stop_old_copies "$host_entry"
  fi

  set --

  for service in $IMAGE_SERVICES; do
    if [ -z "$HAS_PROXY" ] || [ "$service" != "$APPLICATION_SERVICE" ]; then
      set -- "$@" "$service"
    fi
  done

  if [ "$#" -gt 0 ]; then
    compose_release "$host_entry" "$CURRENT_RELEASE" \
      up --detach --no-deps --wait --wait-timeout "$WAIT_TIMEOUT" --force-recreate "$@"
  fi

  return 0
}

restore_host() {
  host_entry=$1

  require_current_release "$host_entry"
  stop_image_services "$host_entry" "$CURRENT_RELEASE"
  restore "$host_entry" "$CURRENT_RELEASE" "$CURRENT_RELEASE"
  start_rest "$host_entry" "$CURRENT_RELEASE"
  run_hook "$host_entry" "$CURRENT_RELEASE" after-restore

  return 0
}

remove_host() {
  host_entry=$1
  current_release=$(get_current_release "$host_entry")

  set -- --remove-orphans

  if [ "$(get_value "$TARGET_VALUES_FILE" DEPLOY_REMOVE_DATA)" = 1 ]; then
    set -- "$@" --volumes
  fi

  if [ -n "$current_release" ]; then
    load_release "$host_entry" "$current_release"
    run_hook "$host_entry" "$current_release" before-remove
  fi

  announce "$host_entry" "remove $PROJECT_NAME"

  release_shared=''

  if [ -n "$current_release" ]; then
    release_shared=$(get_shared_services "$host_entry" "$current_release")

    compose_release "$host_entry" "$current_release" down "$@"
  fi

  if is_listed valkey "$release_shared" && has_valkey_acl "$host_entry"; then
    printf 'ACL DELUSER %s\nACL SAVE\n' "$PROJECT_NAME" | run_valkey_admin "$host_entry"
  fi

  run_remote "$host_entry" "rm -f $(quote_shell_words "$DEPLOY_PATH/current" "$DEPLOY_SHARED_PATH/sites/$PROJECT_NAME.caddyfile")"

  if run_remote "$host_entry" "[ -f $(quote_shell_word "$DEPLOY_SHARED_PATH/proxy/compose.yaml") ]"; then
    compose_shared "$host_entry" proxy exec -T proxy frankenphp reload --config /etc/frankenphp/Caddyfile || true
  fi

  if [ "$(get_value "$TARGET_VALUES_FILE" DEPLOY_REMOVE_DATA)" = 1 ]; then
    run_remote "$host_entry" "rm -rf $(quote_shell_words "${DEPLOY_PATH:?}/releases" "${DEPLOY_PATH:?}/shared")"
  fi

  return 0
}

recreate_shared() {
  RENDER_IMAGE=$UNUSED_IMAGE
  RECIPES=''

  render "$TARGET" shared

  if [ -z "$SHARED_SERVICES" ]; then
    fail "\`$TARGET\` shares nothing: its release includes no \`proxy\` and \`DEPLOY_SHARED_SERVICES\` is empty."
  fi

  on_every_host lock
  on_every_host check_layout
  on_every_host ensure_shared 1

  return 0
}

main() {
  action=${1:-}
  TARGET=${2:-}
  LOCKING_HOSTS=''
  LOCK_STAMP=$(get_stamp),$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')
  UPLOADED_HOSTS=''
  UPLOADED_RELEASE=''
  STARTED_APPLICATIONS=''
  REST_STARTED_HOSTS=''
  PULLED_HOSTS=''
  CURRENT_STEP=''
  IS_SWITCHING=''
  FREED_PORTS=''
  CREATED_PROXIES=''
  WORK_DIRECTORY=$(mktemp -d)
  DOTENV_BASE=${DEPLOY_DOTENV_BASE-.env}

  trap 'release_locks "$?"' EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM

  if [ -z "$DOTENV_BASE" ]; then
    fail "A deploy reads its targets from the env files, which \`DOTENV\` turns off."
  fi

  check_target "$TARGET"

  if [ "$action" = unlock ]; then
    read_connection_settings "$TARGET" 1
    on_every_host unlock

    return 0
  fi

  read_connection_settings "$TARGET" ''
  read_settings "$TARGET"

  case $action in
    deploy)
      deploy
    ;;

    rollback)
      on_every_host lock
      on_every_host check_layout
      on_every_host roll_back_host
    ;;

    restart)
      on_every_host lock
      on_every_host check_layout
      on_every_host restart_host
    ;;

    restore)
      on_every_host lock
      on_every_host check_layout
      on_every_host restore_host
    ;;

    shared)
      recreate_shared
    ;;

    remove)
      on_every_host lock
      on_every_host check_layout
      on_every_host remove_host
    ;;

    *)
      fail "Unknown action \`$action\`, expected \`deploy\`, \`rollback\`, \`restart\`, \`restore\`, \`remove\`, \`shared\`, or \`unlock\`."
    ;;
  esac

  return 0
}

main "$@"
