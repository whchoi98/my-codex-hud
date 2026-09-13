#!/usr/bin/env python3
"""Install the bundled HUD for a user or project, with optional shell autostart."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time

ASSETS = Path(__file__).resolve().parent.parent / "assets"
BEGIN = "# >>> codex-hud installer >>>"
END = "# <<< codex-hud installer <<<"
OWNER = "# Managed by codex-hud-install."
AUTOSTART = "# codex-hud autostart enabled"


def command_output(args: list[str], env: dict | None = None) -> str:
    result = subprocess.run(args, text=True, capture_output=True, env=env, timeout=30)
    if result.returncode:
        raise RuntimeError(f"{Path(args[0]).name} failed (exit {result.returncode}): "
                           f"{result.stderr.strip()}")
    return result.stdout.strip()


def bundle() -> tuple[Path, dict]:
    metadata = json.loads((ASSETS / "package.json").read_text(encoding="utf-8"))
    filename = metadata["file"]
    if Path(filename).name != filename or not filename.endswith(".tgz"):
        raise ValueError("The bundled package filename must stay inside assets/.")
    archive = ASSETS / filename
    if hashlib.sha256(archive.read_bytes()).hexdigest() != metadata["sha256"]:
        raise ValueError("Bundled HUD checksum mismatch; use an intact plugin archive.")
    with tarfile.open(archive, "r:gz") as package:
        member = package.getmember("package/package.json")
        if not member.isfile() or member.size > 65536:
            raise ValueError("Invalid package metadata in the bundled archive.")
        with package.extractfile(member) as file:
            actual = json.load(file)
    if actual["name"] != "my-codex-hud" or actual["version"] != metadata["version"]:
        raise ValueError("Bundled HUD name/version does not match its metadata.")
    return archive, metadata


def startup_files(shell: str, explicit: str | None) -> list[Path]:
    if explicit:
        if shell == "none":
            raise ValueError("--rc-file needs --shell bash or --shell zsh.")
        return [Path(explicit).expanduser().resolve()]
    if shell == "bash":
        user_home = Path.home()
        profiles = [user_home / name for name in (".bash_profile", ".bash_login", ".profile")]
        login = next((path for path in profiles if path.exists()), profiles[0])
        return list(dict.fromkeys(path.resolve() for path in [user_home / ".bashrc", login]))
    if shell == "zsh":
        directory = Path(os.environ.get("ZDOTDIR") or Path.home()).expanduser()
        return [(directory / ".zshrc").resolve()]
    return []


def replace_block(text: str, block: str) -> str:
    if BEGIN not in text and END not in text:
        separator = ("\n" if text.endswith("\n") else "\n\n") if text else ""
        return text + separator + block
    lines = text.splitlines(keepends=True)
    starts = [i for i, line in enumerate(lines) if line.rstrip("\r\n") == BEGIN]
    ends = [i for i, line in enumerate(lines) if line.rstrip("\r\n") == END]
    if (len(starts) != 1 or len(ends) != 1 or starts[0] >= ends[0]
            or text.count(BEGIN) != 1 or text.count(END) != 1):
        raise ValueError("Malformed or duplicate HUD startup markers; inspect the file first.")
    return "".join(lines[:starts[0]]) + block + "".join(lines[ends[0] + 1:])


def atomic_write(path: Path, data: bytes, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".codex-hud-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as file:
            file.write(data)
            os.fchmod(file.fileno(), mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def parse_args() -> argparse.Namespace:
    detected_shell = Path(os.environ.get("SHELL", "")).name
    default_shell = detected_shell if detected_shell in ("bash", "zsh") else "none"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scope", choices=("user", "project"), default="user",
                        help="Install for this user (default) or one project.")
    parser.add_argument("--project-dir", help="Project root for project scope (default: current directory).")
    parser.add_argument("--prefix", help="Install prefix; project prefixes must stay inside the project.")
    parser.add_argument("--shell", choices=("bash", "zsh", "none"), default=default_shell)
    parser.add_argument("--rc-file", help="User scope only: edit one startup file instead of shell defaults.")
    parser.add_argument("--autostart", action="store_true", help="Wrap interactive codex with HUD.")
    parser.add_argument("--language", choices=("ko", "en"), help="Preserve existing language by default.")
    parser.add_argument("--dry-run", action="store_true", help="Validate and print a plan without writes.")
    parser.add_argument("--offline", action="store_true", help="Use only cached npm dependencies.")
    parser.add_argument("--npm-cache", help="Optional npm cache directory.")
    return parser.parse_args()


def installation_paths(args: argparse.Namespace) -> tuple[Path | None, Path]:
    project = None
    if args.scope == "project":
        project = Path(args.project_dir or Path.cwd()).expanduser().resolve()
        if not project.is_dir() or project == Path(project.anchor):
            raise ValueError("Project scope needs an existing project directory, not the filesystem root.")
        if args.rc_file:
            raise ValueError("--rc-file is only supported by user scope; project scope never edits startup files.")
        default_prefix = project / ".codex-hud"
    else:
        if args.project_dir is not None:
            raise ValueError("--project-dir requires --scope project.")
        data_home = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
        default_prefix = data_home / "codex-hud"
    prefix = Path(args.prefix or default_prefix).expanduser().resolve()
    if project is not None and (prefix == project or project not in prefix.parents):
        raise ValueError("A project prefix must stay in a subdirectory of the project.")
    if any(char in str(prefix) for char in (":", "\n", "\r")):
        raise ValueError("The prefix must not contain a PATH separator or newline.")
    return project, prefix


def shell_source(prefix: Path, scope: str, project: Path | None,
                 language: str, autostart: bool) -> str:
    text = f"{OWNER}\n# scope: {scope}\n# language: {language}\n"
    if scope == "user":
        quoted_bin = shlex.quote(str(prefix / "bin"))
        text += (
            'case ":${PATH-}:" in\n'
            f'    *:{quoted_bin}:*) ;;\n'
            f'    *) export PATH={quoted_bin}:"${{PATH-}}" ;;\n'
            'esac\n'
        )
    if not autostart:
        return text
    text += f"\n{AUTOSTART}\n"
    executable = shlex.quote(str(prefix / "bin" / "codex-hud"))
    if scope == "project":
        # Preserve a previously sourced user wrapper from older installations.
        text += (
            'if [ -z "${_CODEX_HUD_USER_COMMAND-}" ] && [ -n "${_CODEX_HUD_LANGUAGE-}" ]; then\n'
            '    _CODEX_HUD_USER_COMMAND=$(command -v codex-hud 2>/dev/null) || _CODEX_HUD_USER_COMMAND=\n'
            '    _CODEX_HUD_USER_LANGUAGE=$_CODEX_HUD_LANGUAGE\n'
            'fi\n'
            f"_CODEX_HUD_PROJECT_ROOT={shlex.quote(str(project))}\n"
            f"_CODEX_HUD_PROJECT_COMMAND={executable}\n"
            f"_CODEX_HUD_PROJECT_LANGUAGE={shlex.quote(language)}\n"
        )
    else:
        text += (
            f"_CODEX_HUD_USER_COMMAND={executable}\n"
            f"_CODEX_HUD_USER_LANGUAGE={shlex.quote(language)}\n"
            f"_CODEX_HUD_LANGUAGE={shlex.quote(language)}\n"
        )
    return text + (ASSETS / "codex-hud.sh").read_text(encoding="utf-8")


def install(args: argparse.Namespace) -> dict:
    if os.name != "posix":
        raise ValueError("This installer requires Linux, macOS, or WSL.")
    project, prefix = installation_paths(args)
    if args.autostart and args.shell == "none" and args.scope == "user":
        raise ValueError("--autostart requires --shell bash or --shell zsh.")
    node, npm, codex = (shutil.which(name) for name in ("node", "npm", "codex"))
    if not all((node, npm, codex)):
        raise ValueError("Install Node.js 20+, npm, and Codex CLI on PATH first.")
    version = command_output([node, "--version"])
    match = re.fullmatch(r"v(\d+)\.\d+\.\d+(?:[-+].*)?", version)
    if not match or int(match[1]) < 20:
        raise ValueError(f"Node.js 20+ is required; found {version}.")
    archive, metadata = bundle()
    shell_file = prefix / "shell.sh"
    previous = shell_file.read_text(encoding="utf-8") if shell_file.exists() else ""
    if previous and not previous.startswith(OWNER + "\n"):
        raise ValueError(f"Refusing to replace an unrelated file: {shell_file}")
    previous_scope = re.search(r"^# scope: (user|project)$", previous, re.MULTILINE)
    if previous and (previous_scope[1] if previous_scope else "user") != args.scope:
        raise ValueError("This prefix belongs to a different install scope; choose another prefix.")
    autostart = args.autostart or AUTOSTART in previous.splitlines()
    previous_language = re.search(r"^# language: (ko|en)$", previous, re.MULTILINE)
    language = args.language or (previous_language[1] if previous_language else "ko")
    shell_text = shell_source(prefix, args.scope, project, language, autostart)
    quoted_source = shlex.quote(str(shell_file))
    block = (f"{BEGIN}\nif [ -r {quoted_source} ]; then\n"
             f"    . {quoted_source}\nfi\n{END}\n")
    edits = []
    startup = startup_files(args.shell, args.rc_file) if args.scope == "user" else []
    for path in startup:
        if path in {shell_file.resolve(), (prefix / "bin" / "codex-hud").resolve()}:
            raise ValueError("A startup file cannot also be the HUD executable or its shell source.")
        before = path.read_bytes() if path.exists() else None
        updated = replace_block(before.decode("utf-8") if before is not None else "", block)
        mode = stat.S_IMODE(path.stat().st_mode) if before is not None else 0o644
        edits.append((path, before, updated.encode("utf-8"), mode))
    install_command = [
        npm, "install", "--global", "--prefix", str(prefix), str(archive),
        "--no-audit", "--no-fund", "--foreground-scripts",
    ]
    if args.offline:
        install_command.append("--offline")
    if args.npm_cache:
        install_command += ["--cache", str(Path(args.npm_cache).expanduser().resolve())]
    plan = {
        "version": metadata["version"], "scope": args.scope,
        "project": str(project) if project is not None else None, "prefix": str(prefix),
        "command": str(prefix / "bin" / "codex-hud"),
        "shellFile": str(shell_file), "startupFiles": [str(edit[0]) for edit in edits],
        "autostart": autostart, "language": language,
        "installCommand": install_command,
    }
    if args.dry_run:
        return {"action": "dry-run", **plan}

    result = subprocess.run(install_command, check=False)
    if result.returncode:
        raise RuntimeError(f"npm install failed (exit {result.returncode}); shell files were not changed.")
    executable = plan["command"]
    env = {**os.environ, "PATH": str(prefix / "bin") + os.pathsep + os.environ.get("PATH", "")}
    installed_version = command_output([executable, "--version"], env)
    if installed_version != metadata["version"]:
        raise RuntimeError(f"Installed version mismatch: {installed_version}; shell files were not changed.")
    doctor = json.loads(command_output([executable, "doctor", "--json"], env))
    if not doctor.get("codex") or not doctor.get("inline", {}).get("available"):
        raise RuntimeError(f"HUD diagnostics failed; shell files were not changed: {json.dumps(doctor)}")

    for path, before, _, _ in edits:
        current = path.read_bytes() if path.exists() else None
        if current != before:
            raise RuntimeError(f"Startup file changed during installation; inspect {path} and rerun.")
    atomic_write(shell_file, shell_text.encode("utf-8"))
    backups = []
    for path, before, after, mode in edits:
        if before == after:
            continue
        if before is not None:
            backup_dir = prefix / "backups"
            backup_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
            backup = backup_dir / f"{path.name}.{time.time_ns()}.bak"
            atomic_write(backup, before, 0o600)
            backups.append(str(backup))
        atomic_write(path, after, mode)
    return {"action": "installed", **plan, "backups": backups, "doctor": doctor,
            "activate": f"source {shlex.quote(str(shell_file))}"}


def main() -> int:
    try:
        report = install(parse_args())
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, KeyError, RuntimeError, tarfile.TarError,
            subprocess.SubprocessError) as error:
        print(f"codex-hud-install: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
