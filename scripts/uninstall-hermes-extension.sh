#!/usr/bin/env sh
set -eu

EXPECTED_HERMES_VERSION=0.21.7
EXPECTED_HERMES_COMMIT=71d34bad1045610252eda02ee79549436896e784
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
HERMES_HOME=${HERMES_HOME:-"$HOME/.hermes"}
HERMES_SOURCE=${HERMES_SOURCE:-"$HERMES_HOME/hermes-agent"}
REMOVE_PATCHES=1
REMOVE_PLUGIN=1
DRY_RUN=0

usage() {
    cat <<'EOF'
Safely uninstall the Hermes Cockpit extension.

Usage: scripts/uninstall-hermes-extension.sh [options]

Options:
  --hermes-home PATH    Hermes data directory (default: ~/.hermes)
  --hermes-source PATH  Official Hermes Agent v0.21.7 source checkout
  --keep-patches        Leave recognized runtime patches applied
  --keep-plugin         Leave the installed plugin in place
  --dry-run             Validate and describe changes without modifying anything
  -h, --help            Show this help

The plugin is moved to a timestamped recovery path, not deleted. Only exact,
recognized Cockpit patches are reversed. User configuration and data are never
removed.
EOF
}

die() { echo "ERROR: $*" >&2; exit 1; }
path_exists() { [ -e "$1" ] || [ -L "$1" ]; }

detect_hermes_version() {
    tags=$(git -C "$HERMES_SOURCE" tag --points-at HEAD 2>/dev/null || :)
    for tag in $tags; do
        case "$tag" in
            "v$EXPECTED_HERMES_VERSION"|"$EXPECTED_HERMES_VERSION") printf '%s\n' "$EXPECTED_HERMES_VERSION"; return 0 ;;
        esac
    done
    for version_file in pyproject.toml hermes_cli/__init__.py hermes_cli/version.py; do
        [ -f "$HERMES_SOURCE/$version_file" ] || continue
        version=$(sed -n "s/^[[:space:]]*\(__version__\|version\)[[:space:]]*=[[:space:]]*['\"]\([^'\"]*\)['\"].*/\2/p" "$HERMES_SOURCE/$version_file" | sed -n '1p')
        if [ -n "$version" ]; then printf '%s\n' "$version"; return 0; fi
    done
    return 1
}

patch_state() {
    patch_file=$1
    if git -C "$HERMES_SOURCE" apply --reverse --check "$patch_file" >/dev/null 2>&1; then printf '%s\n' applied
    elif git -C "$HERMES_SOURCE" apply --check "$patch_file" >/dev/null 2>&1; then printf '%s\n' unapplied
    else printf '%s\n' drifted
    fi
}

model_patch_state_without_memory_overlay() {
    scratch_dir=$(mktemp -d "${TMPDIR:-/tmp}/hermes-cockpit-model-check.XXXXXX") || {
        printf '%s\n' drifted
        return 0
    }
    copy_failed=0
    for patch_file in "$MODEL_PATCH" "$MEMORY_PATCH" "$OWNER_PATCH" "$BROWSER_PATCH"; do
        patch_applied=0
        if git -C "$HERMES_SOURCE" apply --reverse --check "$patch_file" >/dev/null 2>&1; then patch_applied=1; fi
        patch_paths=$(git apply --numstat "$patch_file" 2>/dev/null | sed -n 's/^[0-9-][0-9-]*[[:space:]][0-9-][0-9]*[[:space:]]//p')
        while IFS= read -r relative_path; do
            [ -n "$relative_path" ] || continue
            case "$relative_path" in */*) parent_dir=${relative_path%/*} ;; *) parent_dir=. ;; esac
            if [ ! -f "$HERMES_SOURCE/$relative_path" ]; then
                if [ "$patch_file" = "$MODEL_PATCH" ] || [ "$patch_file" = "$MEMORY_PATCH" ] || [ "$patch_applied" -eq 1 ]; then copy_failed=1; fi
                continue
            fi
            if ! mkdir -p "$scratch_dir/$parent_dir" || ! cp "$HERMES_SOURCE/$relative_path" "$scratch_dir/$relative_path"; then
                copy_failed=1
            fi
        done <<EOF
$patch_paths
EOF
    done
    if [ "$copy_failed" -ne 0 ]; then
        rm -rf "$scratch_dir"
        printf '%s\n' drifted
        return 0
    fi
    for overlay_patch in "$BROWSER_PATCH" "$OWNER_PATCH" "$MEMORY_PATCH"; do
        if git -C "$HERMES_SOURCE" apply --reverse --check "$overlay_patch" >/dev/null 2>&1 &&
            ! (CDPATH= cd "$scratch_dir" && git apply --reverse --check "$overlay_patch" >/dev/null 2>&1 && git apply --reverse "$overlay_patch" >/dev/null 2>&1); then
            rm -rf "$scratch_dir"
            printf '%s\n' drifted
            return 0
        fi
    done
    if (CDPATH= cd "$scratch_dir" && git apply --reverse --check "$MODEL_PATCH" >/dev/null 2>&1); then
        state=applied
    elif (CDPATH= cd "$scratch_dir" && git apply --check "$MODEL_PATCH" >/dev/null 2>&1); then
        state=unapplied
    else
        state=drifted
    fi
    rm -rf "$scratch_dir"
    printf '%s\n' "$state"
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --hermes-home) [ "$#" -ge 2 ] || die "Missing value for --hermes-home"; HERMES_HOME=$2; shift 2 ;;
        --hermes-source) [ "$#" -ge 2 ] || die "Missing value for --hermes-source"; HERMES_SOURCE=$2; shift 2 ;;
        --keep-patches) REMOVE_PATCHES=0; shift ;;
        --keep-plugin) REMOVE_PLUGIN=0; shift ;;
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
done

[ "$(uname -s 2>/dev/null || :)" = Linux ] || die "Hermes Cockpit uninstallation is supported only on Linux"
for command_name in git sed tr cp mv mkdir rm mktemp date; do command -v "$command_name" >/dev/null 2>&1 || die "$command_name is required"; done
[ "$(git -C "$HERMES_SOURCE" rev-parse --is-inside-work-tree 2>/dev/null || :)" = true ] || die "Hermes source must be an official git checkout: $HERMES_SOURCE"

remote=$(git -C "$HERMES_SOURCE" remote get-url origin 2>/dev/null || :)
remote_lower=$(printf '%s' "$remote" | tr '[:upper:]' '[:lower:]')
case "$remote_lower" in
    *github.com/nousresearch/hermes-agent|*github.com/nousresearch/hermes-agent.git|*github.com:nousresearch/hermes-agent|*github.com:nousresearch/hermes-agent.git) ;;
    *) die "Hermes origin is not the official NousResearch/hermes-agent repository: ${remote:-<missing>}" ;;
esac
version=$(detect_hermes_version || :)
[ "$version" = "$EXPECTED_HERMES_VERSION" ] || die "Hermes v$EXPECTED_HERMES_VERSION is required; detected ${version:-unknown}"
commit=$(git -C "$HERMES_SOURCE" rev-parse HEAD 2>/dev/null || :)
[ "$commit" = "$EXPECTED_HERMES_COMMIT" ] || die "Hermes commit $EXPECTED_HERMES_COMMIT is required; detected ${commit:-unknown}"

PLUGIN_TARGET="$HERMES_HOME/plugins/judge-m-control-plane"
LOCK_DIR="$HERMES_HOME/.hermes-cockpit-install.lock"
MODEL_PATCH="$REPO_DIR/server/hermes-runtime-patches/semantic-routing-hooks.patch"
MEMORY_PATCH="$REPO_DIR/server/hermes-runtime-patches/semantic-routing-memory-hooks.patch"
OWNER_PATCH="$REPO_DIR/server/hermes-runtime-patches/hosted-plugin-owner-scope.patch"
BROWSER_PATCH="$REPO_DIR/server/hermes-runtime-patches/browser-preview-gateway.patch"
for patch_file in "$MODEL_PATCH" "$MEMORY_PATCH" "$OWNER_PATCH" "$BROWSER_PATCH"; do [ -f "$patch_file" ] || die "Runtime patch is missing: $patch_file"; done

MEMORY_STATE=$(patch_state "$MEMORY_PATCH")
if [ "$MEMORY_STATE" = applied ]; then MODEL_STATE=$(model_patch_state_without_memory_overlay); else MODEL_STATE=$(patch_state "$MODEL_PATCH"); fi
if [ "$MODEL_STATE" = unapplied ] && [ "$MEMORY_STATE" = drifted ]; then MEMORY_STATE=pending-after-model-patch; fi
OWNER_STATE=$(patch_state "$OWNER_PATCH")
BROWSER_STATE=$(patch_state "$BROWSER_PATCH")
if [ "$REMOVE_PATCHES" -eq 1 ]; then
    [ "$MODEL_STATE" != drifted ] || die "Refusing to alter drifted model-routing patch state"
    [ "$MEMORY_STATE" != drifted ] || die "Refusing to alter drifted memory-routing patch state"
    [ "$OWNER_STATE" != drifted ] || die "Refusing to alter drifted hosted-plugin owner patch state"
    [ "$BROWSER_STATE" != drifted ] || die "Refusing to alter drifted browser preview gateway patch state"
fi

echo "Preflight passed: official Hermes Agent v$EXPECTED_HERMES_VERSION"
echo "Model patch:  $MODEL_STATE"
echo "Memory patch: $MEMORY_STATE"
echo "Owner patch:  $OWNER_STATE"
echo "Browser patch: $BROWSER_STATE"
if [ "$DRY_RUN" -eq 1 ]; then
    if [ "$REMOVE_PATCHES" -eq 1 ]; then
        [ "$BROWSER_STATE" = applied ] && echo "DRY RUN: would reverse browser preview gateway patch"
        [ "$OWNER_STATE" = applied ] && echo "DRY RUN: would reverse hosted-plugin owner patch"
        [ "$MEMORY_STATE" = applied ] && echo "DRY RUN: would reverse memory-routing patch"
        case "$MODEL_STATE" in applied) echo "DRY RUN: would reverse model-routing patch" ;; esac
    else echo "DRY RUN: would leave runtime patches unchanged"; fi
    if [ "$REMOVE_PLUGIN" -eq 1 ] && path_exists "$PLUGIN_TARGET"; then echo "DRY RUN: would move $PLUGIN_TARGET to a timestamped recovery path";
    elif [ "$REMOVE_PLUGIN" -eq 0 ]; then echo "DRY RUN: would leave plugin unchanged";
    else echo "DRY RUN: plugin is not installed"; fi
    exit 0
fi

mkdir -p "$HERMES_HOME"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then die "Another Hermes Cockpit install or uninstall may be running (lock: $LOCK_DIR)"; fi

COMMITTED=0
MEMORY_REVERSED_NOW=0
MODEL_REVERSED_NOW=0
OWNER_REVERSED_NOW=0
BROWSER_REVERSED_NOW=0
PLUGIN_MOVED_NOW=0
RECOVERY=""

rollback() {
    echo "Uninstall did not complete; restoring changes from this run" >&2
    if [ "$PLUGIN_MOVED_NOW" -eq 1 ] && path_exists "$RECOVERY" && ! path_exists "$PLUGIN_TARGET"; then
        if mv "$RECOVERY" "$PLUGIN_TARGET"; then echo "Restored the installed plugin" >&2;
        else echo "WARNING: could not restore plugin from $RECOVERY" >&2; fi
    fi
    if [ "$MODEL_REVERSED_NOW" -eq 1 ]; then
        if git -C "$HERMES_SOURCE" apply "$MODEL_PATCH"; then echo "Restored model-routing patch" >&2;
        else echo "WARNING: could not restore $MODEL_PATCH" >&2; fi
    fi
    if [ "$MEMORY_REVERSED_NOW" -eq 1 ]; then
        if git -C "$HERMES_SOURCE" apply "$MEMORY_PATCH"; then echo "Restored memory-routing patch" >&2;
        else echo "WARNING: could not restore $MEMORY_PATCH" >&2; fi
    fi
    if [ "$OWNER_REVERSED_NOW" -eq 1 ]; then
        if git -C "$HERMES_SOURCE" apply "$OWNER_PATCH"; then echo "Restored hosted-plugin owner patch" >&2;
        else echo "WARNING: could not restore $OWNER_PATCH" >&2; fi
    fi
    if [ "$BROWSER_REVERSED_NOW" -eq 1 ]; then
        if git -C "$HERMES_SOURCE" apply "$BROWSER_PATCH"; then echo "Restored browser preview gateway patch" >&2;
        else echo "WARNING: could not restore $BROWSER_PATCH" >&2; fi
    fi
}

cleanup() {
    status=$?
    trap - 0 HUP INT TERM
    if [ "$COMMITTED" -ne 1 ]; then rollback; fi
    rmdir "$LOCK_DIR" 2>/dev/null || :
    exit "$status"
}
trap cleanup 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$REMOVE_PATCHES" -eq 1 ]; then
    if [ "$BROWSER_STATE" = applied ]; then
        git -C "$HERMES_SOURCE" apply --reverse "$BROWSER_PATCH"
        BROWSER_REVERSED_NOW=1
        echo "Reversed browser preview gateway patch"
    fi
    if [ "$OWNER_STATE" = applied ]; then
        git -C "$HERMES_SOURCE" apply --reverse "$OWNER_PATCH"
        OWNER_REVERSED_NOW=1
        echo "Reversed hosted-plugin owner patch"
    fi
    if [ "$MEMORY_STATE" = applied ]; then
        git -C "$HERMES_SOURCE" apply --reverse "$MEMORY_PATCH"
        MEMORY_REVERSED_NOW=1
        echo "Reversed memory-routing patch"
    fi
    case "$MODEL_STATE" in
      applied|applied-below-memory)
        git -C "$HERMES_SOURCE" apply --reverse "$MODEL_PATCH"
        MODEL_REVERSED_NOW=1
        echo "Reversed model-routing patch"
        ;;
    esac
fi

if [ "$REMOVE_PLUGIN" -eq 1 ] && path_exists "$PLUGIN_TARGET"; then
    RECOVERY="$PLUGIN_TARGET.removed-$(date +%Y%m%d%H%M%S)-$$"
    path_exists "$RECOVERY" && die "Plugin recovery path already exists: $RECOVERY"
    mv "$PLUGIN_TARGET" "$RECOVERY"
    PLUGIN_MOVED_NOW=1
    echo "Moved the plugin to recoverable location: $RECOVERY"
elif [ "$REMOVE_PLUGIN" -eq 1 ]; then
    echo "Plugin is not installed; nothing to move"
fi

COMMITTED=1
echo "Hermes Cockpit extension uninstall is complete. User data was not changed."
