#!/usr/bin/env bash
#
# query.sh — the shared core of this plugin.
#
# Runs a single SQL statement against MySQL using the `mysql` command-line
# client. Both entry points call this script:
#   - the `mysql-query` skill (an operator/agent runs it via the shell), and
#   - the `mysql_query` MCP tool (mcp/server.mjs spawns it).
#
# Connection settings come from the environment, with localhost defaults:
#   MYSQL_HOST (127.0.0.1)  MYSQL_PORT (3306)  MYSQL_USER (root)
#   MYSQL_PASSWORD ("")     MYSQL_DATABASE (mysql)
#
# Usage:  query.sh "SELECT NOW();"
#     or: DBA_SQL="SHOW DATABASES;" query.sh
set -euo pipefail

SQL="${1:-${DBA_SQL:-}}"
if [[ -z "${SQL}" ]]; then
  echo "usage: query.sh '<SQL statement>'" >&2
  exit 2
fi

args=(
  --host="${MYSQL_HOST:-127.0.0.1}"
  --port="${MYSQL_PORT:-3306}"
  --user="${MYSQL_USER:-root}"
  --database="${MYSQL_DATABASE:-mysql}"
  --table          # readable ASCII-table output for humans and agents
)
# Only pass --password when one is set, so an empty password still works.
if [[ -n "${MYSQL_PASSWORD:-}" ]]; then
  args+=(--password="${MYSQL_PASSWORD}")
fi

exec mysql "${args[@]}" --execute="${SQL}"
