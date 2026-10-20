#!/usr/bin/env sh
set -eu

EXPECTED_HERMES_VERSION=0.21.7
EXPECTED_HERMES_COMMIT=71d34bad1045610252eda02ee79549436896e784
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
HERMES_HOME=${HERMES_HOME:-"$HOME/.hermes"}
HERMES_SOURCE=${HERMES_SOURCE:-"$HERMES_HOME/hermes-agent"}
APPLY_PATCHES=1
DRY_RUN=0

usage() {
    cat <<'EOF'
Install the Hermes Cockpit extension for official Hermes Agent v0.21.7.

Usage: scripts/install-hermes-extension.sh [options]

Options:
  --hermes-home PATH    Hermes data directory (default: ~/.hermes)
  --hermes-source PATH  Official Hermes Agent v0.21.7 source checkout
  --skip-patches        Install only the plugin; leave runtime patches unchanged
  --dry-run             Validate and describe changes without modifying anything
  -h, --help            Show this help

The install is transactional. If a later step fails, patches applied by this run
are reversed and the previous plugin is restored. Existing plugin backups are
retained beside the installed plugin.
EOF
}

die() { echo "ERROR: $*" >&2; exit 1; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }
path_exists() { [ -e "$1" ] || [ -L "$1" ]; }

detect_hermes_version() {
    tags=$(git -C "$HERMES_SOURCE" tag --points-at HEAD 2>/dev/null || :)
    for tag in $tags; do
        case "$tag" in
            "v$EXPECTED_HERMES_VERSION"|"$EXPECTED_HERMES_VERSION")
                printf '%s\n' "$EXPECTED_HERMES_VERSION"
                return 0
                ;;
        esac
    done
    for version_file in pyproject.toml hermes_cli/__init__.py hermes_cli/version.py; do
        [ -f "$HERMES_SOURCE/$version_file" ] || continue
        version=$(sed -n "s/^[[:space:]]*\(__version__\|version\)[[:space:]]*=[[:space:]]*['\"]\([^'\"]*\)['\"].*/\2/p" "$HERMES_SOURCE/$version_file" | sed -n '1p')
        if [ -n "$version" ]; then
            printf '%s\n' "$version"
            return 0
        fi
    done
    return 1
}

verify_official_source() {
    [ "$(git -C "$HERMES_SOURCE" rev-parse --is-inside-work-tree 2>/dev/null || :)" = true ] || die "Hermes source must be an official git checkout: $HERMES_SOURCE"
    remote=$(git -C "$HERMES_SOURCE" remote get-url origin 2>/dev/null || :)
    remote_lower=$(printf '%s' "$remote" | tr '[:upper:]' '[:lower:]')
    case "$remote_lower" in
        *github.com/nousresearch/hermes-agent|*github.com/nousresearch/hermes-agent.git|*github.com:nousresearch/hermes-agent|*github.com:nousresearch/hermes-agent.git) ;;
        *) die "Hermes origin is not the official NousResearch/hermes-agent repository: ${remote:-<missing>}" ;;
    esac
    commit=$(git -C "$HERMES_SOURCE" rev-parse HEAD 2>/dev/null || :)
    [ "$commit" = "$EXPECTED_HERMES_COMMIT" ] || die "Hermes v$EXPECTED_HERMES_VERSION commit $EXPECTED_HERMES_COMMIT is required; detected ${commit:-unknown}"
    version=$(detect_hermes_version || :)
    [ "$version" = "$EXPECTED_HERMES_VERSION" ] || die "Hermes v$EXPECTED_HERMES_VERSION is required; detected ${version:-unknown} at $HERMES_SOURCE"
    for required_path in hermes_cli/middleware.py tools/delegate_tool.py agent/auxiliary_client.py agent/memory_manager.py hermes_cli/web_server_dashboard.py hermes_cli/plugin_host_child.py; do
        [ -f "$HERMES_SOURCE/$required_path" ] || die "Hermes source is incomplete; missing $required_path"
    done
}

patch_state() {
    patch_file=$1
    if git -C "$HERMES_SOURCE" apply --reverse --check "$patch_file" >/dev/null 2>&1; then
        printf '%s\n' applied
    elif git -C "$HERMES_SOURCE" apply --check "$patch_file" >/dev/null 2>&1; then
        printf '%s\n' unapplied
    else
        printf '%s\n' drifted
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
        --hermes-home)
            [ "$#" -ge 2 ] || die "Missing value for --hermes-home"
            HERMES_HOME=$2; shift 2
            ;;
        --hermes-source)
            [ "$#" -ge 2 ] || die "Missing value for --hermes-source"
            HERMES_SOURCE=$2; shift 2
            ;;
        --skip-patches) APPLY_PATCHES=0; shift ;;
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
done

[ "$(uname -s 2>/dev/null || :)" = Linux ] || die "Hermes Cockpit installation is supported only on Linux"
for command_name in git sed tr cp mv mkdir rm mktemp date; do require_command "$command_name"; done

PLUGIN_SOURCE="$REPO_DIR/server/judge-m-control-plane"
PLUGIN_PARENT="$HERMES_HOME/plugins"
PLUGIN_TARGET="$PLUGIN_PARENT/judge-m-control-plane"
PLUGIN_STAGE="$PLUGIN_PARENT/.judge-m-control-plane.install.$$"
LOCK_DIR="$HERMES_HOME/.hermes-cockpit-install.lock"
MODEL_PATCH="$REPO_DIR/server/hermes-runtime-patches/semantic-routing-hooks.patch"
MEMORY_PATCH="$REPO_DIR/server/hermes-runtime-patches/semantic-routing-memory-hooks.patch"
OWNER_PATCH="$REPO_DIR/server/hermes-runtime-patches/hosted-plugin-owner-scope.patch"
BROWSER_PATCH="$REPO_DIR/server/hermes-runtime-patches/browser-preview-gateway.patch"

for plugin_file in plugin.yaml __init__.py semantic_routing.py routing_state.py dashboard/__init__.py dashboard/cli_bridge.py dashboard/manifest.json dashboard/plugin_api.py; do
    [ -f "$PLUGIN_SOURCE/$plugin_file" ] || die "Plugin source is incomplete; missing $plugin_file"
done
for patch_file in "$MODEL_PATCH" "$MEMORY_PATCH" "$OWNER_PATCH" "$BROWSER_PATCH"; do
    [ -f "$patch_file" ] || die "Runtime patch is missing: $patch_file"
done
verify_official_source

MEMORY_STATE=$(patch_state "$MEMORY_PATCH")
if [ "$MEMORY_STATE" = applied ]; then MODEL_STATE=$(model_patch_state_without_memory_overlay); else MODEL_STATE=$(patch_state "$MODEL_PATCH"); fi
if [ "$MODEL_STATE" = unapplied ] && [ "$MEMORY_STATE" = drifted ]; then
    MEMORY_STATE=pending-after-model-patch
fi
OWNER_STATE=$(patch_state "$OWNER_PATCH")
BROWSER_STATE=$(patch_state "$BROWSER_PATCH")
if [ "$APPLY_PATCHES" -eq 1 ]; then
    [ "$MODEL_STATE" != drifted ] || die "Model-routing patch is neither cleanly applied nor applicable; Hermes source has drifted"
    [ "$MEMORY_STATE" != drifted ] || die "Memory-routing patch is neither cleanly applied nor applicable; Hermes source has drifted"
    [ "$OWNER_STATE" != drifted ] || die "Hosted-plugin owner patch is neither cleanly applied nor applicable; Hermes source has drifted"
    [ "$BROWSER_STATE" != drifted ] || die "Browser preview gateway patch is neither cleanly applied nor applicable; Hermes source has drifted"
fi

echo "Preflight passed: official Hermes Agent v$EXPECTED_HERMES_VERSION"
echo "Hermes commit: $EXPECTED_HERMES_COMMIT"
echo "Hermes source: $HERMES_SOURCE"
echo "Model patch:   $MODEL_STATE"
echo "Memory patch:  $MEMORY_STATE"
echo "Owner patch:   $OWNER_STATE"
echo "Browser patch: $BROWSER_STATE"

if [ "$DRY_RUN" -eq 1 ]; then
    if [ "$APPLY_PATCHES" -eq 1 ]; then
        echo "DRY RUN: would apply each missing runtime patch"
    else
        echo "DRY RUN: would leave runtime patches unchanged"
    fi
    if path_exists "$PLUGIN_TARGET"; then
        echo "DRY RUN: would back up and replace $PLUGIN_TARGET"
    else
        echo "DRY RUN: would install $PLUGIN_TARGET"
    fi
    exit 0
fi

mkdir -p "$HERMES_HOME" "$PLUGIN_PARENT"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    die "Another Hermes Cockpit install or uninstall may be running (lock: $LOCK_DIR)"
fi

COMMITTED=0
MODEL_APPLIED_NOW=0
MEMORY_APPLIED_NOW=0
OWNER_APPLIED_NOW=0
BROWSER_APPLIED_NOW=0
PLUGIN_INSTALLED_NOW=0
PLUGIN_BACKED_UP=0
BACKUP=""

safe_remove_stage() {
    [ "$1" = "$PLUGIN_STAGE" ] || die "Refusing to remove unexpected staging path: $1"
    if path_exists "$1"; then rm -rf "$1"; fi
}

rollback() {
    echo "Installation did not complete; rolling back changes from this run" >&2
    if [ "$PLUGIN_INSTALLED_NOW" -eq 1 ] && path_exists "$PLUGIN_TARGET"; then
        rm -rf "$PLUGIN_TARGET"
    fi
    if [ "$PLUGIN_BACKED_UP" -eq 1 ] && path_exists "$BACKUP" && ! path_exists "$PLUGIN_TARGET"; then
        if mv "$BACKUP" "$PLUGIN_TARGET"; then echo "Restored the previous plugin" >&2;
        else echo "WARNING: could not restore plugin backup at $BACKUP" >&2; fi
    fi
    if [ "$BROWSER_APPLIED_NOW" -eq 1 ]; then
        if git -C "$HERMES_SOURCE" apply --reverse "$BROWSER_PATCH"; then echo "Reversed the newly applied browser preview gateway patch" >&2;
        else echo "WARNING: could not reverse $BROWSER_PATCH" >&2; fi
    fi
    if [ "$OWNER_APPLIED_NOW" -eq 1 ]; then
        if git -C "$HERMES_SOURCE" apply --reverse "$OWNER_PATCH"; then echo "Reversed the newly applied hosted-plugin owner patch" >&2;
        else echo "WARNING: could not reverse $OWNER_PATCH" >&2; fi
    fi
    if [ "$MEMORY_APPLIED_NOW" -eq 1 ]; then
        if git -C "$HERMES_SOURCE" apply --reverse "$MEMORY_PATCH"; then echo "Reversed the newly applied memory-routing patch" >&2;
        else echo "WARNING: could not reverse $MEMORY_PATCH" >&2; fi
    fi
    if [ "$MODEL_APPLIED_NOW" -eq 1 ]; then
        if git -C "$HERMES_SOURCE" apply --reverse "$MODEL_PATCH"; then echo "Reversed the newly applied model-routing patch" >&2;
        else echo "WARNING: could not reverse $MODEL_PATCH" >&2; fi
    fi
}

cleanup() {
    status=$?
    trap - 0 HUP INT TERM
    if [ "$COMMITTED" -ne 1 ]; then rollback; fi
    safe_remove_stage "$PLUGIN_STAGE"
    rmdir "$LOCK_DIR" 2>/dev/null || :
    exit "$status"
}
trap cleanup 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

safe_remove_stage "$PLUGIN_STAGE"
cp -R "$PLUGIN_SOURCE" "$PLUGIN_STAGE"
for plugin_file in plugin.yaml semantic_routing.py routing_state.py dashboard/cli_bridge.py dashboard/manifest.json dashboard/plugin_api.py; do
    [ -f "$PLUGIN_STAGE/$plugin_file" ] || die "Staged plugin verification failed; missing $plugin_file"
done

if [ "$APPLY_PATCHES" -eq 1 ]; then
    if [ "$MODEL_STATE" = unapplied ]; then
        git -C "$HERMES_SOURCE" apply "$MODEL_PATCH"
        MODEL_APPLIED_NOW=1
        echo "Applied model-routing patch"
    else
        echo "Model-routing patch is already applied"
    fi
    MEMORY_STATE=$(patch_state "$MEMORY_PATCH")
    case "$MEMORY_STATE" in
        applied) echo "Memory-routing patch is already applied" ;;
        unapplied)
            git -C "$HERMES_SOURCE" apply "$MEMORY_PATCH"
            MEMORY_APPLIED_NOW=1
            echo "Applied memory-routing patch"
            ;;
        *) die "Memory-routing patch cannot be applied cleanly after the model patch" ;;
    esac
    case "$OWNER_STATE" in
        applied) echo "Hosted-plugin owner patch is already applied" ;;
        unapplied)
            git -C "$HERMES_SOURCE" apply "$OWNER_PATCH"
            OWNER_APPLIED_NOW=1
            echo "Applied hosted-plugin owner patch"
            ;;
        *) die "Hosted-plugin owner patch cannot be applied cleanly after the memory-routing patch" ;;
    esac
    case "$BROWSER_STATE" in
        applied) echo "Browser preview gateway patch is already applied" ;;
        unapplied)
            git -C "$HERMES_SOURCE" apply "$BROWSER_PATCH"
            BROWSER_APPLIED_NOW=1
            echo "Applied browser preview gateway patch"
            ;;
        *) die "Browser preview gateway patch cannot be applied cleanly after the hosted-plugin owner patch" ;;
    esac
fi

if path_exists "$PLUGIN_TARGET"; then
    BACKUP="$PLUGIN_TARGET.backup-$(date +%Y%m%d%H%M%S)-$$"
    path_exists "$BACKUP" && die "Plugin backup path already exists: $BACKUP"
    mv "$PLUGIN_TARGET" "$BACKUP"
    PLUGIN_BACKED_UP=1
    echo "Backed up the previous plugin to $BACKUP"
fi
mv "$PLUGIN_STAGE" "$PLUGIN_TARGET"
PLUGIN_INSTALLED_NOW=1
for plugin_file in plugin.yaml semantic_routing.py routing_state.py dashboard/cli_bridge.py dashboard/manifest.json dashboard/plugin_api.py; do
    [ -f "$PLUGIN_TARGET/$plugin_file" ] || die "Installed plugin verification failed; missing $plugin_file"
done

COMMITTED=1
echo "Installed the control-plane plugin at $PLUGIN_TARGET"
cat <<EOF

Hermes Cockpit extension installation is complete.
Restart the Hermes dashboard/service, then run scripts/hermes-cockpit-doctor.sh.
Hermes home:   $HERMES_HOME
Hermes source: $HERMES_SOURCE
EOF
