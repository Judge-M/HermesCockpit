#!/usr/bin/env sh
set -eu

HERMES_SOURCE=${1:?usage: verify-hermes-v0.21.7.sh PATH_TO_HERMES_SOURCE}
EXPECTED_COMMIT=71d34bad1045610252eda02ee79549436896e784

actual_commit=$(git -C "$HERMES_SOURCE" rev-parse HEAD)
if [ "$actual_commit" != "$EXPECTED_COMMIT" ]; then
  echo "Expected Hermes v0.21.7 commit $EXPECTED_COMMIT, found $actual_commit" >&2
  exit 1
fi

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
model_patch="$root/server/hermes-runtime-patches/semantic-routing-hooks.patch"
memory_patch="$root/server/hermes-runtime-patches/semantic-routing-memory-hooks.patch"
test_home=$(mktemp -d)

cleanup() {
  git -C "$HERMES_SOURCE" apply --reverse --check "$memory_patch" >/dev/null 2>&1 && git -C "$HERMES_SOURCE" apply --reverse "$memory_patch" || true
  git -C "$HERMES_SOURCE" apply --reverse --check "$model_patch" >/dev/null 2>&1 && git -C "$HERMES_SOURCE" apply --reverse "$model_patch" || true
  rm -rf "$test_home"
}
trap cleanup EXIT INT TERM

git -C "$HERMES_SOURCE" apply --check "$model_patch"
git -C "$HERMES_SOURCE" apply "$model_patch"
git -C "$HERMES_SOURCE" apply --check "$memory_patch"
git -C "$HERMES_SOURCE" apply "$memory_patch"
git -C "$HERMES_SOURCE" diff --check

python -m py_compile \
  "$HERMES_SOURCE/hermes_cli/middleware.py" \
  "$HERMES_SOURCE/tools/delegate_tool.py" \
  "$HERMES_SOURCE/agent/auxiliary_client.py" \
  "$HERMES_SOURCE/agent/memory_manager.py"

grep -q 'MODEL_ROUTE_MIDDLEWARE' "$HERMES_SOURCE/hermes_cli/middleware.py"
grep -q 'MEMORY_ROUTE_MIDDLEWARE' "$HERMES_SOURCE/hermes_cli/middleware.py"

git -C "$HERMES_SOURCE" apply --reverse "$memory_patch"
git -C "$HERMES_SOURCE" apply --reverse "$model_patch"

HERMES_HOME="$test_home" HERMES_SOURCE="$HERMES_SOURCE" "$root/scripts/install-hermes-extension.sh" --dry-run
HERMES_HOME="$test_home" HERMES_SOURCE="$HERMES_SOURCE" "$root/scripts/install-hermes-extension.sh"
HERMES_HOME="$test_home" HERMES_SOURCE="$HERMES_SOURCE" "$root/scripts/hermes-cockpit-doctor.sh"
HERMES_HOME="$test_home" HERMES_SOURCE="$HERMES_SOURCE" "$root/scripts/install-hermes-extension.sh"
find "$test_home/plugins" -maxdepth 1 -type d -name 'judge-m-control-plane.backup-*' -print -quit | grep -q .
HERMES_HOME="$test_home" HERMES_SOURCE="$HERMES_SOURCE" "$root/scripts/uninstall-hermes-extension.sh"
test ! -e "$test_home/plugins/judge-m-control-plane"
git -C "$HERMES_SOURCE" diff --exit-code

echo "PASS: patches and transactional install, doctor, repeat install, backup, and uninstall on official Hermes v0.21.7 ($EXPECTED_COMMIT)"
