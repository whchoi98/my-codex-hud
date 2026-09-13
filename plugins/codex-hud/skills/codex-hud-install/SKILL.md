---
name: codex-hud-install
description: Install, update, repair, or diagnose the bundled Codex CLI terminal HUD for the current user or one project. Use for "HUD 설치", "HUD 업데이트", "HUD 버전 비교", "프로젝트에만 HUD 설치", or "codex 실행할 때 HUD 자동 실행". This is the local my-codex-hud package, not a graphical game HUD or Claude Code status line.
---

# Codex HUD Install

Install the terminal HUD bundled in `assets/`. Resolve all paths relative to this
skill's actual directory, not the current project or an assumed plugin cache.
The skill works independently of the original HUD repository.

## Choose the requested operation

- For a status question, resolve the requested prefix and use
  `scripts/install.py --status --prefix <existing-or-expected-prefix>`. This reads
  installed/bundled versions and saved configuration even when HUD is missing;
  it needs neither npm nor Codex on PATH. If the runtime exists, run its
  `doctor --json`. Run `status --cwd <user-project> --language ko --no-color`
  only when session activity is relevant. Do not reinstall to answer a status question.
- For "HUD 업데이트", use the update branch below. Refreshing a marketplace or
  plugin updates this skill and bundle; it does not update the installed HUD executable.
- To register only this skill, use `scripts/install-skill.py`. It copies the
  complete skill bundle without installing HUD or changing shell startup.
- For installation or repair, use `scripts/install.py`. It installs the bundled
  npm archive, checks the installed executable, and prepares scoped shell integration.
- Enable `--autostart` only when requested or already authorized in the
  conversation. It wraps interactive `codex`, `resume`, and `fork`; automation,
  login, help, and version commands continue to use the real executable.
- Keep an already working installation when the user only needs shell setup.
  Inspect its launcher and reuse `shell_source()` from `scripts/install.py` with
  that prefix and scope; the template needs the generated command/language
  variables. Do not create a second install solely to use the helper.

## Choose the scope

Use a scope already stated or authorized by the user. For a new installation
without a stated scope, ask one question: apply to this user across projects, or
only to the current project? Reuse an existing installation's scope for repair and update.
Do not ask again when the conversation already establishes the choice.

| Scope | Skill registration | HUD default prefix | Shell integration |
| --- | --- | --- | --- |
| `user` | `~/.agents/skills/codex-hud-install` | `$XDG_DATA_HOME/codex-hud` or `~/.local/share/codex-hud` | Selected user startup files; optional autostart across projects |
| `project` | `<project>/.agents/skills/codex-hud-install` | `<project>/.codex-hud` | No user startup edits; manually activate for this terminal |

Resolve the user's project root explicitly. Pass it as `--project-dir` for
project scope; never substitute this skill's directory or its plugin cache.
For a new project installation or skill registration, cwd can supply the default
project directory. For an existing runtime, recover its recorded root or pass a
verified `--project-dir`; the cwd used to locate a prefix is not proof of its scope.
For a new prefix, `install.py` defaults to `user`; an existing prefix can recover
its saved scope. `install-skill.py` requires an explicit `--scope`.

For skill registration, preview then run the same command without `--dry-run`:

```bash
python3 /absolute/skill/path/scripts/install-skill.py --scope user --dry-run
python3 /absolute/skill/path/scripts/install-skill.py --scope project --project-dir /absolute/project --dry-run
```

Choose one scope for each requested registration. Python 3.9+ is enough for this
copy step. Verify `skillPath` and the complete scripts/assets in the result.
Preserve unrelated skills and heed collision errors instead of deleting the
destination. Registering a project copy does not remove a user or plugin copy.

## Update an existing HUD

Resolve the target from the user's stated scope/path, previous installer report,
or existing command. Check the project prefix and user installation when relevant;
if both exist and the request does not identify one, ask which to update.
Do not substitute the current directory, plugin cache, or a new default prefix
for a known custom installation.

Inspect that exact target before deciding what to run:

```bash
python3 /absolute/skill/path/scripts/install.py --status --prefix /absolute/existing/prefix
```

Read `installedVersion`, `bundledVersion`, and `versionComparison`:

| Comparison | Action |
| --- | --- |
| `upgrade` | The bundle is newer; preview and update the selected runtime. |
| `same` | `--update` reports `unchanged` without reinstalling. Use repair if something is broken. |
| `downgrade` | The bundle is older; refresh the plugin/skill through its established source before updating HUD. |
| `missing` | There is no runtime at this prefix; report that or use the installation branch if installation was requested. |
| `unknown` | Explain `versionError`; resolve the version before attempting a replacement. |

For an authorized update:

```bash
python3 /absolute/skill/path/scripts/install.py --update --prefix /absolute/existing/prefix --dry-run
python3 /absolute/skill/path/scripts/install.py --update --prefix /absolute/existing/prefix
```

`--update` preserves scope, project root, prefix, language, autostart, and existing
startup connections. It rejects `--shell`, `--rc-file`, `--language`, and
`--autostart`; omit them instead of copying a fresh-install example.
It never edits user startup files. `--scope project --project-dir /absolute/project`
can select that project's default prefix. If legacy metadata cannot identify a
custom project root, supply the verified `--project-dir`.

The installer compares versions before npm runs, including on normal install and
repair. `--allow-downgrade` is only for an explicit request to install a known older
version, never a retry for an unexplained failure. Older copies of the installer
do not gain this protection retroactively; use the refreshed skill's script.
Unparseable installed versions cannot be bypassed by this flag.

An update may leave npm files changed if later validation fails. Report the actual
failure stage and files left in place. Successful reports include `verifiedVersion`;
recheck the returned absolute command, then re-source its `shellFile` when the
current shell needs the updated function.

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

1. Inspect the user's existing `codex` command, the HUD executable for the selected
   scope, and shell. For user scope, inspect only the relevant startup configuration;
   do not print credentials or entire profiles. Project scope does not need user
   profile edits. Preserve existing aliases/functions with unrelated behavior.
2. Resolve this skill's absolute path. Compare existing and bundled versions with
   `--status` for the selected prefix, then preview the installation:

   ```bash
   python3 /absolute/skill/path/scripts/install.py --scope user --dry-run --shell bash --autostart --language ko
   python3 /absolute/skill/path/scripts/install.py --scope project --project-dir /absolute/project --dry-run --shell none --autostart --language ko
   ```

   Run only the matching scope command. Omit `--autostart` for a first installation
   without autostart. Omission preserves existing autostart on reinstall.
   User scope uses `--shell zsh` for Zsh or `--shell none` to avoid startup edits.
   Project scope never edits startup files, even with `--shell bash` or `zsh`;
   its generated integration still requires Bash/Zsh when activated.
   `--language en` selects the autostart language; direct HUD commands use their
   own CLI/config preferences. A project `--prefix` must remain in a subdirectory
   of the project. `--rc-file` is user-only. Do not infer the preferred shell solely
   from an agent tool's noninteractive shell.
3. Run the same command without `--dry-run` within the authorized scope.
   Check `scope`, `project`, `prefix`, and `startupFiles` in the preview.
   Project scope must report an empty `startupFiles` list. Neither scope changes
   npm's global prefix setting or Codex's config/auth files. User Bash setup covers
   `.bashrc` and its first login profile; user Zsh setup uses `$ZDOTDIR/.zshrc`
   or `~/.zshrc`. Do not reuse one prefix for different scopes.
4. Inspect the returned doctor report. Require `inline.available: true` and
   `inline.probe.status: ok`; addon loading alone is insufficient. Missing session
   history is normal before the first saved task.
   Dependency failure stops before shell edits. User startup files receive a marked
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
/absolute/prefix/bin/codex-hud doctor --json --bundle /absolute/skill/path/assets/package.json
/absolute/prefix/bin/codex-hud demo --language ko --no-color
```

`--bundle` is available in HUD 0.7.0+. For older runtimes, use plain `doctor --json`
and the installer's `--status` comparison. Plain doctor automatically checks an
enabled HUD plugin's cached bundle when it can identify exactly one. An explicit
bundle selects this skill's metadata when several plugins are enabled or a
standalone skill is being used.

Report three separate states:

- **Registration:** confirm the plugin through `codex plugin list --json`, or the
  standalone skill's actual registration result. A bundle on disk alone does not
  prove registration. Installer `pluginRegistration: not-checked` is not success.
- **HUD runtime:** give the absolute command, installed version and selected
  prefix/scope. `plugin add` alone does not install this executable.
- **Autostart:** report whether it is configured and which shell file must be
  sourced. `hud.autostart.active: null` means the child process cannot confirm
  the current shell's function; it does not mean autostart is disabled.

For user scope, check command discovery in a fresh interactive shell outside the
HUD source project. For project scope, activate the returned `shellFile` in an
interactive Bash/Zsh terminal; a new terminal alone does not activate it.
Project autostart checks the physical working directory, including Codex
`-C`/`--cd` options before `--`, and applies only inside the project or its
subdirectories. Outside that scope it uses an activated user installation if
present, otherwise the original Codex executable. Do not change global profiles
to make a project install automatic in future terminals.

For autostart, verify `codex` resolves to a shell function and
`command codex --version` still reaches the original CLI. Do not submit a model
request just to test installation. A real interactive screen requires a TTY;
successful diagnostics alone do not prove what a VS Code window displays.
For a terminal-specific failure, compare `type -a codex codex-hud`, both TTY
descriptors, and doctor terminal/Node information. A loaded function does not
prove that its selected command or PTY can start. Older doctor versions only
checked native module loading; use the new spawn probe and its helper diagnostics.

Tell the user the scope, project (if any), install path, and changed files.
Give the exact `source /absolute/prefix/shell.sh` command when activation is needed.
Only user startup integration also applies in a fresh terminal. Project installs
can be run directly by the returned absolute executable path without activation.
Keep generated `.codex-hud/` runtime files out of project commits.
Restart Codex to attach HUD; `command codex ...` bypasses it for one invocation.

HUD data comes from local rollout JSONL files, not account APIs. An empty usage
limit or waiting state is not automatically a failure. New sessions need their
first saved task; concurrent sessions or a resume into another project can need
`codex-hud start --session <UUID> -- resume <UUID>`.

For an explicitly requested removal, inspect the managed shell block and remove
only HUD's block/source file; preserve unrelated shell content and Codex data.
Do not use a broad recursive delete on a shared prefix.
