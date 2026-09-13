#!/usr/bin/env python3
"""Inspect, install, or update the bundled HUD for a selected user/project prefix."""

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
STATE_OWNER = "codex-hud-install"
STATE_FIELDS = (
    "version", "scope", "project", "prefix", "command", "shellFile",
    "startupFiles", "shell", "language", "autostart",
)


def command_output(args: list[str], env: dict | None = None) -> str:
    result = subprocess.run(args, text=True, capture_output=True, env=env, timeout=30)
    if result.returncode:
        raise RuntimeError(f"{Path(args[0]).name} failed (exit {result.returncode}): "
                           f"{result.stderr.strip()}")
    return result.stdout.strip()


def semver(version: str) -> tuple:
    """Return a SemVer precedence key; build metadata never affects ordering."""
    match = re.fullmatch(
        r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
        r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
        r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?",
        version if isinstance(version, str) else "",
    )
    if not match:
        raise ValueError(f"Unparseable SemVer version: {version!r}.")
    prerelease = []
    for identifier in match[4].split(".") if match[4] is not None else []:
        if identifier.isdigit():
            if len(identifier) > 1 and identifier.startswith("0"):
                raise ValueError(f"Unparseable SemVer version: {version!r}.")
            prerelease.append((0, int(identifier)))
        else:
            prerelease.append((1, identifier))
    return (*map(int, match.group(1, 2, 3)), match[4] is None, tuple(prerelease))


def runtime_version(prefix: Path, bundled: str) -> dict:
    """Inspect the selected executable, never another installation on PATH."""
    bundled_key = semver(bundled)
    result = {
        "installedVersion": None, "bundledVersion": bundled,
        "versionComparison": "missing", "versionError": None,
    }
    executable = prefix / "bin" / "codex-hud"
    try:
        # lstat distinguishes an absent command from a broken npm symlink.
        executable.lstat()
    except FileNotFoundError:
        return result
    except OSError as error:
        return {**result, "versionComparison": "unknown", "versionError": str(error)}
    try:
        env = {**os.environ, "PATH": str(prefix / "bin") + os.pathsep + os.environ.get("PATH", "")}
        result["installedVersion"] = command_output([str(executable), "--version"], env)
        installed_key = semver(result["installedVersion"])
        result["versionComparison"] = (
            "upgrade" if installed_key < bundled_key else
            "downgrade" if installed_key > bundled_key else "same"
        )
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        result.update(versionComparison="unknown", versionError=str(error))
    return result


def read_install_state(prefix: Path) -> dict | None:
    path = prefix / "install-state.json"
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise ValueError(f"Refusing symlinked or non-file install state: {path}")
    if not path.exists():
        return None

    def unique_fields(pairs: list[tuple]) -> dict:
        fields = {}
        for key, value in pairs:
            if key in fields:
                raise ValueError(f"duplicate field: {key}")
            fields[key] = value
        return fields

    try:
        state = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_fields)
        if (not isinstance(state, dict)
                or type(state.get("schemaVersion")) is not int or state["schemaVersion"] != 1
                or state.get("owner") != STATE_OWNER
                or not all(field in state for field in STATE_FIELDS)):
            raise ValueError("unrelated or incomplete managed state")
        semver(state["version"])
        if (state["scope"] not in ("user", "project")
                or state["shell"] not in ("bash", "zsh", "none")
                or state["language"] not in ("ko", "en")
                or type(state["autostart"]) is not bool
                or not isinstance(state["startupFiles"], list)):
            raise ValueError("invalid configuration fields")
        expected_paths = {
            "prefix": prefix, "command": prefix / "bin" / "codex-hud",
            "shellFile": prefix / "shell.sh",
        }
        if any(state[key] != str(value) for key, value in expected_paths.items()):
            raise ValueError("paths do not match the selected prefix")
        paths = state["startupFiles"]
        if state["scope"] == "project":
            paths = [state["project"], *paths]
            if state["startupFiles"]:
                raise ValueError("project state cannot manage user startup files")
        elif state["project"] is not None:
            raise ValueError("user state cannot have a project root")
        if any(not isinstance(value, str) or not Path(value).is_absolute()
               or any(char in value for char in ("\0", "\n", "\r")) for value in paths):
            raise ValueError("configuration paths must be absolute")
        protected = {str(path), state["shellFile"], state["command"]}
        if any(value in protected for value in state["startupFiles"]):
            raise ValueError("a startup file overlaps a managed runtime file")
        if state["scope"] == "project":
            project = Path(state["project"]).resolve()
            if project == Path(project.anchor) or project not in prefix.parents:
                raise ValueError("prefix is outside the recorded project")
        return state
    except (OSError, ValueError, TypeError) as error:
        raise ValueError(f"Invalid install state {path}: {error}") from error


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
    semver(metadata["version"])
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
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--status", action="store_true",
                         help="Inspect the selected runtime and bundle without installation prerequisites or writes.")
    actions.add_argument("--update", action="store_true",
                         help="Update an existing selected runtime, preserving its configuration.")
    parser.add_argument("--scope", choices=("user", "project"),
                        help="Select user (default) or project scope; an explicit prefix can recover its saved scope.")
    parser.add_argument("--project-dir",
                        help="Project root; defaults to cwd only for a fresh project installation.")
    parser.add_argument("--prefix", help="Install prefix; project prefixes must stay inside the project.")
    parser.add_argument("--shell", choices=("bash", "zsh", "none"),
                        help="Install only: shell startup setup (default: current SHELL).")
    parser.add_argument("--rc-file", help="User scope only: edit one startup file instead of shell defaults.")
    parser.add_argument("--autostart", action="store_true", help="Wrap interactive codex with HUD.")
    parser.add_argument("--language", choices=("ko", "en"), help="Preserve existing language by default.")
    parser.add_argument("--dry-run", action="store_true", help="Validate and print a plan without writes.")
    parser.add_argument("--offline", action="store_true", help="Use only cached npm dependencies.")
    parser.add_argument("--npm-cache", help="Optional npm cache directory.")
    parser.add_argument("--allow-downgrade", action="store_true",
                        help="Allow replacing a known newer version; unknown versions are always refused.")
    args = parser.parse_args()
    if args.update or args.status:
        conflicts = [flag for flag, value in (
            ("--shell", args.shell), ("--rc-file", args.rc_file),
            ("--language", args.language), ("--autostart", args.autostart),
        ) if value is not None and value is not False]
        if conflicts:
            action = "--update" if args.update else "--status"
            parser.error(f"{action} preserves existing configuration; omit {', '.join(conflicts)}.")
    return args


def installation_paths(args: argparse.Namespace) -> tuple[Path | None, Path]:
    """Return the explicit project root, if supplied, and locate the selected prefix."""
    if args.scope == "user" and args.project_dir is not None:
        raise ValueError("--project-dir requires --scope project.")
    requested_project = Path(args.project_dir).expanduser().resolve() if args.project_dir else None
    if args.scope == "project" or requested_project is not None:
        # cwd locates a default prefix; it does not establish an existing install's root.
        default_prefix = (requested_project or Path.cwd()) / ".codex-hud"
    else:
        data_home = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
        default_prefix = data_home / "codex-hud"
    prefix = Path(args.prefix or default_prefix).expanduser().resolve()
    if any(char in str(prefix) for char in (":", "\0", "\n", "\r")):
        raise ValueError("The prefix must not contain a PATH separator or newline.")
    return requested_project, prefix


def shell_literal(value: str) -> str | None:
    """Read generated POSIX literals without shell expansion or evaluation."""
    # Includes shlex.quote's single-quote concatenation and simple double quotes.
    # Expansion, command substitution, redirects and unquoted whitespace fail.
    # Match unquoted characters individually to avoid nested repetition on rejection.
    if not re.fullmatch(r"""(?:[a-zA-Z0-9_@%+=:,./-]|'[^']*'|"[^"$`\\]*")+""", value):
        return None
    words = shlex.split(value)
    return words[0] if len(words) == 1 else None


def legacy_startup_files(shell_file: Path) -> tuple[str, list[str]]:
    """Recover only existing managed connections; never select new defaults."""
    candidates = [(Path.home() / name, "bash") for name in (
        ".bashrc", ".bash_profile", ".bash_login", ".profile",
    )]
    candidates.append((Path.home() / ".zshrc", "zsh"))
    if os.environ.get("ZDOTDIR"):
        candidates.append((Path(os.environ["ZDOTDIR"]).expanduser() / ".zshrc", "zsh"))
    startup = []
    shell = "none"
    for path, kind in candidates:
        try:
            text = path.read_text(encoding="utf-8")
            # Reject ambiguous markers for discovery without changing the file.
            replace_block(text, "")
        except (OSError, ValueError):
            continue
        lines = text.splitlines()
        if BEGIN not in lines or END not in lines:
            continue
        managed = lines[lines.index(BEGIN) + 1:lines.index(END)]
        for line in managed:
            match = re.fullmatch(r"\s*(?:\.|source)\s+(.+?)\s*", line)
            literal = shell_literal(match[1]) if match else None
            if literal == str(shell_file) and str(path.resolve()) not in startup:
                startup.append(str(path.resolve()))
                if shell == "none":
                    shell = kind
    return shell, startup


def existing_configuration(args: argparse.Namespace, project: Path | None, prefix: Path,
                           state: dict | None, previous: str) -> dict:
    if previous and not previous.startswith(OWNER + "\n"):
        raise ValueError(f"Refusing to replace an unrelated file: {prefix / 'shell.sh'}")
    scopes = re.findall(r"^# scope: (.*)$", previous, re.MULTILINE)
    if len(scopes) > 1 or (scopes and scopes[0] not in ("user", "project")):
        raise ValueError("Malformed managed shell scope; inspect shell.sh before continuing.")
    assignments = re.findall(r"^_CODEX_HUD_PROJECT_ROOT=(.*)$", previous, re.MULTILINE)
    if scopes:
        saved_scope = scopes[0]
    elif assignments:
        saved_scope = "project"
    else:
        saved_scope = state["scope"] if state else "user" if previous else None
    if state and saved_scope != state["scope"]:
        raise ValueError("Managed shell and install state disagree about install scope.")
    requested_scope = args.scope or ("project" if args.project_dir else None)
    if saved_scope and requested_scope and saved_scope != requested_scope:
        raise ValueError("This prefix belongs to a different install scope; choose another prefix.")
    scope = saved_scope or requested_scope or "user"
    if scope == "project":
        if args.rc_file:
            raise ValueError("--rc-file is only supported by user scope; project scope never edits startup files.")
        saved_project = Path(state["project"]).resolve() if state else None
        literal = shell_literal(assignments[0]) if len(assignments) == 1 else None
        legacy_project = Path(literal).resolve() if literal and Path(literal).is_absolute() else None
        if saved_project and legacy_project and saved_project != legacy_project:
            raise ValueError("Managed shell and install state disagree about the project root.")
        saved_project = saved_project or legacy_project
        if project and saved_project and project != saved_project:
            raise ValueError("--project-dir does not match this installation's project root.")
        project = project or saved_project
        if project is None:
            if saved_scope:
                # A prefix found through cwd can also be nested below its original root.
                raise ValueError("Cannot recover this project's root; provide --project-dir.")
            project = Path.cwd().resolve()
        if not project.is_dir() or project == Path(project.anchor):
            raise ValueError("Project scope needs an existing project directory, not the filesystem root.")
        if project not in prefix.parents:
            raise ValueError("A project prefix must stay in a subdirectory of the project.")
    else:
        project = None
    language = state["language"] if state else None
    languages = re.findall(r"^# language: (ko|en)$", previous, re.MULTILINE)
    if len(languages) == 1:
        language = languages[0]
    autostart = AUTOSTART in previous.splitlines() if previous else state["autostart"] if state else None
    if state:
        shell, startup = state["shell"], state["startupFiles"]
    elif previous:
        shell, startup = legacy_startup_files(prefix / "shell.sh") if scope == "user" else ("none", [])
    else:
        shell, startup = None, []
    return {
        "scope": scope, "project": str(project) if project is not None else None,
        "language": language, "autostart": autostart, "shell": shell, "startupFiles": startup,
        "configurationSource": "state" if state else "legacy-shell" if previous else "missing",
    }


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


def checked_doctor(executable: str, env: dict, *, after_writes: bool = False) -> dict:
    try:
        # Check the installed runtime without depending on --bundle support.
        doctor = json.loads(command_output([executable, "doctor", "--json"], env))
        if (not isinstance(doctor, dict) or not doctor.get("codex")
                or not isinstance(doctor.get("inline"), dict)
                or not doctor["inline"].get("available")
                or not isinstance(doctor["inline"].get("probe"), dict)
                or doctor["inline"]["probe"].get("status") != "ok"):
            raise ValueError("Codex or inline PTY execution checks did not pass "
                             f"(inline.probe.status must be 'ok'): {json.dumps(doctor)}")
        return doctor
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        if after_writes:
            raise RuntimeError(
                "Final HUD diagnostics failed after shell files and install state were written; "
                f"no rollback was performed. Probe {executable}: {error}"
            ) from error
        raise RuntimeError(f"HUD diagnostics failed; shell files were not changed: {error}") from error


def install(args: argparse.Namespace) -> dict:
    if os.name != "posix":
        raise ValueError("This installer requires Linux, macOS, or WSL.")
    project, prefix = installation_paths(args)
    archive, metadata = bundle()
    state = read_install_state(prefix)
    state_file = prefix / "install-state.json"
    state_before = state_file.read_bytes() if state is not None else None
    shell_file = prefix / "shell.sh"
    previous = shell_file.read_text(encoding="utf-8") if shell_file.exists() else ""
    config = existing_configuration(args, project, prefix, state, previous)
    comparison = runtime_version(prefix, metadata["version"])
    plan = {
        "version": metadata["version"], **config, **comparison, "prefix": str(prefix),
        "command": str(prefix / "bin" / "codex-hud"), "shellFile": str(shell_file),
        "stateFile": str(state_file), "pluginRegistration": "not-checked",
        "installCommand": [],
    }
    if args.status:
        return {"action": "status", "stage": "inspection", **plan}
    if comparison["versionComparison"] == "unknown":
        raise ValueError(f"Cannot determine the installed HUD version at {prefix}; refusing to overwrite it: "
                         f"{comparison['versionError']}")
    if comparison["versionComparison"] == "downgrade" and not args.allow_downgrade:
        raise ValueError(f"Installed HUD {comparison['installedVersion']} is newer than bundled "
                         f"{metadata['version']} at {prefix}; use --allow-downgrade to permit this downgrade.")
    if args.update:
        if comparison["versionComparison"] == "missing":
            raise ValueError(f"The selected runtime is missing at {plan['command']}; --update requires an existing install.")
        if comparison["versionComparison"] == "same":
            return {"action": "unchanged", "stage": "inspection", **plan}
        if config["language"] is None or config["autostart"] is None:
            raise ValueError("Cannot preserve installation configuration: managed shell.sh/install state is missing "
                             "or incomplete. Use a normal install to configure this runtime.")
    else:
        detected_shell = Path(os.environ.get("SHELL", "")).name
        shell = args.shell or (detected_shell if detected_shell in ("bash", "zsh") else "none")
        plan.update(
            shell=shell, language=args.language or config["language"] or "ko",
            autostart=args.autostart or bool(config["autostart"]),
            startupFiles=[str(path) for path in startup_files(shell, args.rc_file)]
            if config["scope"] == "user" else [],
        )
        if args.autostart and shell == "none" and config["scope"] == "user":
            raise ValueError("--autostart requires --shell bash or --shell zsh.")

    node, npm, codex = (shutil.which(name) for name in ("node", "npm", "codex"))
    if not all((node, npm, codex)):
        raise ValueError("Install Node.js 20+, npm, and Codex CLI on PATH first.")
    version = command_output([node, "--version"])
    match = re.fullmatch(r"v(\d+)\.\d+\.\d+(?:[-+].*)?", version)
    if not match or int(match[1]) < 20:
        raise ValueError(f"Node.js 20+ is required; found {version}.")
    project = Path(plan["project"]) if plan["project"] is not None else None
    shell_text = shell_source(prefix, plan["scope"], project, plan["language"], plan["autostart"])
    quoted_source = shlex.quote(str(shell_file))
    block = (f"{BEGIN}\nif [ -r {quoted_source} ]; then\n"
             f"    . {quoted_source}\nfi\n{END}\n")
    edits = []
    # Update refreshes only the managed source, leaving every startup connection intact.
    startup = [] if args.update else [Path(path) for path in plan["startupFiles"]]
    for path in startup:
        if path in {shell_file.resolve(), (prefix / "bin" / "codex-hud").resolve(), state_file}:
            raise ValueError("A startup file cannot also be the HUD executable, shell source, or install state.")
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
    plan["installCommand"] = install_command
    if args.dry_run:
        return {"action": "dry-run", "stage": "preflight", **plan}

    result = subprocess.run(install_command, check=False)
    if result.returncode:
        raise RuntimeError(f"npm install failed (exit {result.returncode}); shell files were not changed.")
    executable = plan["command"]
    env = {**os.environ, "PATH": str(prefix / "bin") + os.pathsep + os.environ.get("PATH", "")}
    installed_version = command_output([executable, "--version"], env)
    if installed_version != metadata["version"]:
        raise RuntimeError(f"Installed version mismatch: {installed_version}; shell files were not changed.")
    checked_doctor(executable, env)

    current_state = read_install_state(prefix)
    current_state_bytes = state_file.read_bytes() if current_state is not None else None
    if current_state_bytes != state_before:
        raise RuntimeError(f"Install state changed during installation; inspect {state_file} and rerun.")
    current_shell = shell_file.read_text(encoding="utf-8") if shell_file.exists() else ""
    if current_shell != previous:
        raise RuntimeError(f"Managed shell file changed during installation; inspect {shell_file} and rerun.")
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
    saved_state = {"schemaVersion": 1, "owner": STATE_OWNER,
                   **{field: plan[field] for field in STATE_FIELDS}}
    atomic_write(state_file, (json.dumps(saved_state, ensure_ascii=False, indent=2) + "\n").encode("utf-8"), 0o600)
    doctor = checked_doctor(executable, env, after_writes=True)
    return {"action": "updated" if args.update else "installed", "stage": "complete",
            **plan, "backups": backups, "doctor": doctor,
            "previousVersion": comparison["installedVersion"],
            "previousVersionComparison": comparison["versionComparison"],
            "installedVersion": installed_version, "versionComparison": "same",
            "verifiedVersion": installed_version,
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
