import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import test from 'node:test';
import pty from 'node-pty';
import xterm from '@xterm/headless';
import unicode from '@xterm/addon-unicode11';
import { InlineScreen, screenLayout } from '../src/screen.js';

function terminal(cols, rows) {
  const term = new xterm.Terminal({ cols, rows, allowProposedApi: true });
  term.loadAddon(new unicode.Unicode11Addon());
  term.unicode.activeVersion = '11';
  return term;
}

const write = (term, data) => new Promise(resolve => term.write(data, resolve));
const lines = term => Array.from({ length: term.rows }, (_, row) =>
  term.buffer.active.getLine(term.buffer.active.viewportY + row)?.translateToString(true) ?? '');

function fixture(t, options = {}) {
  const columns = options.columns ?? 40;
  const rows = options.rows ?? 16;
  const screen = new InlineScreen({ columns, rows, ...options });
  const outer = terminal(columns, rows);
  t.after(() => { screen.dispose(); outer.dispose(); });
  return { screen, outer, paint: async force => write(outer, screen.frame({ force })) };
}

async function rawChild(t, layout) {
  const child = pty.spawn(process.execPath, ['-e', `
    process.stdin.setRawMode(true);
    const report = value => process.stdout.write(JSON.stringify(value) + '\\n');
    process.stdin.on('data', data => report({hex: data.toString('hex')}));
    report({columns: process.stdout.columns, rows: process.stdout.rows});
  `], {
    cwd: process.cwd(), env: { ...process.env }, name: 'xterm-256color',
    cols: layout.ptyColumns, rows: layout.codexRows,
  });
  const updates = new EventEmitter();
  const reports = [];
  let pending = '';
  let exit;
  const dataListener = child.onData(data => {
    pending += data;
    let newline;
    while ((newline = pending.indexOf('\n')) !== -1) {
      reports.push(JSON.parse(pending.slice(0, newline)));
      pending = pending.slice(newline + 1);
    }
    updates.emit('update');
  });
  let resolveExit;
  const exited = new Promise(resolve => { resolveExit = resolve; });
  const exitListener = child.onExit(event => {
    exit = event;
    resolveExit(event);
    updates.emit('update');
  });
  t.after(async () => {
    if (!exit) child.kill('SIGKILL');
    await exited;
    dataListener.dispose();
    exitListener.dispose();
  });
  const waitFor = async predicate => {
    const signal = AbortSignal.timeout(5000);
    for (;;) {
      const value = predicate();
      if (value) return value;
      if (exit) assert.fail(`PTY exited before receiving input: ${JSON.stringify(exit)}`);
      await once(updates, 'update', { signal });
    }
  };
  const ready = await waitFor(() => reports.find(report => report.columns !== undefined));
  return {
    child, ready, waitFor,
    received: () => Buffer.concat(reports.filter(report => report.hex !== undefined)
      .map(report => Buffer.from(report.hex, 'hex'))),
  };
}

test('layout reserves full HUD rows but keeps Codex usable in a short terminal', () => {
  assert.deepEqual(screenLayout(80, 24, 'full'), {
    columns: 80, ptyColumns: 80, rows: 24, codexRows: 16, hudRows: 7, separatorRows: 1,
  });
  assert.deepEqual(screenLayout(40, 8, 'full'), {
    columns: 40, ptyColumns: 40, rows: 8, codexRows: 4, hudRows: 3, separatorRows: 1,
  });
  assert.deepEqual(screenLayout(1, 1, 'minimal'), {
    columns: 1, ptyColumns: 2, rows: 1, codexRows: 1, hudRows: 0, separatorRows: 0,
  });
});

test('native scrollback keeps past Codex output in the host normal buffer without capturing the mouse', async t => {
  const { screen, outer, paint } = fixture(t, { nativeScrollback: true });
  screen.setHud('persistent HUD');
  await screen.write(Array.from({ length: 30 }, (_, i) => `OUTPUT-${i}\r\n`).join(''));
  await paint();
  assert.equal(outer.buffer.active.type, 'normal');
  assert.equal(outer.modes.mouseTrackingMode, 'none');
  assert.ok(outer.buffer.normal.baseY > 0, 'the host must have real scrollback for native wheel scrolling');
  const history = Array.from({ length: outer.buffer.normal.baseY }, (_, i) =>
    outer.buffer.normal.getLine(i).translateToString(true));
  assert.equal(history[0], 'OUTPUT-0');
  assert.ok(history.includes('OUTPUT-10'));
  assert.ok(history.every(line => !line.includes('HUD')), 'HUD redraws must not enter terminal history');
  assert.match(lines(outer)[9], /persistent HUD/);
  outer.scrollLines(-8);
  const before = lines(outer);
  screen.setHud('updated HUD');
  await paint();
  assert.deepEqual(lines(outer), before, 'HUD repaint must not pull the host out of native scrollback');
  assert.equal(screen.input('\x1b[A'), '\x1b[A', 'real Up-arrow input must retain Codex history behavior');
});

test('native scrollback advances once across repeated redraws and emulator history trimming', async t => {
  const { screen, outer, paint } = fixture(t, { nativeScrollback: true });
  screen.terminal.options.scrollback = 10;
  screen.setHud('HUD');
  for (let i = 0; i < 50; i += 1) {
    await screen.write(`LINE-${i}\r\n`);
    await paint();
    await paint(true);
  }
  const history = Array.from({ length: outer.buffer.normal.baseY }, (_, i) =>
    outer.buffer.normal.getLine(i).translateToString(true)).filter(line => line.startsWith('LINE-'));
  assert.ok(history.length > 30, 'host history must survive the emulator history limit');
  assert.deepEqual(history, Array.from({ length: history.length }, (_, i) => `LINE-${i}`));
});

test('native scrollback keeps normal output once across alternate child buffers', async t => {
  const { screen, outer, paint } = fixture(t, { nativeScrollback: true });
  screen.setHud('HUD');
  await screen.write(Array.from({ length: 25 }, (_, i) => `NORMAL-${i}\r\n`).join('')
    + '\x1b[?1049hALT SCREEN');
  await paint();
  await screen.write('\x1b[HREDRAW ALT');
  await paint();
  await screen.write('\x1b[?1049l'
    + Array.from({ length: 15 }, (_, i) => `NORMAL-${i + 25}\r\n`).join(''));
  await paint();
  const history = Array.from({ length: outer.buffer.normal.baseY }, (_, i) =>
    outer.buffer.normal.getLine(i).translateToString(true));
  assert.ok(history.length > 20);
  assert.ok(history.every(line => !line.includes('ALT') && !line.includes('HUD')));
  assert.deepEqual(history, Array.from({ length: history.length }, (_, i) => `NORMAL-${i}`));
});

test('native scrollback does not replay history after a display clear', async t => {
  const { screen, outer, paint } = fixture(t, { nativeScrollback: true });
  await screen.write(Array.from({ length: 30 }, (_, i) => `BEFORE-${i}\r\n`).join(''));
  await paint();
  const before = outer.buffer.normal.baseY;
  await screen.write('\x1b[2J\x1b[Hcleared display');
  await paint();
  assert.equal(outer.buffer.normal.baseY, before);
});

test('native scrollback captures new output from the start after a full terminal reset', async t => {
  const { screen, outer, paint } = fixture(t, { nativeScrollback: true });
  await screen.write(Array.from({ length: 30 }, (_, i) => `OLD-${i}\r\n`).join(''));
  await paint();
  await screen.write('\x1bc' + Array.from({ length: 40 }, (_, i) => `NEW-${i}\r\n`).join(''));
  await paint();
  const history = Array.from({ length: outer.buffer.normal.baseY }, (_, i) =>
    outer.buffer.normal.getLine(i).translateToString(true));
  assert.ok(history.includes('OLD-0'));
  assert.ok(history.includes('NEW-0'));
  assert.ok(history.includes('NEW-20'));
});

for (const grownRows of [24, 40]) {
  test(`native scrollback records fresh rows after a viewport grown to ${grownRows} is cleared`, async t => {
    const { screen, outer, paint } = fixture(t, { nativeScrollback: true });
    await screen.write(Array.from({ length: 30 }, (_, i) => `OLD-${i}\r\n`).join(''));
    await paint();
    outer.resize(40, grownRows);
    await screen.resizeHost(40, grownRows);
    await paint();
    await screen.write('\x1b[2J\x1b[H' + Array.from({ length: 60 }, (_, i) => `NEW-${i}\r\n`).join(''));
    await paint();
    const history = Array.from({ length: outer.buffer.normal.baseY }, (_, i) =>
      outer.buffer.normal.getLine(i).translateToString(true)).join('\n');
    const ids = [...history.matchAll(/NEW-(\d+)/g)].map(match => Number(match[1]));
    assert.ok(ids.length > 15);
    assert.deepEqual(ids, Array.from({ length: ids.length }, (_, i) => i));
  });
}

test('native host resize may retain visible alternate-child output but never HUD rows', async t => {
  const { screen, outer, paint } = fixture(t, { nativeScrollback: true });
  screen.setHud('HUD-DO-NOT-ARCHIVE');
  await screen.write('\x1b[?1049h\x1b[2J\x1b[H'
    + Array.from({ length: 8 }, (_, i) => `ALT-${i}\r\n`).join(''));
  await paint();
  outer.resize(40, 6);
  await screen.resizeHost(40, 6);
  await paint();
  const history = Array.from({ length: outer.buffer.normal.baseY }, (_, i) =>
    outer.buffer.normal.getLine(i).translateToString(true)).join('\n');
  assert.match(history, /ALT-/);
  assert.doesNotMatch(history, /HUD-DO-NOT-ARCHIVE/);
});

for (const [fromRows, toRows] of [[16, 6], [24, 3], [3, 24]]) {
  test(`native scrollback retains output exactly once when height changes ${fromRows} to ${toRows}`, async t => {
    const { screen, outer, paint } = fixture(t, { rows: fromRows, nativeScrollback: true });
    screen.setHud('HUD');
    for (let i = 0; i < 30; i += 1) {
      await screen.write(`ROW-${i}\r\n`);
      await paint();
    }
    outer.resize(40, toRows);
    await screen.resizeHost(40, toRows);
    await paint();
    for (let i = 30; i < 60; i += 1) {
      await screen.write(`ROW-${i}\r\n`);
      await paint();
    }
    const history = Array.from({ length: outer.buffer.normal.baseY }, (_, i) =>
      outer.buffer.normal.getLine(i).translateToString(true)).filter(line => line.startsWith('ROW-'));
    assert.ok(history.length > 25);
    assert.deepEqual(history, Array.from({ length: history.length }, (_, i) => `ROW-${i}`));
  });
}

for (const [columns, rows, nextColumns, nextRows] of [[80, 24, 40, 12], [80, 24, 40, 24], [40, 16, 80, 24]]) {
  test(`native scrollback follows host reflow from ${columns}x${rows} to ${nextColumns}x${nextRows}`, async t => {
    const { screen, outer, paint } = fixture(t, { columns, rows, nativeScrollback: true });
    screen.setHud('HUD marker');
    for (let i = 0; i < 30; i += 1) {
      await screen.write(`ROW-${i}: ${'x'.repeat(60)}\r\n`);
      await paint();
    }
    outer.resize(nextColumns, nextRows);
    await screen.resizeHost(nextColumns, nextRows);
    await paint();
    for (let i = 30; i < 60; i += 1) {
      await screen.write(`ROW-${i}: ${'x'.repeat(30)}\r\n`);
      await paint();
    }
    const history = Array.from({ length: outer.buffer.normal.baseY }, (_, i) =>
      outer.buffer.normal.getLine(i).translateToString(true)).join('\n');
    const ids = [...history.matchAll(/ROW-(\d+)/g)].map(match => Number(match[1]));
    assert.deepEqual(ids, Array.from({ length: ids.length }, (_, i) => i));
    assert.ok(ids.length > 30);
    assert.doesNotMatch(history, /HUD marker/);
  });
}

test('a superseded native resize cannot overwrite the latest terminal size', async t => {
  const { screen, outer, paint } = fixture(t, { nativeScrollback: true });
  screen.setHud('HUD');
  await screen.write('visible output');
  await paint();
  outer.resize(30, 6);
  const first = screen.resizeHost(30, 6);
  outer.resize(40, 16);
  const latest = screen.resizeHost(40, 16);
  await Promise.all([first, latest]);
  await paint();
  assert.equal(screen.layout.columns, 40);
  assert.equal(screen.layout.rows, 16);
  assert.equal(screen.resizingHost, false);
});

test('native scrollback waits while text selection is frozen and resumes with the latest output', async t => {
  const { screen, outer, paint } = fixture(t, { nativeScrollback: true });
  screen.setHud('HUD');
  await screen.write('initial\r\n');
  await paint();
  screen.setSelectionMode(true);
  await paint();
  const frozen = lines(outer);
  const baseY = outer.buffer.normal.baseY;
  await screen.write(Array.from({ length: 30 }, (_, i) => `FROZEN-${i}\r\n`).join(''));
  await paint(true);
  assert.deepEqual(lines(outer), frozen);
  assert.equal(outer.buffer.normal.baseY, baseY);
  screen.setSelectionMode(false);
  await paint();
  assert.ok(outer.buffer.normal.baseY > baseY);
  assert.ok(lines(outer).some(line => line.includes('FROZEN-29')));
  assert.equal(outer.modes.mouseTrackingMode, 'none');
});

test('captured wheel events never become command-history arrows in an alternate child buffer', async t => {
  const { screen } = fixture(t, { mouse: true });
  await screen.write('\x1b[?1049h');
  assert.equal(screen.input('\x1b[<64;3;2M'), '');
  assert.equal(screen.input('\x1b[<65;3;2M'), '');
  assert.equal(screen.input('\x1b[A'), '\x1b[A');
  assert.equal(screen.input('\x1b[B'), '\x1b[B');
});

test('selection browsing consumes wheel-translated arrows without leaving selection or editing Codex input', async t => {
  const { screen, outer, paint } = fixture(t, { mouse: true });
  await screen.write(Array.from({ length: 30 }, (_, i) => `COPY-${i}\r\n`).join(''));
  screen.input('\x1bm');
  await paint();
  const before = screen.terminal.buffer.normal.viewportY;
  assert.equal(screen.input('\x1b[A\x1bOA\x1b[A'), '');
  assert.equal(screen.selecting, true);
  assert.equal(screen.terminal.buffer.normal.viewportY, before - 3);
  assert.equal(screen.input('\x1b[I'), '\x1b[I');
  assert.equal(screen.terminal.buffer.normal.viewportY, before - 3);
  await paint();
  assert.equal(outer.modes.mouseTrackingMode, 'none');
  assert.equal(screen.input('\x1bOB'), '');
  assert.equal(screen.terminal.buffer.normal.viewportY, before - 2);
  assert.equal(screen.input('x'), 'x');
  assert.equal(screen.selecting, false);
});

test('child clears and out-of-range cursor movement cannot erase the full footer', async t => {
  const { screen, outer, paint } = fixture(t);
  screen.setHud('model\ncontext\nlimits\ntokens\ntools\nagents\nplan');
  await screen.write('\x1b[2J\x1b[999;1Hlast Codex row');
  await paint();
  assert.equal(lines(outer)[7], 'last Codex row');
  assert.deepEqual(lines(outer).slice(9), ['model', 'context', 'limits', 'tokens', 'tools', 'agents', 'plan']);
  await screen.write('\x1b[H\x1b[Jnew screen');
  await paint();
  assert.equal(lines(outer)[0], 'new screen');
  assert.deepEqual(lines(outer).slice(9), ['model', 'context', 'limits', 'tokens', 'tools', 'agents', 'plan']);
});

test('alternate buffers remain inside the Codex rectangle and restore their own screen', async t => {
  const { screen, outer, paint } = fixture(t);
  screen.setHud('persistent HUD');
  await screen.write('normal\x1b[?1049h\x1b[H\x1b[2Jalternate');
  await paint();
  assert.equal(lines(outer)[0], 'alternate');
  assert.equal(lines(outer)[9], 'persistent HUD');
  await screen.write('\x1b[?1049l');
  await paint();
  assert.equal(lines(outer)[0], 'normal');
  assert.equal(lines(outer)[9], 'persistent HUD');
});

test('scrolling child output does not push the HUD off the bottom', async t => {
  const { screen, outer, paint } = fixture(t);
  screen.setHud('fixed footer');
  await screen.write(Array.from({ length: 30 }, (_, index) => `line ${index}\r\n`).join(''));
  await paint();
  assert.equal(lines(outer)[6], 'line 29');
  assert.equal(lines(outer)[9], 'fixed footer');
  assert.equal(outer.buffer.active.baseY, 0);
});

test('resizing moves the footer and clears its former position', async t => {
  const { screen, outer, paint } = fixture(t);
  screen.setHud('fixed footer');
  await screen.write('\x1b[2J\x1b[Hhello');
  await paint();
  outer.resize(30, 24);
  screen.resize(30, 24);
  await paint();
  assert.equal(lines(outer)[0], 'hello');
  assert.equal(lines(outer)[9], '');
  assert.equal(lines(outer)[17], 'fixed footer');
  outer.resize(20, 8);
  screen.resize(20, 8);
  await paint();
  assert.equal(lines(outer)[5], 'fixed footer');
  assert.ok(lines(outer).every(line => line.length <= 20));
});

test('a growing agent list expands the HUD and returns space when the list shrinks', async t => {
  const { screen, outer, paint } = fixture(t, { columns: 80, rows: 24 });
  await screen.write('\x1b[?1049h\x1b[HCODEX');
  screen.setHud('model\ncontext\nusage\ntokens\ntools\nagents\nAda\nLin\nMax\nplan');
  await paint();
  assert.equal(screen.layout.codexRows, 13);
  assert.equal(screen.terminal.rows, 13);
  assert.deepEqual(lines(outer).slice(14), [
    'model', 'context', 'usage', 'tokens', 'tools', 'agents', 'Ada', 'Lin', 'Max', 'plan',
  ]);
  screen.setHud('model\ncontext\nusage\ntokens');
  await paint();
  assert.equal(screen.layout.codexRows, 16);
  assert.equal(screen.terminal.rows, 16);
  assert.equal(lines(outer)[0], 'CODEX');
  assert.deepEqual(lines(outer).slice(17), ['model', 'context', 'usage', 'tokens', '', '', '']);
});

test('HUD paging reaches every agent in a short terminal without forwarding navigation to Codex', async t => {
  const { screen, outer, paint } = fixture(t, { columns: 80, rows: 16, mouse: true });
  const agents = Array.from({ length: 40 }, (_, index) => `Agent-${String(index).padStart(2, '0')}`);
  screen.setHud(['Agents 40 running', ...agents].join('\n'));
  await screen.write('\x1b[?1049h\x1b[HCODEX');
  const seen = new Set();
  for (let page = 0; page < 6; page += 1) {
    await paint();
    const content = lines(outer).join('\n');
    for (const agent of agents) if (content.includes(agent)) seen.add(agent);
    assert.equal(lines(outer)[0], 'CODEX');
    assert.ok(screen.layout.codexRows >= 4);
    assert.equal(screen.input('\x1b[6;3~'), '');
  }
  assert.equal(seen.size, 40);
  assert.match(lines(outer).at(-1), /HUD.*41\/41.*Alt\+PgUp\/PgDn/);
  screen.setHud(['Agents 40 running', ...agents].join('\n'));
  await paint();
  assert.match(lines(outer).join('\n'), /Agent-39/);
  for (let page = 0; page < 6; page += 1) assert.equal(screen.input('\x1b[5;3~'), '');
  await paint();
  assert.match(lines(outer).join('\n'), /Agents 40 running/);
  const wheel = `\x1b[<65;3;${screen.layout.codexRows + 2}M`;
  assert.equal(screen.input(wheel), '');
  await paint();
  assert.doesNotMatch(lines(outer).join('\n'), /Agents 40 running/);
  assert.equal(screen.input('x'), 'x');
  screen.setHud('Short HUD');
  await paint();
  assert.match(lines(outer).join('\n'), /Short HUD/);
  assert.doesNotMatch(lines(outer).join('\n'), /Agent-\d/);
});

test('horizontal wheel and release reports do not move the HUD viewport', async t => {
  const { screen, outer, paint } = fixture(t, { columns: 80, rows: 16, mouse: true });
  screen.setHud(Array.from({ length: 40 }, (_, index) => `Agent-${index}`).join('\n'));
  screen.input('\x1b[6;3~');
  await paint();
  const before = lines(outer);
  for (const sequence of ['\x1b[<66;2;10M', '\x1b[<67;2;10M', '\x1b[<70;2;10M',
    '\x1b[<64;2;10m', '\x1b[<65;2;10m']) {
    assert.equal(screen.input(sequence), '');
    await paint();
    assert.deepEqual(lines(outer), before, JSON.stringify(sequence));
  }
  assert.equal(screen.input('\x1b[<69;2;10M'), '');
  await paint();
  assert.notDeepEqual(lines(outer), before, 'modified vertical wheel should still scroll');
});

test('a one-column host clips cells while the PTY and size replies retain two columns', async t => {
  const responses = [];
  const { screen, outer, paint } = fixture(t, {
    columns: 4, rows: 12, onResponse: data => responses.push(data),
  });
  screen.setHud('HUD\n한글\n\x1b[32mZebra\x1b[0m');
  await screen.write('\x1b[?1049h');
  screen.resize(1, 12);
  // xterm cannot emulate a one-column host. Its second column is a guard:
  // painting there would overflow the physical terminal's one visible cell.
  outer.resize(2, 12);
  await screen.write('\x1b[2J\x1b[HAB\x1b[2;1HCD\x1b[3;1H한\x1b[2;2H\x1b[6n\x1b[18t');
  await paint();
  assert.deepEqual(lines(outer), ['A', 'C', '', '', '─', 'H', '', 'Z', '', '', '', '']);
  assert.equal(outer.buffer.active.getLine(7).getCell(0).getFgColor(), 2);
  assert.deepEqual(responses, ['\x1b[2;2R', '\x1b[8;4;2t']);
  const child = await rawChild(t, screen.layout);
  assert.deepEqual(child.ready, { columns: 2, rows: 4 });
  screen.resize(2, 12);
  await paint();
  assert.deepEqual(lines(outer).slice(0, 3), ['AB', 'CD', '한']);
  assert.deepEqual(lines(outer).slice(4, 8), ['──', 'HU', '한', 'Ze']);
});

test('crossing tiny heights and one-column widths keeps the HUD within physical cells', async t => {
  const { screen, outer, paint } = fixture(t, { columns: 8, rows: 12, ascii: true });
  await screen.write('\x1b[?1049h');
  screen.setHud('Hud\nUsage\nData\nTokens\nTools\nAgents\nPlan');
  for (const [columns, rows, codexRows, hudRows] of [
    [1, 1, 1, 0], [1, 5, 5, 0], [1, 6, 4, 1],
    [1, 8, 4, 3], [2, 1, 1, 0], [2, 6, 4, 1], [1, 12, 4, 7],
  ]) {
    screen.resize(columns, rows);
    outer.resize(Math.max(2, columns), rows);
    await screen.write('\x1b[2J\x1b[HX');
    await paint();
    const expected = ['X', ...Array(codexRows - 1).fill('')];
    if (hudRows) expected.push('-'.repeat(columns),
      ...['Hud', 'Usage', 'Data', 'Tokens', 'Tools', 'Agents', 'Plan']
        .slice(0, hudRows).map(text => text.slice(0, columns)));
    if (hudRows === 3) expected[expected.length - 1] = '.';
    assert.deepEqual(lines(outer), expected, `${columns}x${rows}`);
    assert.equal(outer.buffer.active.baseY, 0);
  }
});

test('wide text and colors survive interpretation and compositing without cursor drift', async t => {
  const { screen, outer, paint } = fixture(t, { columns: 20 });
  await screen.write('\x1b[38;2;12;34;56m\x1b[1m한글🙂\x1b[0m!');
  await paint();
  assert.equal(lines(outer)[0], '한글🙂!');
  const first = outer.buffer.active.getLine(0).getCell(0);
  assert.equal(first.getFgColor(), 0x0c2238);
  assert.ok(first.isBold());
  assert.equal(outer.buffer.active.cursorX, 7);
  assert.equal(outer.buffer.active.cursorY, 0);
});

test('split UTF-8 and escape sequences are interpreted across write boundaries', async t => {
  const { screen, outer, paint } = fixture(t);
  const bytes = Buffer.from('한글');
  await screen.write(bytes.subarray(0, 2));
  await screen.write(bytes.subarray(2));
  await screen.write('\x1b[3');
  await screen.write('1mred');
  await paint();
  assert.equal(lines(outer)[0], '한글red');
  assert.equal(outer.buffer.active.getLine(0).getCell(4).getFgColor(), 1);
});

test('cursor and window-size queries are answered using only the Codex area', async t => {
  const responses = [];
  const { screen } = fixture(t, { onResponse: value => responses.push(value) });
  await screen.write('\x1b[3;5H\x1b[6n\x1b[18t');
  assert.ok(responses.includes('\x1b[3;5R'));
  assert.ok(responses.includes('\x1b[8;8;40t'));
});

test('child cursor visibility and paste modes reach the outer terminal without moving its content', async t => {
  const { screen, outer, paint } = fixture(t);
  await screen.write('\x1b[?25l\x1b[?2004h\x1b[?1hhello');
  const hidden = screen.frame();
  assert.match(hidden, /\x1b\[\?25l/);
  await write(outer, hidden);
  assert.equal(outer.modes.bracketedPasteMode, true);
  assert.equal(outer.modes.applicationCursorKeysMode, true);
  await screen.write('\x1b[?25h\x1b[?2004l\x1b[?1l');
  await paint();
  assert.equal(outer.modes.bracketedPasteMode, false);
  assert.equal(outer.modes.applicationCursorKeysMode, false);
  assert.equal(lines(outer)[0], 'hello');
});

test('DECSTR restores the painted cursor visibility and style without clearing content', async t => {
  const { screen, outer, paint } = fixture(t);
  const replies = [];
  const styles = [];
  outer.onData(data => replies.push(data));
  outer.parser.registerCsiHandler({ intermediates: ' ', final: 'q' }, params => {
    styles.push(params[0]);
    return false;
  });
  screen.setHud('fixed HUD');
  await screen.write('retained\x1b[?25l\x1b[6 q');
  await paint();
  await write(outer, '\x1b[?25$p');
  assert.deepEqual(replies, ['\x1b[?25;2$y']);
  assert.equal(styles.at(-1), 6);
  replies.length = 0;
  await screen.write('\x1b[!');
  await screen.write('p');
  await paint();
  await write(outer, '\x1b[?25$p');
  assert.deepEqual(replies, ['\x1b[?25;1$y']);
  assert.equal(styles.at(-1), 0);
  assert.equal(lines(outer)[0], 'retained');
  assert.equal(lines(outer)[9], 'fixed HUD');
});

test('history paging shows earlier Codex output while leaving the footer fixed', async t => {
  const { screen, outer, paint } = fixture(t);
  screen.setHud('fixed footer');
  await screen.write(Array.from({ length: 30 }, (_, index) => `line ${index}\r\n`).join(''));
  assert.equal(screen.input('\x1b[5;2~'), '');
  await paint();
  assert.equal(lines(outer)[0], 'line 15');
  assert.equal(lines(outer)[9], 'fixed footer');
  assert.equal(screen.input('x'), 'x');
  await paint();
  assert.equal(lines(outer)[0], 'line 23');
});

test('input preserves split paste and keys but discards clicks on the HUD', async t => {
  const { screen } = fixture(t, { mouse: true });
  await screen.write('\x1b[?1000h\x1b[?1006h\x1b[?2004h');
  assert.equal(screen.input('\x1b[<0;2;'), '');
  assert.equal(screen.input('12M'), '');
  assert.equal(screen.input('\x1b[<0;2;3M'), '\x1b[<0;2;3M');
  const paste = '\x1b[200~text\x1b[5;2~\x1b[<0;2;12M\x1b[201~';
  const forwarded = screen.input(paste.slice(0, 4)) + screen.input(paste.slice(4));
  assert.equal(forwarded, paste);
  assert.equal(screen.input('\x03'), '\x03');
  assert.equal(screen.input('\x04'), '\x04');
});

test('legacy mouse reports preserve press, release, modifiers, motion and byte limits', async t => {
  const { screen } = fixture(t, { columns: 300, rows: 240, mouse: true });
  await screen.write('\x1b[?1003h');
  for (const [input, expected] of [
    ['\x1b[<0;2;3M', [27, 91, 77, 32, 34, 35]],
    ['\x1b[<20;150;100M', [27, 91, 77, 52, 182, 132]],
    ['\x1b[<20;150;100m', [27, 91, 77, 55, 182, 132]],
    ['\x1b[<32;150;100M', [27, 91, 77, 64, 182, 132]],
    ['\x1b[<65;223;223M', [27, 91, 77, 97, 255, 255]],
  ]) {
    assert.deepEqual(screen.input(input), Buffer.from(expected), JSON.stringify(input));
  }
  assert.equal(screen.input('\x1b[<0;224;3M'), '');
  assert.equal(screen.input('\x1b[<0;3;224M'), '');
  assert.equal(screen.input('\x1b[<0;3;233M'), '');
});

test('mouse encoding follows SGR selection, reset to legacy and RIS', async t => {
  const { screen } = fixture(t, { columns: 300, rows: 240, mouse: true });
  await screen.write('\x1b[?1000;1006h');
  const sgr = '\x1b[<20;300;232M\x1b[<20;300;232m';
  assert.equal(screen.input(sgr), sgr);
  await screen.write('\x1b[!p');
  assert.equal(screen.input(sgr), sgr);
  await screen.write('\x1b[?1006l');
  assert.deepEqual(screen.input('\x1b[<0;150;100M'), Buffer.from([27, 91, 77, 32, 182, 132]));
  await screen.write('\x1b[?1006h\x1bc\x1b[?1000h');
  assert.deepEqual(screen.input('\x1b[<0;2;3M'), Buffer.from([27, 91, 77, 32, 34, 35]));
});

test('legacy mouse bytes and UTF-8 paste arrive intact through an actual PTY write', async t => {
  const { screen } = fixture(t, { columns: 300, rows: 160, mouse: true });
  await screen.write('\x1b[?1000h\x1b[?2004h');
  const child = await rawChild(t, screen.layout);
  const paste = '\x1b[200~한글🙂\x1b[<0;2;159M\x1b[5;2~\x1b[201~';
  // A mouse report and text can share a read; conversion must keep their order
  // and must not UTF-8 encode the legacy coordinates 0xb6 and 0x84.
  const first = screen.input('앞\x1b[<0;150;100M' + paste.slice(0, -3));
  const second = screen.input(paste.slice(-3) + '끝');
  child.child.write(first);
  child.child.write(second);
  const expected = Buffer.concat([
    Buffer.from('앞'), Buffer.from([27, 91, 77, 32, 182, 132]), Buffer.from(paste + '끝'),
  ]);
  await child.waitFor(() => child.received().length >= expected.length);
  assert.deepEqual(child.received(), expected);
});

test('an unchanged frame does not repaint all Codex cells', async t => {
  const { screen } = fixture(t);
  await screen.write('hello');
  screen.frame();
  assert.equal(screen.frame(), '');
  screen.setHud('changed footer');
  const changed = screen.frame();
  assert.doesNotMatch(changed, /hello/);
  assert.match(changed, /changed footer/);
});

test('normal frames keep native dragging available through child mouse requests and HUD refreshes', async t => {
  const { screen, outer, paint } = fixture(t);
  // Clear capture inherited from the previous application as well.
  await write(outer, '\x1b[?1003h\x1b[?1006h');
  screen.setHud('first HUD');
  await screen.write('selectable output');
  await paint();
  assert.equal(outer.modes.mouseTrackingMode, 'none');
  for (const request of ['\x1b[?1000;1006h', '\x1b[?1002h', '\x1b[?1003h', '\x1bc']) {
    await screen.write(request);
    screen.setHud('updated HUD');
    await paint(true);
    assert.equal(outer.modes.mouseTrackingMode, 'none');
    assert.equal(screen.input('\x1b[<0;2;3M\x1b[<32;8;3M\x1b[<0;8;3m'), '');
  }
  assert.equal(screen.input('typed text'), 'typed text');
});

test('native dragging stays available after leaving a frozen selection', async t => {
  const { screen, outer, paint } = fixture(t);
  await screen.write('first output');
  await paint();
  screen.input('\x1bm');
  await paint();
  const frozen = lines(outer);
  await screen.write('\x1b[Hlatest output\x1b[?1003h');
  screen.setHud('latest HUD');
  await paint(true);
  assert.deepEqual(lines(outer), frozen);
  screen.input('\x1bm');
  await paint();
  assert.equal(outer.modes.mouseTrackingMode, 'none');
  assert.match(lines(outer)[0], /latest output/);
  assert.match(lines(outer).join('\n'), /latest HUD/);
});

test('HUD and cursor refreshes do not reset opt-in host mouse tracking', async t => {
  const { screen, outer, paint } = fixture(t, { mouse: true });
  const mouseCommands = [];
  for (const final of ['h', 'l']) {
    outer.parser.registerCsiHandler({ prefix: '?', final }, params => {
      if (params.some(mode => [9, 1000, 1002, 1003, 1006].includes(mode))) {
        mouseCommands.push({ final, params: [...params] });
      }
      return false;
    });
  }
  screen.setHud('first HUD');
  await screen.write('selectable output');
  await paint();
  assert.equal(outer.modes.mouseTrackingMode, 'vt200');
  mouseCommands.length = 0;
  screen.setHud('updated HUD');
  await paint();
  await screen.write('\x1b[2;3H\x1b[?2004h');
  await paint(true);
  assert.deepEqual(mouseCommands, []);
  assert.equal(outer.modes.bracketedPasteMode, true);
  await screen.write('\x1b[?1003h');
  await paint();
  assert.equal(outer.modes.mouseTrackingMode, 'any');
  assert.ok(mouseCommands.length > 0);
});

test('selection mode releases the mouse and freezes output until resuming', async t => {
  const { screen, outer, paint } = fixture(t, { language: 'ko', mouse: true });
  screen.setHud('first HUD');
  await screen.write('first output');
  await paint();
  assert.equal(screen.input('\x1b'), '');
  assert.equal(screen.input('m'), '');
  await paint();
  assert.equal(outer.modes.mouseTrackingMode, 'none');
  assert.match(lines(outer).join('\n'), /선택 모드.*Alt\+M/);
  const frozen = lines(outer);
  screen.setHud('latest HUD');
  await screen.write('\x1b[Hlatest output\x1b[?1003h');
  await paint(true);
  assert.deepEqual(lines(outer), frozen);
  assert.equal(screen.input('\x1b[<65;3;4M'), '');
  await paint();
  assert.deepEqual(lines(outer), frozen);
  assert.equal(screen.input('\x1bm'), '');
  await paint();
  assert.equal(outer.modes.mouseTrackingMode, 'any');
  assert.match(lines(outer)[0], /latest output/);
  assert.match(lines(outer).join('\n'), /latest HUD/);
  assert.doesNotMatch(lines(outer).join('\n'), /선택 모드/);

  screen.input('\x1bm');
  await paint();
  assert.equal(screen.input('x'), 'x');
  await paint();
  assert.equal(outer.modes.mouseTrackingMode, 'any');
  screen.input('\x1bm');
  await paint();
  screen.input('\x1b');
  assert.equal(screen.flushInput(), '');
  await paint();
  assert.equal(outer.modes.mouseTrackingMode, 'any');
});

test('language shortcuts switch HUD language without forwarding keys or interpreting pasted controls', async t => {
  const languages = [];
  const { screen } = fixture(t, { language: 'ko', onLanguageChange: language => languages.push(language) });
  assert.equal(screen.input('\x1b'), '');
  assert.equal(screen.input('l'), '');
  assert.deepEqual(languages, ['en']);
  const paste = '\x1b[200~paste \x1bl \x1bm\x1b[201~';
  const output = screen.input(paste.slice(0, -3)) + screen.input(paste.slice(-3));
  assert.equal(output, paste);
  assert.deepEqual(languages, ['en']);
  assert.equal(screen.input('\x1bl'), '');
  assert.deepEqual(languages, ['en', 'ko']);
});

test('terminal focus reports preserve selection mode and still reach Codex', async t => {
  const { screen, outer, paint } = fixture(t);
  screen.setHud('HUD');
  await screen.write('\x1b[?1004hselect this output');
  await paint();
  screen.input('\x1bm');
  await paint();
  const frozen = lines(outer);
  for (const report of ['\x1b[O', '\x1b[I']) {
    assert.equal(screen.input(report), report);
    await paint();
    assert.equal(outer.modes.mouseTrackingMode, 'none');
    assert.deepEqual(lines(outer), frozen);
  }
});

test('incomplete OSC replies cannot trap Ctrl+C, Ctrl+D or the escape flush', t => {
  const { screen } = fixture(t);
  for (const cancel of ['\x03', '\x04']) {
    assert.equal(screen.input('\x1b]11;rgb:12/'), '');
    assert.equal(screen.input(cancel), cancel);
    assert.equal(screen.input('x'), 'x');
  }
  const incomplete = '\x1b]11;rgb:12/';
  assert.equal(screen.input(incomplete), '');
  assert.equal(screen.flushInput(), incomplete);
  assert.equal(screen.input('\x1bl'), '');
  const complete = '\x1b]11;rgb:1111/2222/3333\x1b\\';
  assert.equal(screen.input(complete.slice(0, -2)), '');
  assert.equal(screen.input(complete.slice(-2)), complete);
});

test('opt-in mouse wheel scrolls normal-screen history without leaking mouse events into Codex input', async t => {
  const { screen, outer, paint } = fixture(t, { mouse: true });
  screen.setHud('fixed footer');
  await screen.write(Array.from({ length: 30 }, (_, index) => `line ${index}\r\n`).join(''));
  await paint();
  assert.equal(outer.modes.mouseTrackingMode, 'vt200');
  assert.equal(screen.input('\x1b[<64;3;4M'), '');
  await paint();
  assert.equal(lines(outer)[0], 'line 20');
  assert.equal(lines(outer)[9], 'fixed footer');
  assert.equal(screen.input('\x1b[<0;3;4M'), '');
  assert.equal(screen.input('\x1b[<65;3;4M'), '');
  await paint();
  assert.equal(lines(outer)[0], 'line 23');
});

test('isolated Escape is flushed while partial paste terminators stay buffered', async t => {
  const { screen } = fixture(t);
  assert.equal(screen.input('\x1b'), '');
  assert.equal(screen.flushInput(), '\x1b');
  assert.equal(screen.input('\x1b[200~content\x1b[20'), '\x1b[200~content');
  assert.equal(screen.flushInput(), '');
  assert.equal(screen.input('1~'), '\x1b[201~');
});

test('only supported host interactions are forwarded out of the emulated screen', async t => {
  const hostWrites = [];
  const { screen } = fixture(t, { onHostWrite: value => hostWrites.push(value) });
  await screen.write('\x1b]10;?\x1b\\\x1b]11;?\x1b\\\x1b]52;c;aGVsbG8=\x1b\\');
  await screen.write('\x1b[8;999;999t\x1b]2;change the tab\x1b\\');
  assert.deepEqual(hostWrites, [
    '\x1b]10;?\x1b\\', '\x1b]11;?\x1b\\', '\x1b]52;c;aGVsbG8=\x1b\\',
  ]);
});
