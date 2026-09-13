# Inline Codex HUD Implementation Plan

**Goal:** Run Codex and the complete HUD in one terminal, with the HUD fixed at the bottom and no tmux requirement.

**Architecture:** A PTY provides Codex with a smaller terminal. A headless emulator supplies the Codex screen to a compositor, which paints it alongside the existing HUD. The launcher manages input, polling, resizing, and cleanup.

**Spec:** `docs/superpowers/specs/2026-09-09-inline-hud-design.md`

## Tasks

- [x] Install exact PTY and emulator dependencies.
- [x] Implement `src/pty.js` and `tests/pty.test.js`: resolve the Codex executable, preserve literal argv, derive the HUD session context, set the child environment, expose `prepareCodex(settings)`, `createPty(options)`, and `ptyAvailable()`, and validate real PTY behavior.
- [x] Implement `src/screen.js` and `tests/screen.test.js`: terminal layout, ANSI interpretation, styled cell rendering, fixed HUD rows, cursor/modes, query responses, and scrollback. Regressions must assert the resulting outer terminal screen.
- [x] Implement `src/inline.js` and `tests/inline.test.js`: compose PTY, screen, incremental HUD polling, input forwarding, resize, exit handling, and terminal restoration. Export `launchInline(settings)` returning `{ exitCode, signal }`.
- [x] Update `src/cli.js` and `tests/cli.test.js`: default `start` to inline, keep `start --tmux`, and expose backend availability in `doctor`. Update the Korean README with the single-terminal workflow and platform requirements.
- [x] Validate with a deterministic interactive child and installed Codex CLI, run regressions and syntax checks, review lifecycle failures, and build an updated installable package.
- [x] Record verification evidence and deliver the exact command to the user.

Final evidence: 216 tests passed, 34 JavaScript files syntax-checked, actual
Codex CLI 0.153.4 exercised through the final 0.2.0 package, and all 24 packaged
files matched source and installation. See `docs/verification.md`.

## Ownership

The PTY adapter and CLI/documentation changes can proceed independently. The parent implements the compositor and lifecycle orchestration, then integrates and validates all three components. Existing `src/launch.js` remains the tmux backend.
