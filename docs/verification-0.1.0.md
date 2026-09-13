# Verification — 0.1.0 (2026-09-09)

Version: `my-codex-hud@0.1.0`.

## Automated checks

- `npm test -- --test-reporter=spec`: **122 passed**, 0 failed, 0 skipped.
- `npm run check`: **23 JavaScript files** checked.
- Regression tests cover all issues found during code review, including
  authoritative tool outcomes, process tracking across turns, malformed JSON
  fields, effective subagent models, and rapid same-size file replacement.

The environment sandbox blocks Node subprocess pipes with `EPERM`; the full
suite was run with the approved sandbox escalation. No production workaround
was introduced for that environment restriction.

## Actual terminal checks

Environment: Node.js 20.20.1, Codex CLI 0.153.4, Amazon Linux 2023 (arm64).

- A real local Codex rollout produced model, context, tool, and agent metadata
  with 0 malformed records. No private session content was copied into fixtures.
- A real PTY rendered the HUD, resized from 100 to 40 columns without overflowing,
  and returned exit code 0 on SIGINT. Cursor visibility and the original screen
  were restored.
- tmux 3.2a was extracted from the distribution's RPM into a temporary directory,
  without a system installation.
- Starting outside tmux produced a Codex pane above a 7-row HUD and attached
  successfully.
- Starting inside an existing tmux session produced a new window, with the
  essential preset occupying 5 rows. Korean, ASCII, width and Git preferences
  reached the child HUD.
- A window-local `pane-exited` hook matched the exact Codex pane and closed only
  its HUD. The existing test window remained intact after the new window closed.
- All test tmux sessions were stopped.

tmux tests used a local Codex fixture executable that wrote synthetic rollout
records and waited for terminal input. No model API requests were made by these
tests. Actual Codex compatibility was checked separately through its existing
rollout and version command.

## Package checks

`npm pack` produced `my-codex-hud-0.1.0.tgz` (30,713 bytes, 18 files).

The final archive was installed offline into `/tmp/codex-hud-final-install`.
The installed executable passed version, demo JSON and live-session JSON checks.
The installed transcript reader matched the final source byte for byte.
Native setup output and Codex diagnostics were also checked through an installed
package.

No global user installation, Codex configuration edit, registry publication,
or repository push was performed.

## Compatibility boundary

The HUD reads Codex's internal rollout JSONL and displays the last recorded usage
snapshot. It does not poll account APIs. Automatic discovery uses the exact
session creation directory; users with concurrent sessions should pin a UUID or
path. The companion HUD uses a dedicated terminal or tmux pane; `setup` prints
configuration for Codex's separate built-in status line.
