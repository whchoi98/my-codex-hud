import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { loadConfig, nativeStatusLine } from './config.js';
import { demoState } from './demo.js';
import { findSession } from './sessions.js';
import { renderHud, renderWaiting } from './render.js';
import { sanitizeText } from './terminal.js';
import { snapshot, watch, renderOptions } from './watch.js';

const exec = promisify(execFile);
const COMMANDS = ['watch', 'status', 'start', 'setup', 'demo', 'doctor'];
const HELP = `Codex HUD — local session activity for Codex CLI

Usage:
  codex-hud watch                   Live HUD only (default command)
  codex-hud start [-- CODEX_ARGS]    Codex above a fixed HUD in this terminal
  codex-hud start --tmux            Codex + HUD in a new tmux window (optional)
  codex-hud status [--json]         One snapshot
  codex-hud demo [--json]           Offline preview
  codex-hud setup                   Print native status-line TOML
  codex-hud doctor [--json]         Check Codex, inline PTY and optional tmux

Options:
  --tmux                   Use the tmux backend (start only)
  --cwd, -C PATH            Match this project directory (default: current)
  --codex-home PATH         Codex data directory (default: $CODEX_HOME or ~/.codex)
  --session, -s PATH|UUID   Pin a rollout file or thread ID
  --follow                 Follow newer root sessions in the same directory
  --preset, -p NAME         full | essential | minimal (default: full)
  --language LANG          en | ko (default: en)
  --interval MS            Refresh interval, 200–60000 (default: 1000)
  --width COLUMNS          Maximum display width
  --path-levels N          Show 1–3 project path components
  --config PATH            Read alternate HUD JSON preferences
  --ascii                  ASCII bars and status symbols
  --no-color               Disable colors (also respects NO_COLOR)
  --no-git                 Skip Git status
  --mouse                  Capture the mouse for HUD/virtual scrolling (default: off)
  --no-mouse               Use native dragging, overriding saved mouse capture
  --json                   Output a single JSON snapshot (not start/setup)
  --once                   Print once, even in a terminal (not start)
  --help, -h               Show help
  --version, -v            Show version

watch prints once when redirected. It pins the first matching root session;
use --session when multiple Codex sessions share the same directory.
start uses one terminal, including the VS Code integrated terminal. It needs
Codex on PATH, node-pty and an interactive terminal on Linux, macOS or WSL.
The HUD stays below Codex on resize. Ctrl+C is forwarded to Codex; its exit
restores terminal modes. Default start keeps output in native terminal scrollback:
use the wheel to browse output and drag to select text for your terminal's copy command.
--mouse keeps the alternate-screen HUD and captures wheel input instead.
Inline start adds Codex's --no-alt-screen option so its output has scrollback.
Shift+PageUp/Shift+PageDown browse the emulated normal-screen history.
Alt+L switches the live HUD between English and Korean. Alt+M freezes the
display for selection; press again to resume. With --mouse it also releases capture.
While selecting, Up/Down browse output without changing Codex's command history.
These shortcuts also work in interactive watch. Pasted text stays unchanged.
full lists running agents only. Alt+PageUp/Alt+PageDown scroll overflowing HUD
rows; watch also accepts PageUp/PageDown and arrow keys. --mouse enables HUD wheel scrolling.
The header shows the recorded approval mode; full also lists observed skill reads.
Use start --tmux for the optional tmux backend, or watch on native Windows.
setup prints configuration without modifying files.
`;

function numberOption(value, name) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a positive integer`);
  return Number(value);
}

function parse(argv) {
  const delimiter = argv.indexOf('--');
  const args = delimiter === -1 ? argv : argv.slice(0, delimiter);
  const codexArgs = delimiter === -1 ? [] : argv.slice(delimiter + 1);
  const { values, positionals } = parseArgs({
    args, allowPositionals: true, strict: true,
    options: {
      help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
      cwd: { type: 'string', short: 'C' }, 'codex-home': { type: 'string' },
      session: { type: 'string', short: 's' }, follow: { type: 'boolean' },
      preset: { type: 'string', short: 'p' }, language: { type: 'string' },
      interval: { type: 'string' }, width: { type: 'string' }, 'path-levels': { type: 'string' },
      config: { type: 'string' }, ascii: { type: 'boolean' },
      'no-color': { type: 'boolean' }, 'no-git': { type: 'boolean' },
      mouse: { type: 'boolean' }, 'no-mouse': { type: 'boolean' },
      json: { type: 'boolean' }, once: { type: 'boolean' }, since: { type: 'string' },
      tmux: { type: 'boolean' },
    },
  });
  const command = positionals[0] ?? 'watch';
  if (values.help || command === 'help') return { command: 'help' };
  if (values.version) return { command: 'version' };
  if (!COMMANDS.includes(command)) throw new Error(`Unknown command: ${command}. Run codex-hud --help.`);
  if (positionals.length > 1) throw new Error('Unexpected argument. Put Codex arguments after start --.');
  if (codexArgs.length && command !== 'start') throw new Error('Arguments after -- are only accepted by start');
  if (values.tmux && command !== 'start') throw new Error('--tmux is only supported by start');
  if (values.json && ['start', 'setup'].includes(command)) throw new Error(`--json is not supported by ${command}`);
  if (values.once && command === 'start') throw new Error('--once is not supported by start');
  return { command, values, codexArgs };
}

async function versionOf(executable, args) {
  try {
    const { stdout } = await exec(executable, args, { timeout: 3000, maxBuffer: 65536, windowsHide: true });
    return sanitizeText(stdout.trim()) || null;
  } catch {
    return null;
  }
}

async function inlineAvailability() {
  try {
    const { ptyAvailable } = await import('./pty.js');
    const result = await ptyAvailable();
    return {
      available: result.available,
      ...(result.error ? { error: sanitizeText(result.error.message ?? result.error) } : {}),
    };
  } catch (error) {
    return { available: false, error: sanitizeText(error?.message ?? error) };
  }
}

async function doctor(settings) {
  const [codex, inline, tmux, sessions, selected] = await Promise.all([
    versionOf('codex', ['--version']),
    inlineAvailability(),
    versionOf('tmux', ['-V']),
    stat(join(settings.codexHome, 'sessions')).then(info => info.isDirectory()).catch(() => false),
    findSession(settings).catch(() => null),
  ]);
  return { node: process.version, codex, inline, tmux, codexHome: settings.codexHome, sessionsDirectory: sessions, matchingSession: selected };
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parse(argv);
  if (parsed.command === 'help') { process.stdout.write(HELP); return; }
  if (parsed.command === 'version') {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    process.stdout.write(`${pkg.version}\n`);
    return;
  }
  const { values, codexArgs, command } = parsed;
  const cwd = resolve(values.cwd ?? process.cwd());
  const codexHome = resolve(values['codex-home'] ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'));
  const preferences = await loadConfig({
    codexHome,
    configPath: values.config ? resolve(values.config) : undefined,
    overrides: {
      preset: values.preset, language: values.language,
      interval: numberOption(values.interval, 'interval'),
      width: numberOption(values.width, 'width'),
      pathLevels: numberOption(values['path-levels'], 'path-levels'),
      color: values['no-color'] ? false : undefined,
      ascii: values.ascii,
      git: values['no-git'] ? false : undefined,
      mouse: values['no-mouse'] ? false : values.mouse,
    },
  });
  const settings = {
    ...preferences, cwd, codexHome, session: values.session,
    configPath: values.config ? resolve(values.config) : undefined,
    color: preferences.color && process.env.NO_COLOR === undefined,
    follow: Boolean(values.follow), since: numberOption(values.since, 'since'),
  };
  if (command === 'setup') {
    process.stdout.write(nativeStatusLine(settings.preset));
    return;
  }
  if (command === 'doctor') {
    const report = await doctor(settings);
    if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      process.stdout.write([
        'Codex HUD diagnostics',
        `Node: ${report.node}`,
        `Codex: ${report.codex ?? 'not found (needed for start)'}`,
        `Inline PTY: ${report.inline.available ? 'available (default start backend)'
          : `unavailable${report.inline.error ? `: ${report.inline.error}` : ''}`}`,
        ...(report.inline.available ? [] : [
          'Inline start: use Linux/macOS/WSL with working node-pty; reinstall dependencies with native build tools, or use watch.',
        ]),
        `tmux (optional, start --tmux): ${report.tmux ?? 'not found'}`,
        `Codex home: ${sanitizeText(report.codexHome)}`,
        `Sessions directory: ${report.sessionsDirectory ? 'found' : 'not created yet'}`,
        `Matching session: ${sanitizeText(report.matchingSession) || 'none; start Codex in this directory'}`,
      ].join('\n') + '\n');
    }
    return;
  }
  if (command === 'start') {
    if (values.tmux) {
      const { launch } = await import('./launch.js');
      await launch({ ...settings, codexArgs, cliPath: fileURLToPath(new URL('../bin/codex-hud.js', import.meta.url)) });
    } else {
      const { launchInline } = await import('./inline.js');
      const { exitCode } = await launchInline({ ...settings, codexArgs });
      process.exitCode = exitCode;
    }
    return;
  }
  if (command === 'watch' && process.stdout.isTTY && !values.once && !values.json) {
    await watch(settings);
    return;
  }
  const state = command === 'demo' ? demoState() : await snapshot(settings);
  const output = values.json ? JSON.stringify(state, null, 2)
    : state ? renderHud(state, renderOptions(settings)) : renderWaiting(renderOptions(settings));
  process.stdout.write(`${output}\n`);
}
