"""Create a portable static Hermes Cockpit release directory."""

from __future__ import annotations

import argparse
from pathlib import Path
import shutil


ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
REQUIRED = (
    "index.html",
    "live-control.html",
    "bot-mode.html",
    "runtime-config-settings.html",
    "hermes-client.js",
    "shell.js",
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "build" / "cockpit")
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()

    missing = [name for name in REQUIRED if not (DIST / name).is_file()]
    if missing:
        parser.error(f"dist is incomplete: {', '.join(missing)}")
    if args.check_only:
        print(f"PASS: {len(REQUIRED)} required release files are present")
        return 0

    output = args.output.resolve()
    if output == DIST.resolve() or DIST.resolve() in output.parents:
        parser.error("output must not replace or be nested inside dist")
    if output.exists():
        shutil.rmtree(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(DIST, output)
    print(f"Built static release: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
