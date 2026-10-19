#!/usr/bin/env sh
set -eu

EXPECTED_HERMES_VERSION=0.21.7
EXPECTED_HERMES_COMMIT=71d34bad1045610252eda02ee79549436896e784
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
HERMES_HOME=${HERMES_HOME:-"$HOME/.hermes"}
HERMES_SOURCE=${HERMES_SOURCE:-"$HERMES_HOME/hermes-agent"}
UPSTREAM_URL=""
FAILURES=0
WARNINGS=0

usage() {
    cat <<'EOF'
Check a Hermes Cockpit extension installation.

Usage: scripts/hermes-cockpit-doctor.sh [options]

Options:
  --hermes-home PATH    Hermes data directory (default: ~/.hermes)
  --hermes-source PATH  Official Hermes Agent source checkout
  --upstream URL        Also request URL/healthz (or URL itself if it ends in /healthz)
  -h, --help            Show this help

The doctor is read-only. The HTTP check is optional and requires curl or wget.
EOF
}

pass() { echo "PASS: $*"; }
warn() { echo "WARN: $*" >&2; WARNINGS=$((WARNINGS + 1)); }
fail() { echo "FAIL: $*" >&2; FAILURES=$((FAILURES + 1)); }

fetch_health() {
    url=$1
    if command -v curl >/dev/null 2>&1; then
        curl --fail --silent --show-error --location --max-time 10 "$url"
    elif command -v wget >/dev/null 2>&1; then
        wget -q -T 10 -O - "$url"
    else
        return 127
    fi
}

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
        --hermes-home) [ "$#" -ge 2 ] || { echo "Missing value for --hermes-home" >&2; exit 2; }; HERMES_HOME=$2; shift 2 ;;
        --hermes-source) [ "$#" -ge 2 ] || { echo "Missing value for --hermes-source" >&2; exit 2; }; HERMES_SOURCE=$2; shift 2 ;;
        --upstream) [ "$#" -ge 2 ] || { echo "Missing value for --upstream" >&2; exit 2; }; UPSTREAM_URL=$2; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
done

PLUGIN_SOURCE="$REPO_DIR/server/judge-m-control-plane"
PLUGIN_TARGET="$HERMES_HOME/plugins/judge-m-control-plane"
MODEL_PATCH="$REPO_DIR/server/hermes-runtime-patches/semantic-routing-hooks.patch"
MEMORY_PATCH="$REPO_DIR/server/hermes-runtime-patches/semantic-routing-memory-hooks.patch"
OWNER_PATCH="$REPO_DIR/server/hermes-runtime-patches/hosted-plugin-owner-scope.patch"
BROWSER_PATCH="$REPO_DIR/server/hermes-runtime-patches/browser-preview-gateway.patch"

echo "Hermes Cockpit doctor"
echo "Hermes home:   $HERMES_HOME"
echo "Hermes source: $HERMES_SOURCE"

if [ "$(uname -s 2>/dev/null || :)" = Linux ]; then pass "Linux host detected"; else fail "runtime host is not Linux"; fi
if command -v git >/dev/null 2>&1; then pass "git is available"; else fail "git is not available"; fi
for command_name in cp mkdir mktemp rm; do
    if command -v "$command_name" >/dev/null 2>&1; then pass "$command_name is available"; else fail "$command_name is not available"; fi
done

if command -v git >/dev/null 2>&1 && [ "$(git -C "$HERMES_SOURCE" rev-parse --is-inside-work-tree 2>/dev/null || :)" = true ]; then
    remote=$(git -C "$HERMES_SOURCE" remote get-url origin 2>/dev/null || :)
    remote_lower=$(printf '%s' "$remote" | tr '[:upper:]' '[:lower:]')
    case "$remote_lower" in
        *github.com/nousresearch/hermes-agent|*github.com/nousresearch/hermes-agent.git|*github.com:nousresearch/hermes-agent|*github.com:nousresearch/hermes-agent.git) pass "official NousResearch/hermes-agent source detected" ;;
        *) fail "source origin is not official: ${remote:-<missing>}" ;;
    esac
    commit=$(git -C "$HERMES_SOURCE" rev-parse HEAD 2>/dev/null || :)
    if [ "$commit" = "$EXPECTED_HERMES_COMMIT" ]; then pass "Hermes commit matches $EXPECTED_HERMES_COMMIT";
    else fail "Hermes commit is ${commit:-unknown}; expected $EXPECTED_HERMES_COMMIT"; fi
    version=$(detect_hermes_version || :)
    if [ "$version" = "$EXPECTED_HERMES_VERSION" ]; then pass "Hermes version is $EXPECTED_HERMES_VERSION";
    else fail "Hermes version is ${version:-unknown}; expected $EXPECTED_HERMES_VERSION"; fi
    memory_state=$(patch_state "$MEMORY_PATCH")
    if [ "$memory_state" = applied ]; then model_state=$(model_patch_state_without_memory_overlay); else model_state=$(patch_state "$MODEL_PATCH"); fi
    owner_state=$(patch_state "$OWNER_PATCH")
    case "$model_state" in applied) pass "model-routing patch is applied" ;; *) fail "model-routing patch state is $model_state" ;; esac
    if [ "$memory_state" = applied ]; then pass "memory-routing patch is applied"; else fail "memory-routing patch state is $memory_state"; fi
    if [ "$owner_state" = applied ]; then pass "hosted-plugin owner patch is applied"; else fail "hosted-plugin owner patch state is $owner_state"; fi
    browser_state=$(patch_state "$BROWSER_PATCH")
    if [ "$browser_state" = applied ]; then pass "browser preview gateway patch is applied"; else fail "browser preview gateway patch state is $browser_state"; fi
else
    fail "Hermes source is not a git checkout: $HERMES_SOURCE"
fi

if [ -d "$PLUGIN_TARGET" ]; then
    pass "plugin directory exists"
    for plugin_file in plugin.yaml __init__.py semantic_routing.py routing_state.py dashboard/__init__.py dashboard/cli_bridge.py dashboard/manifest.json dashboard/plugin_api.py; do
        if [ -f "$PLUGIN_TARGET/$plugin_file" ]; then pass "plugin file exists: $plugin_file";
        else fail "plugin file is missing: $plugin_file"; fi
    done
    if [ -f "$PLUGIN_TARGET/plugin.yaml" ] && [ -f "$PLUGIN_SOURCE/plugin.yaml" ]; then
        installed_version=$(sed -n 's/^[[:space:]]*version:[[:space:]]*//p' "$PLUGIN_TARGET/plugin.yaml" | sed -n '1p')
        packaged_version=$(sed -n 's/^[[:space:]]*version:[[:space:]]*//p' "$PLUGIN_SOURCE/plugin.yaml" | sed -n '1p')
        if [ -n "$installed_version" ] && [ "$installed_version" = "$packaged_version" ]; then pass "plugin version matches package ($installed_version)";
        else fail "plugin version ${installed_version:-unknown} does not match package ${packaged_version:-unknown}"; fi
    fi
else
    fail "plugin directory is missing: $PLUGIN_TARGET"
fi

if [ -n "$UPSTREAM_URL" ]; then
    case "$UPSTREAM_URL" in */healthz) health_url=$UPSTREAM_URL ;; *) health_url=${UPSTREAM_URL%/}/healthz ;; esac
    if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
        fail "curl or wget is required for --upstream"
    else
        attempt=1
        health_body=""
        while [ "$attempt" -le 10 ]; do
            health_body=$(fetch_health "$health_url" 2>/dev/null || :)
            [ "$health_body" = ok ] && break
            attempt=$((attempt + 1))
            [ "$attempt" -le 10 ] && sleep 1
        done
        if [ "$health_body" = ok ]; then pass "HTTP upstream health body is exactly 'ok': $health_url";
        elif [ -n "$health_body" ]; then fail "HTTP upstream returned an unexpected health body: $health_url";
        else fail "HTTP upstream check failed: $health_url"; fi
    fi
else
    warn "HTTP upstream check skipped (pass --upstream URL to enable it)"
fi

echo "Summary: $FAILURES failure(s), $WARNINGS warning(s)"
[ "$FAILURES" -eq 0 ]
