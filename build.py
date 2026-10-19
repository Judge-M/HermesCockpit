"""Validate or package a portable Hermes Cockpit release."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
import tarfile
import zipfile


ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
BUILD_ROOT = ROOT / "build"
REQUIRED = (
    "index.html",
    "live-control.html",
    "bot-mode.html",
    "runtime-config-settings.html",
    "hermes-client.js",
    "shell.js",
)
RELEASE_PATHS = (
    ".env.example",
    "CHANGELOG.md",
    "LICENSE",
    "LICENSES",
    "README.md",
    "SECURITY.md",
    "THIRD_PARTY_NOTICES.md",
    "VERSION",
    "compose.yaml",
    "deploy",
    "dist",
    "docs",
    "scripts",
    "server",
)


def version() -> str:
    value = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", value):
        raise ValueError(f"VERSION is not semantic: {value!r}")
    return value


def validate_release() -> str:
    missing = [name for name in REQUIRED if not (DIST / name).is_file()]
    missing.extend(name for name in RELEASE_PATHS if not (ROOT / name).exists())
    if missing:
        raise ValueError(f"release is incomplete: {', '.join(sorted(set(missing)))}")

    release_version = version()
    plugin_yaml = (ROOT / "server/judge-m-control-plane/plugin.yaml").read_text(encoding="utf-8")
    manifest = json.loads(
        (ROOT / "server/judge-m-control-plane/dashboard/manifest.json").read_text(encoding="utf-8")
    )
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    if not re.search(rf"(?m)^version:\s*[\"']?{re.escape(release_version)}[\"']?\s*$", plugin_yaml):
        raise ValueError("plugin.yaml version does not match VERSION")
    if manifest.get("version") != release_version:
        raise ValueError("dashboard manifest version does not match VERSION")
    if package.get("version") != release_version:
        raise ValueError("package.json version does not match VERSION")
    return release_version


def prepare_output(output: Path) -> None:
    output = output.resolve()
    build_root = BUILD_ROOT.resolve()
    if output == ROOT.resolve() or output == DIST.resolve() or DIST.resolve() in output.parents:
        raise ValueError("output must not replace the repository or dist")
    if output.exists():
        if build_root != output and build_root not in output.parents:
            raise ValueError("refusing to replace an existing output outside the repository build directory")
        shutil.rmtree(output)
    output.parent.mkdir(parents=True, exist_ok=True)


def iter_files(root: Path):
    yield from sorted((path for path in root.rglob("*") if path.is_file()), key=lambda path: path.as_posix())


def write_zip(source: Path, destination: Path) -> None:
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in iter_files(source):
            relative = path.relative_to(source.parent).as_posix()
            info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o755 if path.suffix == ".sh" else 0o644) << 16
            archive.writestr(info, path.read_bytes(), compresslevel=9)


def write_tar(source: Path, destination: Path) -> None:
    with destination.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w") as archive:
                for path in iter_files(source):
                    relative = path.relative_to(source.parent).as_posix()
                    info = archive.gettarinfo(str(path), arcname=relative)
                    info.mtime = 0
                    info.uid = info.gid = 0
                    info.uname = info.gname = ""
                    info.mode = 0o755 if path.suffix == ".sh" else 0o644
                    with path.open("rb") as handle:
                        archive.addfile(info, handle)


def package_release(output: Path, release_version: str) -> list[Path]:
    prepare_output(output)
    output.mkdir(parents=True)
    release_name = f"hermes-cockpit-{release_version}"
    stage = output / release_name
    stage.mkdir()
    for name in RELEASE_PATHS:
        source = ROOT / name
        destination = stage / name
        if source.is_dir():
            shutil.copytree(source, destination)
        else:
            shutil.copy2(source, destination)

    archives = [output / f"{release_name}.zip", output / f"{release_name}.tar.gz"]
    write_zip(stage, archives[0])
    write_tar(stage, archives[1])
    checksums = output / "SHA256SUMS.txt"
    checksums.write_text(
        "".join(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n" for path in archives),
        encoding="utf-8",
        newline="\n",
    )
    return [*archives, checksums]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "build" / "cockpit")
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument("--release", action="store_true", help="build versioned ZIP and tar.gz release archives")
    args = parser.parse_args()

    try:
        release_version = validate_release()
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    if args.check_only:
        print(f"PASS: Hermes Cockpit {release_version}; {len(REQUIRED)} runtime files and release metadata")
        return 0

    output = args.output.resolve()
    try:
        if args.release:
            artifacts = package_release(output, release_version)
            print("Built release artifacts:")
            for artifact in artifacts:
                print(f"  {artifact}")
        else:
            prepare_output(output)
            shutil.copytree(DIST, output)
            print(f"Built static release: {output}")
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
