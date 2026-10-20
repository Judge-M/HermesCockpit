#!/usr/bin/env sh
set -eu

HERMES_SOURCE=${1:?usage: verify-runtime-patch-state.sh PATH_TO_HERMES_SOURCE}
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/hermes-cockpit-patch-state.XXXXXX")
FIXTURE_SOURCE="$TEST_ROOT/hermes-agent"
HERMES_HOME="$TEST_ROOT/hermes-home"

cleanup() {
    rm -rf "$TEST_ROOT"
}
trap cleanup EXIT HUP INT TERM

MODEL_PATCH="$ROOT/server/hermes-runtime-patches/semantic-routing-hooks.patch"
MEMORY_PATCH="$ROOT/server/hermes-runtime-patches/semantic-routing-memory-hooks.patch"
OWNER_PATCH="$ROOT/server/hermes-runtime-patches/hosted-plugin-owner-scope.patch"
BROWSER_PATCH="$ROOT/server/hermes-runtime-patches/browser-preview-gateway.patch"
for patch_file in "$MODEL_PATCH" "$MEMORY_PATCH" "$OWNER_PATCH" "$BROWSER_PATCH"; do
    [ -f "$patch_file" ] || { echo "Missing runtime patch: $patch_file" >&2; exit 1; }
done

git clone --shared --no-checkout "$HERMES_SOURCE" "$FIXTURE_SOURCE" >/dev/null
git -C "$FIXTURE_SOURCE" remote set-url origin https://github.com/NousResearch/hermes-agent.git

checkout_paths=""
for patch_file in "$MODEL_PATCH" "$MEMORY_PATCH" "$OWNER_PATCH" "$BROWSER_PATCH"; do
    patch_paths=$(git apply --numstat "$patch_file" | sed -n 's/^[0-9-][0-9-]*[[:space:]][0-9-][0-9]*[[:space:]]//p')
    for relative_path in $patch_paths; do
        if git -C "$FIXTURE_SOURCE" cat-file -e "HEAD:$relative_path" 2>/dev/null; then
            checkout_paths="$checkout_paths $relative_path"
        fi
    done
done
git -C "$FIXTURE_SOURCE" sparse-checkout init --no-cone
git -C "$FIXTURE_SOURCE" sparse-checkout set --no-cone $checkout_paths >/dev/null
git -C "$FIXTURE_SOURCE" checkout HEAD -- $checkout_paths

git -C "$FIXTURE_SOURCE" apply "$MODEL_PATCH"
git -C "$FIXTURE_SOURCE" apply "$MEMORY_PATCH"
git -C "$FIXTURE_SOURCE" apply "$OWNER_PATCH"
git -C "$FIXTURE_SOURCE" apply "$BROWSER_PATCH"
mkdir -p "$HERMES_HOME/plugins"
cp -R "$ROOT/server/judge-m-control-plane" "$HERMES_HOME/plugins/judge-m-control-plane"

assert_output() {
    output_file=$1
    expected=$2
    grep -F "$expected" "$output_file" >/dev/null || {
        echo "Expected output to contain: $expected" >&2
        cat "$output_file" >&2
        exit 1
    }
}

git -C "$FIXTURE_SOURCE" diff --binary > "$TEST_ROOT/full-before.diff"
HERMES_HOME="$HERMES_HOME" HERMES_SOURCE="$FIXTURE_SOURCE" \
    sh "$ROOT/scripts/install-hermes-extension.sh" --dry-run > "$TEST_ROOT/install-full.out" 2>&1
assert_output "$TEST_ROOT/install-full.out" 'Model patch:   applied'
assert_output "$TEST_ROOT/install-full.out" 'Memory patch:  applied'
assert_output "$TEST_ROOT/install-full.out" 'Owner patch:   applied'
assert_output "$TEST_ROOT/install-full.out" 'Browser patch: applied'

HERMES_HOME="$HERMES_HOME" HERMES_SOURCE="$FIXTURE_SOURCE" \
    sh "$ROOT/scripts/hermes-cockpit-doctor.sh" > "$TEST_ROOT/doctor-full.out" 2>&1
assert_output "$TEST_ROOT/doctor-full.out" 'PASS: model-routing patch is applied'
assert_output "$TEST_ROOT/doctor-full.out" 'PASS: browser preview gateway patch is applied'

HERMES_HOME="$HERMES_HOME" HERMES_SOURCE="$FIXTURE_SOURCE" \
    sh "$ROOT/scripts/uninstall-hermes-extension.sh" --dry-run --keep-patches > "$TEST_ROOT/uninstall-full.out" 2>&1
assert_output "$TEST_ROOT/uninstall-full.out" 'Model patch:  applied'
assert_output "$TEST_ROOT/uninstall-full.out" 'Browser patch: applied'

git -C "$FIXTURE_SOURCE" diff --binary > "$TEST_ROOT/full-after.diff"
cmp "$TEST_ROOT/full-before.diff" "$TEST_ROOT/full-after.diff"

# Keep middleware/model and all overlay patches applied, but remove only the
# delegate hunk. Memory reverse checks alone must not call this healthy.
git -C "$FIXTURE_SOURCE" apply --reverse --include=tools/delegate_tool.py "$MODEL_PATCH"
git -C "$FIXTURE_SOURCE" diff --binary > "$TEST_ROOT/broken-before.diff"

if HERMES_HOME="$HERMES_HOME" HERMES_SOURCE="$FIXTURE_SOURCE" \
    sh "$ROOT/scripts/install-hermes-extension.sh" --dry-run > "$TEST_ROOT/install-broken.out" 2>&1; then
    echo 'Installer accepted a model patch with the delegate hook removed' >&2
    cat "$TEST_ROOT/install-broken.out" >&2
    exit 1
fi
assert_output "$TEST_ROOT/install-broken.out" 'Model-routing patch is neither cleanly applied nor applicable'

if HERMES_HOME="$HERMES_HOME" HERMES_SOURCE="$FIXTURE_SOURCE" \
    sh "$ROOT/scripts/hermes-cockpit-doctor.sh" > "$TEST_ROOT/doctor-broken.out" 2>&1; then
    echo 'Doctor accepted a model patch with the delegate hook removed' >&2
    cat "$TEST_ROOT/doctor-broken.out" >&2
    exit 1
fi
assert_output "$TEST_ROOT/doctor-broken.out" 'FAIL: model-routing patch state is drifted'

if HERMES_HOME="$HERMES_HOME" HERMES_SOURCE="$FIXTURE_SOURCE" \
    sh "$ROOT/scripts/uninstall-hermes-extension.sh" --dry-run > "$TEST_ROOT/uninstall-broken.out" 2>&1; then
    echo 'Uninstaller accepted a model patch with the delegate hook removed' >&2
    cat "$TEST_ROOT/uninstall-broken.out" >&2
    exit 1
fi
assert_output "$TEST_ROOT/uninstall-broken.out" 'Refusing to alter drifted model-routing patch state'

git -C "$FIXTURE_SOURCE" diff --binary > "$TEST_ROOT/broken-after.diff"
cmp "$TEST_ROOT/broken-before.diff" "$TEST_ROOT/broken-after.diff"

echo 'PASS: full layered patch state is recognized and incomplete model routing is rejected read-only'
