#!/usr/bin/env python3
"""Register this complete local skill bundle for a user or current project."""

from __future__ import annotations

import argparse
import errno
import hashlib
import json
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import runpy
import shutil
import stat
import sys
import tarfile
import tempfile
import uuid


NAME = "codex-hud-install"
SOURCE = Path(__file__).resolve().parent.parent
MARKER = ".codex-hud-skill.json"


def relative_path(name: str) -> PurePosixPath:
    relative = PurePosixPath(name)
    if (not relative.parts or relative.is_absolute() or str(relative) != name
            or ".." in relative.parts or "\\" in name
            or PureWindowsPath(name).drive or relative.parts[0] == MARKER):
        raise ValueError(f"Unsafe skill-relative path: {name}")
    return relative


def inventory(root: Path, *, portable: bool = False) -> dict:
    """Record files without following links; a source must be self-contained."""
    entries = {}

    def visit(directory: Path) -> None:
        for path in sorted(directory.iterdir()):
            relative = path.relative_to(root).as_posix()
            if relative == MARKER:
                continue
            if portable:
                try:
                    relative_path(relative)
                except ValueError as error:
                    raise ValueError(f"Source path is not portable: {path}") from error
            details = path.lstat()
            mode = stat.S_IMODE(details.st_mode)
            if stat.S_ISLNK(details.st_mode):
                link = os.readlink(path)
                if portable:
                    if (Path(link).is_absolute() or PureWindowsPath(link).drive
                            or "\\" in link):
                        raise ValueError(f"Source symlink is not portable: {path}")
                    # Leaving and re-entering through the source folder's name
                    # would break when the extracted bundle is renamed.
                    depth = len(PurePosixPath(relative).parent.parts)
                    for part in PurePosixPath(link).parts:
                        depth += -1 if part == ".." else 1
                        if depth < 0:
                            raise ValueError(f"Source symlink leaves the skill bundle: {path}")
                    if not path.resolve(strict=True).is_relative_to(root):
                        raise ValueError(f"Source symlink escapes the skill bundle: {path}")
                entries[relative] = {"type": "symlink", "target": link}
            elif stat.S_ISDIR(details.st_mode):
                entries[relative] = {"type": "directory", "mode": mode}
                visit(path)
            elif stat.S_ISREG(details.st_mode):
                entries[relative] = {
                    "type": "file", "mode": mode,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                }
            else:
                raise ValueError(f"Refusing to copy a special filesystem entry: {path}")

    visit(root)
    return entries


def read_marker(root: Path) -> dict:
    path = root / MARKER
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Refusing an unmanaged skill or symlinked ownership marker: {path}")
    try:
        marker = json.loads(path.read_text(encoding="utf-8"))
        if (not isinstance(marker, dict) or marker.get("owner") != NAME
                or marker.get("format") != 1
                or not isinstance(marker.get("version"), str)
                or not isinstance(marker.get("files"), dict) or not marker["files"]):
            raise ValueError("unrecognized ownership data")
        files = marker["files"]
        for name, entry in files.items():
            relative = relative_path(name)
            if not isinstance(entry, dict):
                raise ValueError("invalid file entry")
            kind = entry.get("type")
            if kind in ("file", "directory"):
                mode = entry.get("mode")
                if type(mode) is not int or not 0 <= mode <= 0o7777:
                    raise ValueError("invalid file mode")
                if kind == "file" and not re.fullmatch(
                    r"[0-9a-f]{64}", str(entry.get("sha256", ""))
                ):
                    raise ValueError("invalid file checksum")
            elif kind == "symlink":
                if not isinstance(entry.get("target"), str) or not entry["target"]:
                    raise ValueError("invalid symlink")
            else:
                raise ValueError("invalid file type")
            for parent in relative.parents:
                if parent != PurePosixPath("."):
                    if files.get(str(parent), {}).get("type") != "directory":
                        raise ValueError("file path traverses a non-directory")
    except (ValueError, TypeError, AttributeError) as error:
        raise ValueError(f"Invalid ownership marker {path}: {error}") from error
    return marker


def check_directories(base: Path, directory: Path) -> None:
    """Do not follow an existing .agents, skills, or backup directory symlink."""
    current = base
    for part in directory.relative_to(base).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError(f"Refusing a symlink in the registration path: {current}")
        if current.exists() and not current.is_dir():
            raise ValueError(f"Refusing a non-directory in the registration path: {current}")


def check_update(old: dict, current: dict, incoming: dict) -> None:
    for name, entry in old.items():
        if current.get(name) != entry:
            raise ValueError(f"Refusing to replace modified registered content: {name}")
    for name, entry in incoming.items():
        if name in current and name not in old:
            raise ValueError(f"Refusing to overwrite unrelated content: {name}")
        if (old.get(name, {}).get("type") == "directory"
                and entry["type"] != "directory"):
            if any(path.startswith(name + "/") and path not in old for path in current):
                raise ValueError(f"Refusing to delete unrelated content inside: {name}")


def overlay(source: Path, staged: Path, old: dict, incoming: dict) -> None:
    retired = [
        name for name, entry in old.items()
        if name not in incoming or entry["type"] != incoming[name]["type"]
    ]
    for name in sorted(retired, key=lambda item: len(PurePosixPath(item).parts), reverse=True):
        path = staged / name
        if old[name]["type"] == "directory":
            try:
                path.rmdir()
            except OSError as error:
                if error.errno not in (errno.ENOTEMPTY, errno.EEXIST):
                    raise
        else:
            path.unlink()

    directories = []
    for name, entry in incoming.items():
        path = staged / name
        if entry["type"] == "directory":
            path.mkdir(exist_ok=True)
            directories.append(name)
        else:
            if path.exists() or path.is_symlink():
                path.unlink()
            shutil.copy2(source / name, path, follow_symlinks=False)
    for name in reversed(directories):
        shutil.copystat(source / name, staged / name, follow_symlinks=False)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scope", required=True, choices=("user", "project"))
    parser.add_argument("--project-dir", help="Existing project directory (default: current directory).")
    parser.add_argument("--dry-run", action="store_true", help="Validate and print JSON without writes.")
    args = parser.parse_args()
    if args.scope == "user" and args.project_dir is not None:
        parser.error("--project-dir is only valid with --scope project.")
    return args


def register(args: argparse.Namespace) -> dict:
    project = None
    if args.scope == "project":
        candidate = Path(args.project_dir) if args.project_dir is not None else Path.cwd()
        try:
            base = candidate.expanduser().resolve(strict=True)
        except OSError as error:
            raise ValueError(f"The project directory must exist: {candidate}") from error
        if not base.is_dir() or base == Path(base.anchor):
            raise ValueError(f"The project must be a directory other than the filesystem root: {base}")
        project = str(base)
    else:
        base = Path.home().resolve(strict=True)
        if not base.is_dir():
            raise ValueError(f"The user home must be a directory: {base}")

    agents = base / ".agents"
    skills = agents / "skills"
    target = skills / NAME
    backup_root = agents / "skill-backups" / NAME
    check_directories(base, skills)
    if target.is_symlink():
        raise ValueError(f"Refusing to replace a skill symlink: {target}")
    if target != SOURCE and (target.is_relative_to(SOURCE) or SOURCE.is_relative_to(target)):
        raise ValueError("The source and registration destination must not contain each other.")
    if target.exists() and not target.is_dir():
        raise ValueError(f"Refusing to replace an unmanaged skill: {target}")

    incoming = inventory(SOURCE, portable=True)
    if not (SOURCE / "SKILL.md").is_file():
        raise ValueError("The source bundle is missing SKILL.md.")
    for directory in ("agents", "scripts", "assets"):
        if not (SOURCE / directory).is_dir():
            raise ValueError(f"The source bundle is missing {directory}/.")
    if (SOURCE / MARKER).exists() or (SOURCE / MARKER).is_symlink():
        read_marker(SOURCE)

    # run_path uses this bundle's installer without executing main() or writing pyc files.
    runtime = runpy.run_path(str(SOURCE / "scripts" / "install.py"), run_name="hud_bundle_validation")
    _, metadata = runtime["bundle"]()
    report = {
        "scope": args.scope, "project": project, "skillPath": str(target),
        "version": metadata["version"], "action": "registered",
    }
    if target == SOURCE:
        return {**report, "action": "dry-run" if args.dry_run else "unchanged"}

    previous = None
    current = {}
    if target.exists():
        previous = read_marker(target)
        current = inventory(target)
        check_update(previous["files"], current, incoming)
        report["action"] = (
            "unchanged" if previous["files"] == incoming
            and previous["version"] == metadata["version"] else "updated"
        )
        if report["action"] == "updated":
            if backup_root.is_relative_to(SOURCE):
                raise ValueError("The backup location must not be inside the source bundle.")
            check_directories(base, backup_root)
    if args.dry_run:
        return {**report, "action": "dry-run"}
    if report["action"] == "unchanged":
        return report

    marker = {"owner": NAME, "format": 1, "version": metadata["version"], "files": incoming}
    check_directories(base, skills)
    skills.mkdir(parents=True, exist_ok=True)
    # Staging and backups stay outside the skills directory, including on failures.
    with tempfile.TemporaryDirectory(prefix=".codex-hud-registration-", dir=agents) as temporary:
        staged = Path(temporary) / NAME
        if previous is None:
            shutil.copytree(SOURCE, staged, symlinks=True)
        else:
            shutil.copytree(target, staged, symlinks=True)
            overlay(SOURCE, staged, previous["files"], incoming)
        (staged / MARKER).write_text(
            json.dumps(marker, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        (staged / MARKER).chmod(0o600)
        staged_files = inventory(staged)
        if any(staged_files.get(name) != entry for name, entry in incoming.items()):
            raise RuntimeError("The source bundle changed during registration; retry.")
        if previous is not None:
            if any(staged_files.get(name) != entry for name, entry in current.items()
                   if name not in previous["files"]):
                raise RuntimeError("Unrelated registered content changed while preparing the update.")

        check_directories(base, skills)
        if previous is None:
            if target.exists() or target.is_symlink():
                raise ValueError(f"Refusing a destination created during registration: {target}")
            staged.rename(target)
        else:
            if target.is_symlink() or read_marker(target) != previous or inventory(target) != current:
                raise RuntimeError("The registered skill changed during the update; retry.")
            check_directories(base, backup_root)
            backup_root.mkdir(parents=True, exist_ok=True, mode=0o700)
            backup = backup_root / uuid.uuid4().hex
            target.rename(backup)
            try:
                staged.rename(target)
            except BaseException as error:
                if target.exists() or target.is_symlink():
                    raise RuntimeError(f"Registration failed; the previous skill is at {backup}") from error
                try:
                    backup.rename(target)
                except OSError as restore_error:
                    raise RuntimeError(
                        f"Could not restore the previous skill; it is safe at {backup}"
                    ) from restore_error
                raise
    return report


def main() -> int:
    try:
        print(json.dumps(register(parse_args()), ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, tarfile.TarError) as error:
        print(f"codex-hud-install-skill: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
