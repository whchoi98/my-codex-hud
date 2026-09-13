# Codex HUD design

## Goal

Build a usable Codex CLI companion inspired by Jarrod Watts's `claude-hud`.
The workspace was empty. The implementation is independent JavaScript, with
attribution to the upstream project's design.

## Integration

Codex's documented `tui.status_line` accepts item identifiers, not a command
receiving JSON on stdin. Therefore the package provides:

1. `codex-hud watch`: a live terminal HUD reading local Codex rollout JSONL.
2. `codex-hud start`: Codex and the HUD in a tmux window.
3. `codex-hud setup`: print a native status-line configuration snippet.
4. `codex-hud status --json`: a single normalized snapshot for other consumers.
5. `codex-hud demo` and `doctor`: an offline preview and installation diagnostics.

No modifications to the Codex executable, credentials, or existing user config.
No network access or model requests by the HUD. `start` launches the user's Codex
command, which retains its normal behavior.

## Data

Read `$CODEX_HOME/sessions` (default `~/.codex/sessions`). Select the most recently
modified root session whose creation working directory matches `--cwd` exactly.
An explicit `--session` accepts a rollout path or a thread UUID. `watch` pins the
first matching session unless `--follow` is set. Child sessions are never
automatically selected as the root session.

Parse metadata, turn context, token-count snapshots, function/custom tool
calls/results, web search calls, plan updates, collaboration events, and turn
completion/interruption. Unknown records are ignored. Only compact display
metadata is retained; prompts, reasoning, encrypted content, and tool outputs
are not part of the exported state.

Current context is the most recent response's `total_tokens` divided by the
reported model context window. Cumulative token usage is shown separately.
This ratio can differ from Codex's own baseline-adjusted footer. A compaction
invalidates the old context count until another usage snapshot arrives.
Absent counters and usage limits stay unavailable rather than becoming zero.
Rate-limit reset times are Unix seconds.

Read append-only files incrementally, tolerate partial UTF-8 and JSON lines,
restart after truncation/replacement, and cap retained activity and record size.
Git is read with argument arrays, a timeout, and optional locks disabled.

## Interface shared by modules

`SessionState` is a plain JSON-serializable object:

```js
{
  session: { id, cwd, model, effort, provider, cliVersion, startedAt, updatedAt,
    status, source, path },
  context: { usedTokens, windowTokens, percent, updatedAt },
  tokens: { input, cached, output, reasoning, total },
  rateLimits: { primary, secondary, planType, updatedAt },
  // a window: { usedPercent, windowMinutes, resetsAt }
  tools: [{ id, name, target, status, startedAt, endedAt }],
  agents: [{ id, name, role, model, status, startedAt, endedAt }],
  plan: [{ step, status }],
  compactions: 0,
  diagnostics: { malformedLines, oversizedLines },
  git: null // or { branch, dirty, ahead, behind, changed, untracked }
}
```

Times are epoch milliseconds, except `resetsAt` (Unix seconds). Missing values
are `null`. Session status: `idle`, `working`, `complete`, `interrupted`.
Tool/agent status: `running`, `completed`, `error`, `interrupted`, `closed`.
Plan status: `pending`, `in_progress`, `completed`.

Render options: `{ preset: 'full'|'essential'|'minimal', width, color, ascii,
language: 'en'|'ko', pathLevels: 1|2|3, now }`.
`renderHud(state, options)` returns a string (no terminal writes).
`renderWaiting(options)` returns a string.

## Packaging and validation

Node.js 20+ ESM, zero npm dependencies, built-in `node:test`. The package name is
`my-codex-hud`, executable `codex-hud`. No compilation step.

Verify actual fixture parsing, cumulative-vs-context semantics, compaction,
tool lifecycle, plan replacement, agent status, malformed/partial input,
file rotation, root-session selection, Unicode widths, terminal escape removal,
Git changes, CLI errors, non-TTY behavior, and safe tmux argument handling.
Smoke-test the installed npm tarball and a local Codex rollout. Keep private
session data out of fixtures and documentation.

## Reference

- https://github.com/jarrodwatts/claude-hud (MIT, inspected 2026-09-09)
- https://developers.openai.com/codex/config-reference/
- https://github.com/openai/codex (`9e868bd`, protocol and TUI sources)
- Installed Codex CLI: 0.153.4

The rollout format is an internal Codex format and may change. Compatibility
is verified against the inspected version; future records are ignored.
