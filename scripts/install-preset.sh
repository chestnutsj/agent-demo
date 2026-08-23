#!/usr/bin/env bash
#
# install-preset.sh — copy the `dba` agent preset into the user preset root.
#
# A preset root is not something a bundle can contribute: the CLI's profile
# boot REPLACES the roster's `roots` with the shipped root
# (apps/cli/src/profile-boot.ts), so a root injected from a bundle patch would
# be overwritten. The writable root is `$DSH_HOME/.agent-presets`, and the
# supported way to author a preset is to place a directory in it — which is
# all this script does.
#
# Usage:  bash scripts/install-preset.sh [--force]
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../presets/dba" && pwd)"
TARGET_ROOT="${DSH_HOME:-${HOME}/.dsh}/.agent-presets"
TARGET_DIR="${TARGET_ROOT}/dba"

FORCE=0
if [[ "${1:-}" == "--force" ]]; then
  FORCE=1
elif [[ -n "${1:-}" ]]; then
  echo "usage: install-preset.sh [--force]" >&2
  exit 2
fi

if [[ -e "${TARGET_DIR}" && "${FORCE}" -eq 0 ]]; then
  echo "preset already installed at ${TARGET_DIR}" >&2
  echo "re-run with --force to overwrite it, or edit it in place — that directory is the live composition." >&2
  exit 1
fi

mkdir -p "${TARGET_ROOT}"
rm -rf "${TARGET_DIR}"
cp -R "${SOURCE_DIR}" "${TARGET_DIR}"

# The roster tightens its own copies to owner-only; match that here so an
# installed preset does not sit looser than an authored one.
chmod -R u+rwX,go-rwx "${TARGET_DIR}"

echo "installed the \"dba\" preset into ${TARGET_DIR}"
echo
echo "next:"
echo "  dsh --profile <name>        then pick \"SQL 优化模式\" for a NEW session"
echo
echo "note: this is a COPY. Editing ${SOURCE_DIR} afterwards changes nothing;"
echo "      edit the installed directory, or re-run with --force."
