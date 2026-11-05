#!/bin/sh

set -eu

create_user() {
  user_name=$1
  user_id=$2
  group_id=$3

  if id bun >/dev/null 2>&1; then
    userdel --remove bun
  fi

  groupadd --gid "$group_id" "$user_name"

  useradd \
    --uid "$user_id" \
    --gid "$group_id" \
    --no-create-home \
    --home-dir /home/forge \
    "$user_name"

  mkdir -p /cache /home/forge
  chmod 1777 /cache /home/forge

  return 0
}

create_user "$@"
