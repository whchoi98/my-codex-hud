import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import pty from 'node-pty';
import xterm from '@xterm/headless';
import { watch, renderOptions } from '../src/watch.js';
import { defaults } from '../src/config.js';

test('explicit redirected width is honored while TTY width stays bounded to the real terminal', () => {
  assert.equal(renderOptions({ ...defaults, width: 160 }, { isTTY: false }).width, 160);
  assert.equal(renderOptions({ ...defaults, width: 160 }, { isTTY: true, columns: 80 }).width, 80);
  assert.equal(renderOptions({ ...defaults, width: null }, { isTTY: true, columns: 120 }).width, 120);
});

test('interrupting a waiting HUD restores cursor and screen and removes signal handlers', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-hud-watch-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let content = '';
  const sink = new Writable({ write(chunk, encoding, callback) { content += chunk.toString(); callback(); } });
  sink.isTTY = true;
  sink.columns = 80;
  sink.rows = 24;
  const before = process.listenerCount('SIGINT');
  const running = watch({ ...defaults, cwd: dir, codexHome: dir, git: false }, sink);
  process.emit('SIGINT');
  await running;
  assert.match(content, /\x1b\[\?1049h/);
  assert.match(content, /\x1b\[\?25h\x1b\[\?1049l$/);
  assert.equal(process.listenerCount('SIGINT'), before);
});

test('watch restores terminal modes and propagates an input stream error', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-hud-watch-error-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let content = '';
  const sink = new Writable({ write(chunk, encoding, callback) { content += chunk.toString(); callback(); } });
  Object.assign(sink, { isTTY: true, columns: 80, rows: 24 });
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = value => { input.isRaw = value; };
  const running = watch({ ...defaults, cwd: dir, codexHome: dir, git: false }, sink, input);
  const timeout = setTimeout(() => process.emit('SIGINT'), 2000);
  t.after(() => clearTimeout(timeout));
  assert.equal(input.isRaw, true);
  const error = Object.assign(new Error('input device failed'), { code: 'EIO' });
  let unhandled;
  try { input.emit('error', error); }
  catch (caught) {
    unhandled = caught;
    process.emit('SIGINT');
  }
  const result = await running.then(() => null, failure => failure);
  assert.equal(unhandled, undefined, 'input errors must go through watch cleanup');
  assert.equal(result, error);
  assert.equal(input.isRaw, false);
  assert.equal(input.listenerCount('error'), 0);
  assert.equal(input.listenerCount('data'), 0);
  assert.equal(sink.listenerCount('resize'), 0);
  assert.match(content, /\x1b\[\?1000l\x1b\[\?1006l\x1b\[\?2004l/);
  assert.match(content, /\x1b\[\?25h\x1b\[\?1049l$/);
});

for (const mouse of [false, true]) {
  test(`watch preserves mouse=${mouse} through language changes and frozen selections`, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'codex-hud-watch-controls-'));
    const session = join(dir, 'session.jsonl');
    await writeFile(session, JSON.stringify({
      type: 'session_meta', payload: { id: 'controls', cwd: dir, timestamp: new Date().toISOString() },
    }) + '\n');
    const terminal = new xterm.Terminal({ cols: 100, rows: 16, allowProposedApi: true });
    let pending = Promise.resolve();
    const sink = new Writable({ write(chunk, encoding, callback) {
      pending = pending.then(() => new Promise(resolve => terminal.write(chunk.toString(), resolve)));
      callback();
    } });
    Object.assign(sink, { isTTY: true, columns: 100, rows: 16 });
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = value => { input.isRaw = value; };
    const settings = { ...defaults, cwd: dir, codexHome: dir, session, language: 'en', git: false, mouse, interval: 60_000 };
    const running = watch(settings, sink, input);
    let done = false;
    running.finally(() => { done = true; });
    t.after(async () => {
      if (!done) process.emit('SIGINT');
      await running;
      await pending;
      terminal.dispose();
      await rm(dir, { recursive: true, force: true });
    });
    const visible = () => Array.from({ length: terminal.rows }, (_, row) =>
      terminal.buffer.active.getLine(row)?.translateToString(true) ?? '').join('\n');
    async function until(check) {
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline) {
        await pending;
        if (check()) return;
        await delay(10);
      }
      assert.fail(visible());
    }
    await until(() => visible().includes('Context'));
    assert.equal(terminal.modes.mouseTrackingMode, mouse ? 'vt200' : 'none');
    input.write('\x1b');
    input.write('l');
    await until(() => visible().includes('컨텍스트'));
    assert.equal(settings.language, 'en');
    input.write('\x1b[200~\x1bl\x1bm\x03\x1b[201~');
    await delay(30);
    await pending;
    assert.equal(done, false);
    assert.match(visible(), /컨텍스트/);
    input.write('\x1bm');
    await until(() => terminal.modes.mouseTrackingMode === 'none' && visible().includes('선택 모드'));
    const frozen = visible();
    input.write('\x1b[<65;3;4M\x1b[O\x1b[I');
    await delay(30);
    await pending;
    assert.equal(visible(), frozen);
    input.write('\x1bm');
    await until(() => terminal.modes.mouseTrackingMode === (mouse ? 'vt200' : 'none') && visible().includes('컨텍스트'));
    input.write('\x1bl');
    await until(() => visible().includes('Context'));
    input.write('\x1b]');
    await delay(60);
    input.write('\x03');
    await until(() => done);
    await running;
    assert.equal(input.isRaw, false);
  });
}

test('watch pages through all agents in a short PTY and restores input mode on Ctrl+C', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-hud-watch-agents-'));
  const session = join(dir, 'agents.jsonl');
  const records = [
    { type: 'session_meta', payload: { id: 'watch-test', cwd: dir } },
    ...Array.from({ length: 40 }, (_, index) => ({
      type: 'event_msg', payload: {
        type: 'collab_agent_spawn_end', new_thread_id: `agent-${index}`,
        new_agent_nickname: `Agent-${String(index).padStart(2, '0')}`, status: 'running',
      },
    })),
  ];
  await writeFile(session, records.map(value => JSON.stringify(value)).join('\n') + '\n');
  const terminal = new xterm.Terminal({ cols: 80, rows: 10, allowProposedApi: true });
  const settings = { ...defaults, cwd: dir, codexHome: dir, session, git: false, mouse: true, interval: 200 };
  const runner = `
    import {watch} from ${JSON.stringify(new URL('../src/watch.js', import.meta.url).href)};
    await watch(${JSON.stringify(settings)});
    process.stdout.write('\\r\\nRESTORED ' + JSON.stringify({raw:process.stdin.isRaw ?? false}) + '\\r\\n');
  `;
  const child = pty.spawn(process.execPath, ['--input-type=module', '-e', runner], {
    cols: 80, rows: 10, cwd: dir, name: 'xterm-256color', env: { ...process.env },
  });
  let output = '';
  let pending = Promise.resolve();
  let done = false;
  const listener = child.onData(chunk => {
    output += chunk;
    pending = pending.then(() => new Promise(resolve => terminal.write(chunk, resolve)));
  });
  const exited = new Promise(resolve => child.onExit(event => { done = true; resolve(event); }));
  t.after(async () => {
    if (!done) child.kill('SIGKILL');
    await exited;
    await pending;
    listener.dispose();
    terminal.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  const visible = () => Array.from({ length: terminal.rows }, (_, row) =>
    terminal.buffer.active.getLine(row)?.translateToString(true) ?? '').join('\n');
  async function until(check, message) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (check()) return;
      await delay(20);
    }
    assert.fail(`${message}\n${visible()}`);
  }
  await until(() => /HUD 1-9\/45/.test(visible()), 'scroll hint never appeared');
  const seen = new Set();
  for (const last of ['03', '12', '21', '30', '39']) {
    await until(() => visible().includes(`Agent-${last}`), `did not reach Agent-${last}`);
    for (const match of visible().matchAll(/Agent-\d{2}/g)) seen.add(match[0]);
    if (last !== '39') {
      child.write('\x1b[');
      child.write('6~');
    }
  }
  assert.equal(seen.size, 40);
  // Pasted control sequences must not move the viewport or terminate watch.
  child.write('\x1b[200~pasted\x1b[5~\x03\x1b[201~');
  await delay(250);
  assert.equal(done, false);
  assert.match(visible(), /Agent-39/);
  child.write('\x1b[5;3~');
  await until(() => visible().includes('Agent-30') && !visible().includes('Agent-39'), 'page up did not work');
  child.write('\x1b[<65;3;4M');
  await until(() => visible().includes('Agent-33'), 'wheel did not scroll the list');
  terminal.resize(40, 6);
  child.resize(40, 6);
  child.write('\x1b[6;3~\x1b[6;3~');
  await until(() => visible().includes('Agent-39'), 'last agent was lost after resize');
  child.write('\x03');
  await until(() => done, 'Ctrl+C did not stop watch');
  assert.equal((await exited).exitCode, 0);
  await pending;
  assert.match(output, /RESTORED \{"raw":false\}/);
});
