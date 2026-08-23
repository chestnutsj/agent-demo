#!/usr/bin/env bash
#
# mysql_query.sh — the single execution path for this pack.
#
# Every statement this pack runs goes through here — the MCP tool is the only
# caller, and it is the only model-facing path to a database. One script means
# one place where connection handling and credential hygiene live.
#
# Connection settings come from the environment, with localhost defaults:
#   MYSQL_HOST (127.0.0.1)  MYSQL_PORT (3306)  MYSQL_USER (root)
#   MYSQL_PASSWORD ("")     MYSQL_DATABASE (mysql)
#
# Exit codes:
#   0  the statement ran
#   1  the server answered with an error (bad SQL, missing table, denied)
#   2  usage error
#   3  OFFLINE — the server could not be reached at all. Instead of a bare
#      failure the script prints a RELAY BLOCK: the statement, formatted for a
#      human to run elsewhere and paste back. A DBA agent with no direct
#      connection is still useful; one that just reports "connection refused"
#      is not.
#
# Usage:  mysql_query.sh "SELECT NOW();"
#     or: DBA_SQL="SHOW DATABASES;" mysql_query.sh
set -uo pipefail

SQL="${1:-${DBA_SQL:-}}"
if [[ -z "${SQL}" ]]; then
  echo "usage: mysql_query.sh '<SQL statement>'" >&2
  exit 2
fi

# Print the relay block and exit. The second argument is the statement list to
# relay: one statement here, the whole evidence walk when src/core/mysql.ts
# renders its own block after this script reports OFFLINE for the first step.
dba_offline_relay() {
  local reason="$1" statements="$2"
  cat <<RELAY
DBA_OFFLINE: ${reason}

这台机器连不到数据库。请在能连到数据库的机器上执行下面的语句，并把输出贴回来。
不要重试本脚本，也不要凭假设作答——分析将从你贴回的结果继续。

--- 请执行 ---
${statements}
--- 结束 ---
RELAY
  exit 3
}

if ! command -v mysql >/dev/null 2>&1; then
  dba_offline_relay "本机没有安装 mysql 客户端" "${SQL}"
fi

args=(
  --host="${MYSQL_HOST:-127.0.0.1}"
  --port="${MYSQL_PORT:-3306}"
  --user="${MYSQL_USER:-root}"
  --database="${MYSQL_DATABASE:-mysql}"
  --table            # readable ASCII-table output for humans and agents
  --connect-timeout=10
)

# The password goes through MYSQL_PWD rather than --password: a command line is
# world-readable in `ps`, and a DBA tool that leaks the production password to
# every local process is not one worth shipping.
if [[ -n "${MYSQL_PASSWORD:-}" ]]; then
  export MYSQL_PWD="${MYSQL_PASSWORD}"
fi

output="$(mysql "${args[@]}" --execute="${SQL}" 2>&1)"
status=$?

# Distinguish "cannot reach the server" from "the server said no". Only the
# former is worth relaying to a human; a syntax error relayed to a DBA is noise.
#   2002/2003/2005 connect  2006/2013 lost connection  1044/1045 access denied
if [[ ${status} -ne 0 ]] && grep -qE 'ERROR (2002|2003|2005|2006|2013|1044|1045)' <<<"${output}"; then
  dba_offline_relay "$(head -n 1 <<<"${output}")" "${SQL}"
fi

printf '%s\n' "${output}"
exit ${status}
