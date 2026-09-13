---
name: codex-hud-install
description: Install, repair, or diagnose the bundled Codex CLI terminal HUD, with optional Bash/Zsh autostart when codex is launched from any directory. Use for requests such as "HUD 설치", "Codex HUD 설정", or "codex 실행할 때 HUD 자동 실행". This is the local my-codex-hud package, not a graphical game HUD or Claude Code status line.
---

# Codex HUD Install

Install the terminal HUD bundled in `assets/`. Resolve all paths relative to this
skill's actual directory, not the current project or an assumed plugin cache.
The skill works independently of the original HUD repository.

## Choose the requested operation

- For a status question, run the installed `codex-hud doctor --json` and
  `codex-hud status --cwd <user-project> --language ko --no-color`. Do not reinstall
  or edit shell files just to answer whether it works.
- For installation or repair, use `scripts/install.py`. It installs the bundled
  npm archive, checks the installed executable, and connects it to shell startup.
- Enable `--autostart` only when requested or already authorized in the
  conversation. It wraps interactive `codex`, `resume`, and `fork`; automation,
  login, help, and version commands continue to use the real executable.
- Keep an already working installation when the user only needs shell setup.
  Inspect its launcher and adapt `assets/codex-hud.sh` to the existing PATH;
  do not create a second install solely to use the helper.

## Install

Requirements: Python 3.9+, Node.js 20+, npm, and an installed Codex CLI on PATH.
The helper supports Linux, macOS, and WSL. Native Windows users can use WSL;
do not install this POSIX shell integration into PowerShell.
When `node-pty` lacks a prebuilt binary for the OS/CPU, installation also needs
a C/C++ compiler, make, and Node headers. The installer displays native build
output; use the actual error to identify missing prerequisites.

The bundled HUD version and SHA-256 are in `assets/package.json`. Do not assume
`my-codex-hud` has been published to npm or invent a GitHub repository URL.
The archive contains the HUD source; npm still needs its dependencies from the
registry or a populated cache. Do not describe the archive as fully offline.

1. Inspect the user's existing `codex` and `codex-hud` commands, shell, and
   relevant startup files. Read only the relevant configuration; do not print
   credentials or entire shell profiles. Preserve existing aliases/functions
   that have unrelated behavior.
2. Resolve this skill's absolute path, then preview the installation:

   ```bash
   python3 /absolute/skill/path/scripts/install.py --dry-run --shell bash --autostart --language ko
   ```

   Omit `--autostart` for a normal installation. Use `--shell zsh` for Zsh, or
   `--shell none` when the user wants no startup-file edits. Choose `--language en`
   for an English HUD. Use `--prefix /absolute/path` for a requested destination.
   `--rc-file /absolute/path` selects one custom startup file instead of the
   defaults. Do not infer the user's preferred shell solely from an agent tool's
   noninteractive shell.
3. Run the same command without `--dry-run` within the authorized scope.
   The default prefix is `$XDG_DATA_HOME/codex-hud`, or
   `~/.local/share/codex-hud` when XDG_DATA_HOME is unset. This does not change npm's
   global prefix or Codex's config/auth files. Bash setup covers `.bashrc` and its
   first login profile; Zsh setup uses `$ZDOTDIR/.zshrc` or `~/.zshrc`.
4. Inspect the returned doctor report. Missing session history is normal before
   the first saved task; `inline.available: false` is an installation failure.
   Dependency failure stops before shell edits. Shell files receive a marked
   block and a private backup on first modification. Repeating the same setup
   does not duplicate it.

If dependencies cannot be fetched, report that error and the actual installation
state. `--offline` is only for a populated npm cache; `--npm-cache PATH` selects a
cache. Do not retry with `sudo`, bypass permissions, or claim success from the
installer's exit status without checking its report.
An npm cache alone does not supply a compiler or uncached Node headers.

## Verify and hand off

Run the installed command by the absolute path returned by the installer:

```bash
/absolute/prefix/bin/codex-hud --version
/absolute/prefix/bin/codex-hud doctor --json
/absolute/prefix/bin/codex-hud demo --language ko --no-color
```

Check command discovery in a fresh interactive shell from a directory outside
the HUD project. For autostart, verify `codex` resolves to a shell function and
`command codex --version` still reaches the original CLI. Do not submit a model
request just to test installation. A real interactive screen requires a TTY;
successful diagnostics alone do not prove what a VS Code window displays.

Tell the user where HUD was installed and which files changed. Give the exact
`source /absolute/prefix/shell.sh` command for an already open terminal, or tell
them to open a new terminal and restart Codex. `command codex ...` bypasses the
HUD for one invocation.

HUD data comes from local rollout JSONL files, not account APIs. An empty usage
limit or waiting state is not automatically a failure. New sessions need their
first saved task; concurrent sessions or a resume into another project can need
`codex-hud start --session <UUID> -- resume <UUID>`.

For an explicitly requested removal, inspect the managed shell block and remove
only HUD's block/source file; preserve unrelated shell content and Codex data.
Do not use a broad recursive delete on a shared prefix.
