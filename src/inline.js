import { constants } from 'node:os';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as delay } from 'node:timers/promises';
import { createPty, prepareCodex } from './pty.js';
import { InlineScreen } from './screen.js';
import { HudSource } from './hud-source.js';
import { renderWaiting } from './render.js';
import { renderOptions } from './watch.js';
import { truncateText } from './terminal.js';
import { terminalOutput } from './output.js';

const ENTER = '\x1b[?1049h\x1b[?25l\x1b[?7l';
const LEAVE = '\x1b[?2026l\x1b[0m\x1b[?9l\x1b[?1000l\x1b[?1002l\x1b[?1003l'
  + '\x1b[?1006l\x1b[?1004l\x1b[?2004l\x1b[?1l\x1b>\x1b[?7h\x1b[0 q\x1b[?25h\x1b[?1049l';
const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const HIGH_WATER = 1024 * 1024;
const LOW_WATER = 256 * 1024;

/**
 * Run Codex and the full HUD in the current terminal. Only this function owns
 * physical terminal modes. Codex writes into a smaller, emulated PTY.
 */
export async function launchInline(settings = {}) {
  const stdin = settings.stdin ?? process.stdin;
  const stdout = settings.stdout ?? process.stdout;
  const stderr = settings.stderr ?? process.stderr;
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('codex-hud start requires an interactive TTY on stdin and stdout. Run it in a terminal.');
  }
  const context = await prepareCodex(settings);
  if (context.note) stderr.write(`codex-hud: ${context.note}\n`);
  const hudSettings = context.hudSettings;
  const source = new HudSource(hudSettings);
  const abort = new AbortController();
  const decoder = new StringDecoder('utf8');
  const pendingWrites = new Set();
  const handlers = [];
  let child;
  let failure;
  let requestedSignal;
  let terminated = false;
  let active = false;
  let restored = false;
  let paintTimer;
  let escapeTimer;
  let killTimer;
  let killDeadline;
  let outputBlocked = false;
  let childPaused = false;
  let pendingBytes = 0;
  let polling = Promise.resolve();
  let resolveExit;
  const exited = new Promise(resolve => { resolveExit = resolve; });
  const wasRaw = Boolean(stdin.isRaw);
  const wasFlowing = stdin.readableFlowing;

  function signalChild(signal) {
    if (!child) return;
    try {
      // forkpty creates a new session/process group. Signal only this launch's
      // group, so subprocesses do not outlive the terminal wrapper.
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') {
        try { child.kill(signal); } catch { /* The child may have just exited. */ }
      }
    }
  }

  function stop(signal = 'SIGTERM') {
    if (!requestedSignal) requestedSignal = signal;
    abort.abort();
    signalChild(signal);
    if (!killTimer && !terminated) {
      killDeadline = Date.now() + 1500;
      killTimer = setTimeout(() => signalChild('SIGKILL'), 1500);
    }
  }

  function groupExists() {
    if (!child) return false;
    try { process.kill(-child.pid, 0); return true; }
    catch (error) { return error.code !== 'ESRCH'; }
  }

  async function cleanUpGroup() {
    if (!groupExists()) return;
    // Exiting the PTY leader does not mean its process group is empty. Keep
    // the escalation deadline alive until remaining owned workers are gone.
    signalChild('SIGTERM');
    const deadline = killDeadline ?? Date.now() + 300;
    while (groupExists() && Date.now() < deadline) await delay(20);
    if (groupExists()) signalChild('SIGKILL');
    const reapDeadline = Date.now() + 250;
    while (groupExists() && Date.now() < reapDeadline) await delay(10);
  }

  function fail(error) {
    failure ??= error;
    stop();
  }

  function flowControl() {
    if (!child || terminated) return;
    const pause = outputBlocked || pendingBytes >= HIGH_WATER;
    if (pause && !childPaused) {
      child.pause();
      childPaused = true;
    } else if (childPaused && !outputBlocked && pendingBytes < LOW_WATER) {
      child.resume();
      childPaused = false;
    }
  }

  function hostWrite(data) {
    if (!data || !active) return;
    try {
      if (!output.stream.write(data)) outputBlocked = true;
      flowControl();
    } catch (error) { fail(error); }
  }

  function send(data) {
    if (!data || !child || terminated) return;
    try { child.write(data); } catch (error) { fail(error); }
  }

  const screen = new InlineScreen({
    columns: stdout.columns, rows: stdout.rows, preset: hudSettings.preset,
    ascii: hudSettings.ascii, color: hudSettings.color, language: hudSettings.language,
    mouse: hudSettings.mouse,
    onLanguageChange: language => {
      hudSettings.language = language;
      setHud(source.render(renderOptions(hudSettings, stdout)));
    },
    onResponse: send, onHostWrite: hostWrite,
  });
  const output = terminalOutput(stdout);

  function setHud(frame) {
    if (screen.setHud(frame) && child && !terminated) {
      child.resize(screen.layout.ptyColumns, screen.layout.codexRows);
    }
  }

  function paint(force = false) {
    if (!active || outputBlocked) return;
    try { hostWrite(screen.frame({ force })); } catch (error) { fail(error); }
  }

  function schedulePaint() {
    if (!active || paintTimer) return;
    paintTimer = setTimeout(() => {
      paintTimer = undefined;
      paint();
    }, 16);
  }

  function onData(data) {
    pendingBytes += Buffer.byteLength(data);
    flowControl();
    let parsed;
    try { parsed = screen.write(data); } catch (error) { fail(error); return; }
    pendingWrites.add(parsed);
    parsed.then(() => {
      pendingWrites.delete(parsed);
      pendingBytes -= Buffer.byteLength(data);
      flowControl();
      schedulePaint();
    }, error => {
      pendingWrites.delete(parsed);
      fail(error);
    });
  }

  function onInput(data) {
    const text = typeof data === 'string' ? data : decoder.write(data);
    send(screen.input(text));
    schedulePaint();
    clearTimeout(escapeTimer);
    if (screen.pendingInput && !screen.pasting) {
      escapeTimer = setTimeout(() => {
        send(screen.flushInput());
        schedulePaint();
      }, 30);
    }
  }

  function onResize() {
    if (!active || terminated) return;
    try {
      const selecting = screen.selecting;
      screen.setSelectionMode(false);
      const resized = screen.resize(stdout.columns, stdout.rows);
      if (!resized && !selecting) return;
      if (resized) child.resize(screen.layout.ptyColumns ?? screen.layout.columns, screen.layout.codexRows);
      paint(true);
    } catch (error) { fail(error); }
  }

  function onDrain() {
    outputBlocked = false;
    flowControl();
    schedulePaint();
  }

  function restore() {
    if (restored) return;
    restored = true;
    try { stdin.setRawMode(wasRaw); } catch { /* Terminal already disconnected. */ }
    if (wasFlowing !== true) stdin.pause();
    if (active) {
      active = false;
      try { output.stream.write(LEAVE); } catch { /* Best effort after a broken output. */ }
    }
  }

  function emergencyRestore() {
    signalChild('SIGKILL');
    restore();
  }

  function listen(emitter, name, handler) {
    emitter.on(name, handler);
    handlers.push(() => emitter.removeListener(name, handler));
  }

  async function pollHud() {
    while (!abort.signal.aborted) {
      let catchingUp = false;
      try {
        const result = await source.poll();
        if (abort.signal.aborted) break;
        catchingUp = result.catchingUp;
        setHud(source.render(renderOptions(hudSettings, stdout)));
      } catch (error) {
        if (abort.signal.aborted) break;
        // A monitoring failure must not interrupt an active Codex turn.
        const label = hudSettings.language === 'ko' ? 'HUD 읽기 오류' : 'HUD read error';
        setHud(truncateText(`${label}: ${error.message}`, screen.layout.columns));
      }
      schedulePaint();
      await delay(catchingUp ? 10 : (hudSettings.interval ?? 1000), null, { signal: abort.signal })
        .catch(error => { if (error.name !== 'AbortError') throw error; });
    }
  }

  try {
    child = await createPty({
      file: context.file, args: context.args, cwd: context.cwd, env: context.env,
      cols: screen.layout.ptyColumns ?? screen.layout.columns, rows: screen.layout.codexRows,
    });
    const exitListener = child.onExit(event => {
      terminated = true;
      abort.abort();
      resolveExit(event);
    });
    const dataListener = child.onData(onData);
    handlers.push(() => dataListener.dispose(), () => exitListener.dispose());
    listen(stdout, 'resize', onResize);
    listen(output.stream, 'drain', onDrain);
    listen(output.stream, 'error', fail);
    listen(stdin, 'data', onInput);
    listen(stdin, 'error', fail);
    listen(stdin, 'end', () => stop('SIGHUP'));
    for (const signal of signals) listen(process, signal, () => stop(signal));
    listen(process, 'exit', emergencyRestore);
    stdin.setRawMode(true);
    active = true;
    hostWrite(ENTER);
    setHud(renderWaiting(renderOptions(hudSettings, stdout)));
    paint(true);
    stdin.resume();
    polling = pollHud().catch(fail);
    const event = await exited;
    await Promise.all([...pendingWrites]);
    paint();
    if (failure) throw failure;
    const signal = requestedSignal ?? (event.signal
      ? Object.keys(constants.signals).find(name => constants.signals[name] === event.signal) : null);
    const exitCode = requestedSignal ? 128 + constants.signals[requestedSignal]
      : event.signal ? 128 + event.signal : event.exitCode;
    return { exitCode, signal };
  } finally {
    abort.abort();
    clearTimeout(paintTimer);
    clearTimeout(escapeTimer);
    restore();
    if (child && !terminated) {
      signalChild('SIGKILL');
      await exited;
    }
    await cleanUpGroup();
    await polling;
    await Promise.all([...pendingWrites]);
    clearTimeout(killTimer);
    try {
      await output.finish();
    } finally {
      for (const remove of handlers.reverse()) remove();
      screen.dispose();
    }
  }
}
