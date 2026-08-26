#!/usr/bin/env bash
set -euo pipefail

SQL="${1:-}"
if [[ -z "${SQL}" ]]; then
  echo "usage: mysql_query.sh '<SQL statement>'" >&2
  exit 2
fi

args=(
  --host="${MYSQL_HOST:-127.0.0.1}"
  --port="${MYSQL_PORT:-3306}"
  --user="${MYSQL_USER:-root}"
  --database="${MYSQL_DATABASE:-mysql}"
  --table
)
if [[ -n "${MYSQL_PASSWORD:-}" ]]; then
  args+=(--password="${MYSQL_PASSWORD}")
fi

exec mysql "${args[@]}" --execute="${SQL}"
