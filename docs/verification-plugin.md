# Installer skill and plugin verification — 2026-09-09

Plugin `codex-hud` 0.1.0 contains skill `codex-hud-install` and HUD 0.2.0.
The plugin and standalone skill ZIPs are generated with `npm run package:plugin`.

- `npm test -- --test-reporter=spec`: 216 passed, none failed or skipped.
- `npm run test:installer`: 15 passed.
- `npm run check`: 34 JavaScript files checked.
- Python and Bash syntax checks passed.
- The Codex skill and plugin validators passed for both source and extracted
  archives. Extracted files were compared with their source files.

Installer tests cover dry runs, private backups, preserved permissions and
symlinks, idempotent setup, existing flag aliases, literal arguments, exit codes,
automation bypass, corrupt packages, unsupported Node versions, malformed
startup markers, and install/diagnostic failures before startup-file edits.

The final plugin ZIP was extracted outside the source checkout and installed
into `/tmp/codex-hud-plugin-final-x9yi7ul9/hud`. npm installed five packages using
a populated cache. On this Amazon Linux arm64 machine, `node-pty` compiled
successfully against Node 20.20.1. Diagnostics found Codex CLI 0.153.4 and reported
`inline.available: true`. Native build output is displayed by the installer;
platforms without a prebuilt binary need a compiler, make, and Node headers.

Fresh Bash shells loaded the final generated setup from other directories.
A deterministic local Codex substitute exercised the actual installed HUD and
native PTY: Korean waiting display, resize from 120×36 to 100×28, normal exit,
Ctrl+C with child exit 130, and terminal restoration all passed. The substitute
did not submit model requests. Evidence is in
`/tmp/codex-hud-plugin-final-x9yi7ul9/evidence/terminal-validation.json`.

The personal plugin was installed through `codex plugin add codex-hud@personal`.
The local development copy has a Codex cachebuster suffix; distributable ZIPs
retain version 0.1.0.

VS Code's GUI, macOS, WSL, and Zsh were not driven directly. Native Windows is
outside this POSIX installer's scope. The npm cache does not replace a native
build toolchain, and the archive is not a dependency-complete offline bundle.
