import { setTimeout as delay } from 'node:timers/promises';
import { TranscriptReader } from './transcript.js';
import { findSession } from './sessions.js';
import { getGitStatus } from './git.js';
import { renderHud, renderWaiting, renderSelectionHint } from './render.js';
import { truncateText } from './terminal.js';
import { HudViewport } from './viewport.js';

const MOUSE_OFF = '\x1b[?9l\x1b[?1002l\x1b[?1003l\x1b[?1000l\x1b[?1006l';
const MOUSE_ON = '\x1b[?1000h\x1b[?1006h';

export function renderOptions(settings, stdout = process.stdout) {
  const available = stdout.isTTY && stdout.columns ? stdout.columns : 100;
  return {
    ...settings,
    width: settings.width === null ? available
      : stdout.isTTY ? Math.min(settings.width, available) : settings.width,
    color: settings.color && Boolean(stdout.isTTY) && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb',
    now: Date.now(),
  };
}

export async function snapshot(settings) {
  const path = await findSession(settings);
  if (!path) return null;
  const reader = new TranscriptReader();
  do { await reader.read(path); } while (!reader.caughtUp);
  if (settings.git) reader.state.git = await getGitStatus(reader.state.session.cwd ?? settings.cwd);
  return reader.state;
}

/** Dedicated terminal view; never draws over an existing Codex TUI. */
export async function watch(settings, stdout = process.stdout, stdin = process.stdin) {
  settings = { ...settings };
  const abort = new AbortController();
  const stop = () => abort.abort();
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, stop);
  const reader = new TranscriptReader();
  let selected = null;
  let lastSearch = 0;
  let lastGit = 0;
  let gitCwd = null;
  let git = null;
  let previous = '';
  let failure;
  let pendingInput = '';
  let pasting = false;
  let state = null;
  let sessionFileMissing = false;
  let selecting = false;
  let selectionPainted = false;
  let escapeTimer;
  const viewport = new HudViewport();
  const interactive = Boolean(stdin.isTTY && typeof stdin.setRawMode === 'function');
  const wasRaw = Boolean(stdin.isRaw);
  const wasFlowing = stdin.readableFlowing;

  function updateFrame() {
    const options = renderOptions(settings, stdout);
    let frame = state ? renderHud(state, options) : renderWaiting(options);
    if (sessionFileMissing) {
      const note = settings.language === 'ko' ? '세션 파일을 기다리는 중' : 'Waiting for the session file';
      frame += `\n${truncateText(note, options.width)}`;
    }
    if (state && !reader.caughtUp) {
      frame += `\n${truncateText(settings.language === 'ko' ? '이전 기록을 읽는 중…' : 'Reading session history…', options.width)}`;
    }
    viewport.setText(frame);
  }

  function paint(force = false) {
    if (selecting && selectionPainted) return;
    viewport.resize(stdout.rows || 24);
    const options = renderOptions(settings, stdout);
    const rows = viewport.view(options.width, options);
    if (selecting) rows[0] = renderSelectionHint(options);
    const painted = rows.map(line => `\x1b[2K${line}`).join('\r\n');
    if (force || painted !== previous) {
      stdout.write(`\x1b[H${painted}\x1b[J`);
      previous = painted;
    }
    selectionPainted = selecting;
  }

  function fail(error) {
    failure ??= error;
    stop();
  }

  function repaint() {
    try { updateFrame(); paint(true); }
    catch (error) { fail(error); }
  }

  function setSelectionMode(enabled) {
    if (selecting === enabled) return;
    selecting = enabled;
    selectionPainted = false;
    previous = '';
    if (interactive) {
      try { stdout.write(enabled || !settings.mouse ? MOUSE_OFF : MOUSE_ON); }
      catch (error) { fail(error); }
    }
  }

  function onResize() {
    setSelectionMode(false);
    repaint();
  }

  function onInput(data) {
    clearTimeout(escapeTimer);
    pendingInput += data.toString();
    while (pendingInput) {
      if (pasting) {
        const end = pendingInput.indexOf('\x1b[201~');
        if (end === -1) { pendingInput = pendingInput.slice(-5); break; }
        pendingInput = pendingInput.slice(end + 6);
        pasting = false;
        continue;
      }
      let sequence = pendingInput[0];
      if (sequence === '\x1b') {
        if (pendingInput[1] === ']') {
          const end = /\x07|\x1b\\/.exec(pendingInput.slice(2));
          const cancel = pendingInput.search(/[\x03\x04]/);
          if (cancel >= 0 && (!end || cancel < end.index + 2)) {
            pendingInput = pendingInput.slice(cancel);
            continue;
          }
          const escape = pendingInput.indexOf('\x1b', 2);
          if (escape >= 0 && pendingInput[escape + 1] && pendingInput[escape + 1] !== '\\'
            && (!end || escape < end.index + 2)) {
            pendingInput = pendingInput.slice(escape);
            continue;
          }
          if (!end && pendingInput.length < 4096) break;
          pendingInput = pendingInput.slice(end ? end.index + end[0].length + 2 : pendingInput.length);
          continue;
        }
        const match = /^\x1b\[[0-?]*[ -/]*[@-~]/.exec(pendingInput);
        if (match) sequence = match[0];
        else if ((pendingInput === '\x1b' || /^\x1b\[[0-?]*[ -/]*$/.test(pendingInput))
          && pendingInput.length < 256) break;
        else if (pendingInput[1] === 'O' && pendingInput.length < 3) break;
        else sequence = pendingInput.slice(0, pendingInput[1] === 'O' ? 3 : 2);
      }
      pendingInput = pendingInput.slice(sequence.length);
      if (sequence === '\x1b[I' || sequence === '\x1b[O') continue;
      if (sequence === '\x1bl' || sequence === '\x1bL') {
        setSelectionMode(false);
        settings.language = settings.language === 'ko' ? 'en' : 'ko';
        continue;
      }
      if (sequence === '\x1bm' || sequence === '\x1bM') {
        setSelectionMode(!selecting);
        continue;
      }
      const mouse = /^\x1b\[<(\d+);(\d+);(\d+)M$/.exec(sequence);
      if (/^\x1b\[<(\d+);(\d+);(\d+)[Mm]$/.test(sequence) && (selecting || !settings.mouse)) continue;
      if (!mouse) setSelectionMode(false);
      if (sequence === '\x1b[200~') pasting = true;
      else if (sequence === '\x03') stop();
      else if (['\x1b[5~', '\x1b[5;3~'].includes(sequence)) viewport.page(-1);
      else if (['\x1b[6~', '\x1b[6;3~'].includes(sequence)) viewport.page(1);
      else if (sequence === '\x1b[A') viewport.scroll(-1);
      else if (sequence === '\x1b[B') viewport.scroll(1);
      else {
        if (mouse) {
          const [, button, x, y] = mouse.map(Number);
          const wheel = button & ~28;
          if (x >= 1 && x <= stdout.columns && y >= 1 && y <= stdout.rows
            && (wheel === 64 || wheel === 65)) viewport.scroll(wheel === 65 ? 3 : -3);
        }
      }
    }
    if (!pasting && (pendingInput === '\x1b' || pendingInput.startsWith('\x1b]'))) {
      escapeTimer = setTimeout(() => {
        const escape = pendingInput.endsWith('\x1b');
        pendingInput = '';
        if (escape) setSelectionMode(false);
        repaint();
      }, 30);
    }
    repaint();
  }

  try {
    stdout.write('\x1b[?1049h\x1b[?25l');
    stdout.on('resize', onResize);
    if (interactive) {
      stdin.setRawMode(true);
      stdout.write(`${MOUSE_OFF}${settings.mouse ? MOUSE_ON : ''}\x1b[?2004h`);
      stdin.on('data', onInput);
      stdin.on('error', fail);
      stdin.on('end', stop);
      stdin.resume();
    }
    while (!abort.signal.aborted) {
      const now = Date.now();
      let missingFile = false;
      let nextState = null;
      try {
        if ((!selected || settings.follow) && now - lastSearch >= 2000) {
          const match = await findSession(settings);
          if (match) selected = match;
          lastSearch = now;
        }
        if (selected) {
          nextState = await reader.read(selected);
          const cwd = nextState.session.cwd ?? settings.cwd;
          if (settings.git && (cwd !== gitCwd || now - lastGit >= 3000)) {
            git = await getGitStatus(cwd);
            gitCwd = cwd;
            lastGit = now;
          }
          nextState.git = git;
        }
      } catch (error) {
        if (!['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) throw error;
        missingFile = true;
        if (settings.follow) selected = null;
      }
      state = nextState;
      sessionFileMissing = missingFile;
      updateFrame();
      paint();
      await delay(state && !reader.caughtUp ? 10 : settings.interval, null, { signal: abort.signal }).catch(error => {
        if (error.name !== 'AbortError') throw error;
      });
    }
    if (failure) throw failure;
  } finally {
    clearTimeout(escapeTimer);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeListener(signal, stop);
    stdout.removeListener('resize', onResize);
    if (interactive) {
      stdin.removeListener('data', onInput);
      stdin.removeListener('error', fail);
      stdin.removeListener('end', stop);
      try { stdin.setRawMode(wasRaw); } catch { /* Terminal already disconnected. */ }
      if (wasFlowing !== true) stdin.pause();
      stdout.write(`${MOUSE_OFF}\x1b[?2004l`);
    }
    stdout.write('\x1b[0m\x1b[?25h\x1b[?1049l');
  }
}
