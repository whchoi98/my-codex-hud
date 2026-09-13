# Inline Codex HUD

The user wants the full HUD pinned below Codex inside one VS Code terminal, without a second terminal or tmux. This extends the existing `start` command.

## Execution and display

`codex-hud start` launches Codex in a pseudoterminal using `node-pty`. A headless xterm instance interprets Codex's terminal output. The launcher paints that screen above the existing HUD; Codex never receives the HUD's rows as part of its terminal size. This keeps clears, scrolling, alternate screens, and absolute cursor movement inside the Codex area.

The full preset reserves seven HUD rows and a separator. Essential and minimal reserve five and two rows. Very short terminals reduce the HUD height while keeping at least four rows for Codex. Resize events update the emulator, PTY, and fixed HUD position together.

Keyboard input goes to Codex, including Ctrl+C, Ctrl+D, and bracketed paste. Terminal queries receive responses from the virtual terminal. Shift+PageUp/Shift+PageDown access the wrapper's normal-screen scrollback. Child mouse input is limited to the Codex area. No child escape sequence is copied blindly onto the outer screen.

The wrapper owns an alternate screen and restores raw mode, the cursor, mouse/paste modes, and the original screen on normal exit, signals, and failures. Child exit codes are preserved. Pending output is drained before disposal.

Physical writes use an asynchronous filesystem stream on the existing terminal descriptor so a stalled terminal does not block JavaScript signal handling. Shutdown finishes the owned process group even if its leader exits first. The descriptor itself is not closed. Rendering needs a minimum two-column emulator; on a one-column host, Codex receives two columns and the physical display clips to one.

Mouse-wheel events scroll the normal-screen history even when Codex does not request mouse capture. Holding Shift permits host text selection. For child mouse capture, SGR reports stay text and legacy reports are converted to raw bytes. Both strings and Buffers pass directly to the PTY.

## Existing functionality

The existing renderer, incremental transcript reader, session selection, and Git status remain the HUD data source. `--cwd`, Codex `-C`/`--cd`, custom `CODEX_HOME`, new-session cutoff, explicit sessions, and resume/fork keep their existing meaning. `watch` remains a separate monitor. `start --tmux` selects the existing tmux launcher explicitly.

Node.js 20 remains the minimum. Exact runtime dependencies are `node-pty` 1.1.0, `@xterm/headless` 6.0.0, and `@xterm/addon-unicode11` 0.9.0. Inline launch targets Linux, macOS, and WSL; native Windows users can use WSL for inline launch or the existing standalone monitor.

## Validation

Use real emulator screens to assert HUD isolation after clears, scrolling, alternate-screen changes, and resize. Test Unicode, styled text, cursor placement, input, query responses, and bounded buffering. Use real PTYs and a deterministic child fixture for keyboard, resize, exit, signal cleanup, cwd, and environment integration. Smoke-test the installed Codex CLI without sending a model request. Run existing regression tests and package smoke checks.
