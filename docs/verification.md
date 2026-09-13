# Verification — 0.2.0 (2026-09-09)

`codex-hud start` now launches Codex above the full HUD inside one terminal.
The previous launcher remains available as `codex-hud start --tmux`.

## Automated checks

- `npm test -- --test-reporter=spec`: **216 passed**, 0 failed, 0 skipped.
- `npm run check`: **34 JavaScript files** checked, including fixtures.
- Tests exercise real PTYs, terminal cell buffers, local rollouts, temporary Git
  repositories, and CLI processes. They do not submit model requests.
- The full test suite ran with approved sandbox escalation because the
  environment restricts PTY and Node subprocess operations.

The tests cover fixed footer placement across clears, scrolling and alternate
buffers; Unicode and styled cells; resize down to a one-column physical display;
cursor resets; UTF-8 paste; modern and legacy mouse input; terminal queries;
session selection; and exit-code and raw-mode restoration.

Review found six issues that were reproduced and fixed:

- Process-group cleanup now continues after the Codex leader exits, including
  descendants that ignore TERM/HUP.
- An asynchronous filesystem stream prevents stalled physical output from
  blocking JavaScript signal handling. Output remains ordered and is drained
  before the wrapper finishes.
- The PTY and emulator use the same minimum two-column geometry, while physical
  painting clips to the host width.
- DECSTR resets the painted cursor visibility and style.
- Mouse reports follow the child's selected encoding, including raw bytes.
- Both launchers share an argument parser that distinguishes option values
  such as `--profile resume` from real resume/fork subcommands.

The reviewer's original lifecycle reproductions also passed after the fixes.

## Actual Codex CLI check

Environment: Node.js **20.20.1**, Codex CLI **0.153.4**, Amazon Linux 2023 arm64.

The actual installed Codex binary was launched through the final packaged HUD
using a temporary Codex home and a custom provider pointing only at localhost.
No prompt was submitted. This verified:

- The real Codex header/input area and fixed HUD in the same terminal.
- Korean text entered into the actual Codex input field.
- Resize from **100×32** to **80×26**, retaining the input and footer position.
- Ctrl+C exiting Codex with code **0**, and restoration of the original screen.

Codex did not create a rollout before a first submitted task in this smoke test,
so the footer correctly showed its waiting state. Detailed live HUD data was
verified separately using the deterministic PTY child and actual local rollouts.
The smoke-test captures are under `/tmp/codex-hud-real-inline-pGPbRL`.

VS Code's GUI was not driven directly. macOS, WSL, and native Windows were not
runtime-tested; inline mode explicitly requires Linux, macOS, or WSL. Native
Windows retains the standalone monitor commands.

## Package and local command

- Final archive: `my-codex-hud-0.2.0.tgz`, **42,755 bytes**, **24 files**.
- Installed offline from that archive into
  `/tmp/codex-hud-inline-package-install`.
- All 24 packaged files match both the final source and installed copy byte for
  byte.
- The installed executable reports **0.2.0**. Its actual Codex TUI smoke test
  passed, as did demo and native PTY availability checks.
- The user's existing `codex-hud` command resolves to this working tree and now
  reports **0.2.0** with inline PTY available. System tmux is absent and the
  default launcher no longer requires it.

No real Codex preferences or credentials were changed. Nothing was published
to a registry or pushed to a repository.

## Data and display boundaries

HUD metrics are the last available values from local Codex rollout JSONL; the
HUD does not query account APIs. Fresh Codex launches can show a waiting footer
until Codex writes the first rollout. Concurrent sessions in the same directory
can still require an explicit session UUID/path.

The renderer reserves seven full-preset HUD rows plus a separator when space
allows, reducing the HUD on very short terminals. The virtual terminal retains
up to 5,000 scrollback lines in memory. Mouse-wheel scrolling and Shift-drag
selection are documented in the README.

Historical standalone/tmux verification is retained in
`docs/verification-0.1.0.md`.
