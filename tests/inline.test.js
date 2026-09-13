import assert from 'node:assert/strict';
import { appendFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import pty from 'node-pty';
import xterm from '@xterm/headless';
import unicode from '@xterm/addon-unicode11';
import { launchInline } from '../src/inline.js';

const moduleUrl = new URL('../src/inline.js', import.meta.url).href;
const fixtureUrl = new URL('./fixtures/inline-codex.mjs', import.meta.url).href;
const screenLines = terminal => Array.from({ length: terminal.rows }, (_, row) =>
  terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true).trimEnd() ?? '');

async function until(check, message) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(20);
  }
  assert.fail(message);
}

async function fixture(t, extraEnv = {}, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'codex-hud-inline-'));
  const bin = join(dir, 'bin');
  const codexHome = join(dir, 'codex');
  const events = join(dir, 'events.jsonl');
  await mkdir(bin);
  await mkdir(codexHome);
  await writeFile(events, '');
  await writeFile(join(bin, 'codex'), `#!${process.execPath}\nimport ${JSON.stringify(fixtureUrl)};\n`, { mode: 0o755 });
  const settings = { cwd: dir, codexHome, language: 'ko', preset: 'full', interval: 200,
    width: null, pathLevels: 1, color: true, ascii: false, git: false, ...overrides };
  const runner = `
    import {launchInline} from ${JSON.stringify(moduleUrl)};
    import {writeFileSync} from 'node:fs';
    process.on('SIGTERM', () => writeFileSync(${JSON.stringify(join(dir, 'handled-signal'))}, 'handled'));
    try {
      const result = await launchInline(${JSON.stringify(settings)});
      process.stdout.write('\\r\\nRESTORED ' + JSON.stringify({raw:process.stdin.isRaw ?? false,result}) + '\\r\\n');
      process.exitCode = result.exitCode;
    } catch(error) {
      console.error(error.stack);
      process.exitCode = 1;
    }
  `;
  const terminal = new xterm.Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  terminal.loadAddon(new unicode.Unicode11Addon());
  terminal.unicode.activeVersion = '11';
  const child = pty.spawn(process.execPath, ['--input-type=module', '-e', runner], {
    cols: 80, rows: 24, cwd: dir, name: 'xterm-256color',
    env: { ...process.env, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
      CODEX_HOME: codexHome, HUD_TEST_EVENTS: events, ...extraEnv },
  });
  let output = '';
  let pending = Promise.resolve();
  const data = child.onData(chunk => {
    output += chunk;
    pending = pending.then(() => new Promise(resolve => terminal.write(chunk, resolve)));
  });
  const exited = new Promise(resolve => child.onExit(resolve));
  let done = false;
  exited.then(() => { done = true; });
  const records = async () => (await readFile(events, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  t.after(async () => {
    if (!done) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already closed. */ }
      await exited;
    }
    await pending;
    data.dispose();
    terminal.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  await until(async () => (await records()).some(event => event.type === 'ready') || done, 'fake Codex did not start');
  assert.equal(done, false, output);
  return { child, terminal, exited, records, output: () => output,
    flush: async () => pending, settings };
}

test('inline launch rejects redirected input before spawning or changing terminal modes', async () => {
  await assert.rejects(launchInline({}), /interactive.*TTY|terminal/i);
});

test('real PTYs display Codex above the full HUD and preserve the footer through child clears and resize', async t => {
  const f = await fixture(t);
  await until(() => screenLines(f.terminal).some(line => line.includes('컨텍스트')), 'HUD never displayed');
  assert.equal(f.terminal.modes.mouseTrackingMode, 'none');
  assert.equal(screenLines(f.terminal)[0], 'READY 80x16');
  assert.match(screenLines(f.terminal)[17], /gpt-inline-test/);
  assert.match(screenLines(f.terminal)[18], /컨텍스트.*10/);
  f.child.write('c');
  await until(() => screenLines(f.terminal)[15] === 'CHILD BOTTOM', 'child cursor update not rendered');
  assert.match(screenLines(f.terminal)[17], /gpt-inline-test/);
  f.terminal.resize(60, 30);
  f.child.resize(60, 30);
  await until(() => screenLines(f.terminal)[0] === 'RESIZED 60x22', 'PTY did not receive reduced resize');
  assert.match(screenLines(f.terminal)[23], /gpt-inline-test/);
  f.child.write('q');
  assert.equal((await f.exited).exitCode, 0);
  await f.flush();
  assert.match(f.output(), /RESTORED \{"raw":false/);
  assert.match(f.output(), /\x1b\[\?1049l/);
});

test('parallel agents resize the Codex PTY while loaded skills stay on one row below tools', async t => {
  const f = await fixture(t);
  await until(() => screenLines(f.terminal).some(line => line.includes('컨텍스트')), 'HUD never displayed');
  const agents = ['Ada', 'Lin', 'Max'].map((name, index) => ({
    timestamp: new Date().toISOString(), type: 'event_msg',
    payload: { type: 'collab_agent_spawn_end', new_thread_id: `agent-${index}`,
      new_agent_nickname: name, new_agent_role: 'worker', status: 'running' },
  }));
  agents.push(
    { type: 'turn_context', payload: { approval_policy: 'on-request', approvals_reviewer: 'auto_review' } },
    { type: 'response_item', payload: { type: 'function_call', name: 'read_file', call_id: 'skill',
      arguments: '{"path":"/skills/brainstorming/SKILL.md"}' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'skill', output: '{"content":"PRIVATE_SKILL_BODY"}' } },
  );
  await appendFile(join(f.settings.codexHome, 'sessions', 'rollout-inline-test.jsonl'),
    agents.map(value => JSON.stringify(value)).join('\n') + '\n');
  await until(() => ['Ada', 'Lin', 'Max'].every(name => screenLines(f.terminal).some(line => line.includes(name))),
    'not all parallel agents appeared');
  await until(async () => (await f.records()).some(event => event.type === 'resize' && event.rows === 12),
    'Codex did not receive the reduced PTY height');
  assert.match(screenLines(f.terminal).join('\n'), /3 실행 중/);
  assert.match(screenLines(f.terminal).join('\n'), /auto-review \(on-request\)/);
  assert.match(screenLines(f.terminal).join('\n'), /brainstorming/);
  const rows = screenLines(f.terminal);
  const toolRow = rows.findIndex(line => /^도구 /.test(line));
  assert.match(rows[toolRow + 1], /^로드한 스킬 1 · brainstorming/);
  assert.doesNotMatch(screenLines(f.terminal).join('\n'), /PRIVATE_SKILL_BODY/);
  f.terminal.resize(60, 12);
  f.child.resize(60, 12);
  await until(() => screenLines(f.terminal)[0] === 'RESIZED 60x4', 'small terminal resize was not applied');
  f.child.write('\x1b[6;3~');
  await until(() => screenLines(f.terminal).some(line => line.includes('Max')),
    'HUD page down did not reach the last agent');
  const input = (await f.records()).filter(event => event.type === 'input').map(event => event.data).join('');
  assert.ok(!input.includes('\x1b[6;3~'), 'HUD navigation leaked into Codex');
  await appendFile(join(f.settings.codexHome, 'sessions', 'rollout-inline-test.jsonl'), JSON.stringify({
    type: 'event_msg', timestamp: new Date().toISOString(),
    payload: { type: 'collab_waiting_end', statuses: {
      'agent-0': { completed: 'done' }, 'agent-1': 'shutdown', 'agent-2': 'error',
    } },
  }) + '\n');
  f.terminal.resize(80, 24);
  f.child.resize(80, 24);
  await until(() => screenLines(f.terminal)[0] === 'RESIZED 80x16',
    'Codex did not reclaim space after agents finished');
  assert.doesNotMatch(screenLines(f.terminal).join('\n'), /에이전트|Ada|Lin|Max/);
  await appendFile(join(f.settings.codexHome, 'sessions', 'rollout-inline-test.jsonl'), JSON.stringify({
    type: 'event_msg', timestamp: new Date().toISOString(),
    payload: { type: 'collab_resume_end', receiver_thread_id: 'agent-1', status: 'running' },
  }) + '\n');
  await until(() => screenLines(f.terminal).some(line => /실행 중.*Lin/.test(line)),
    'resumed agent did not reappear');
  assert.match(screenLines(f.terminal).join('\n'), /에이전트 1 실행 중/);
  assert.doesNotMatch(screenLines(f.terminal).join('\n'), /Ada|Max/);
  f.child.write('q');
  assert.equal((await f.exited).exitCode, 0);
});

test('Ctrl+C and Unicode paste reach Codex, preserving its exit code and restoring raw mode', async t => {
  const f = await fixture(t);
  const paste = '\x1b[200~한글🙂\nline two\x1b[201~';
  f.child.write(paste);
  await until(async () => (await f.records()).filter(event => event.type === 'input').map(event => event.data).join('').includes(paste),
    'paste bytes changed or were lost');
  f.child.write('\x03');
  const exit = await f.exited;
  assert.equal(exit.exitCode, 7);
  await f.flush();
  assert.match(f.output(), /RESTORED \{"raw":false,"result":\{"exitCode":7/);
});

for (const mouse of [false, true]) {
  test(`runtime selection controls preserve mouse=${mouse} through real PTYs without reaching Codex`, async t => {
    const f = await fixture(t, {}, { mouse });
    await until(() => screenLines(f.terminal).some(line => line.includes('컨텍스트')), 'Korean HUD never appeared');
    assert.equal(f.terminal.modes.mouseTrackingMode, mouse ? 'vt200' : 'none');
    f.child.write('\x1b');
    f.child.write('l');
    await until(() => screenLines(f.terminal).some(line => line.includes('Context')), 'HUD did not switch to English');
    await delay(250);
    assert.ok(screenLines(f.terminal).some(line => line.includes('Context')), 'polling reverted the language');
    f.child.write('\x1bm');
    await until(() => f.terminal.modes.mouseTrackingMode === 'none'
      && screenLines(f.terminal).some(line => line.includes('Text selection')), 'selection mode did not release the mouse');
    const frozen = screenLines(f.terminal);
    await appendFile(join(f.settings.codexHome, 'sessions', 'rollout-inline-test.jsonl'), JSON.stringify({
      type: 'turn_context', payload: { model: 'updated-while-selecting' },
    }) + '\n');
    await delay(300);
    await f.flush();
    assert.deepEqual(screenLines(f.terminal), frozen);
    f.child.write('\x1bm');
    await until(() => screenLines(f.terminal).some(line => line.includes('updated-while-selecting')),
      'latest HUD was not displayed after selection mode');
    assert.equal(f.terminal.modes.mouseTrackingMode, mouse ? 'vt200' : 'none');
    f.child.write('\x1bl');
    await until(() => screenLines(f.terminal).some(line => line.includes('컨텍스트')), 'HUD did not switch back to Korean');
    const input = (await f.records()).filter(event => event.type === 'input').map(event => event.data).join('');
    assert.ok(!input.includes('\x1bl') && !input.includes('\x1bm'), 'HUD shortcuts leaked into Codex');
    f.child.write('q');
    assert.equal((await f.exited).exitCode, 0);
  });
}

test('a termination signal restores the terminal and does not leave Codex running', async t => {
  const f = await fixture(t);
  const pid = (await f.records()).find(event => event.type === 'ready').pid;
  process.kill(f.child.pid, 'SIGTERM');
  const exit = await f.exited;
  await f.flush();
  assert.equal(exit.exitCode, 143);
  assert.match(f.output(), /RESTORED \{"raw":false/);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('termination escalates for a child that ignores SIGTERM and still restores the screen', async t => {
  const f = await fixture(t, { HUD_TEST_IGNORE_TERM: '1' });
  const pid = (await f.records()).find(event => event.type === 'ready').pid;
  process.kill(f.child.pid, 'SIGTERM');
  await f.exited;
  await f.flush();
  assert.match(f.output(), /RESTORED \{"raw":false/);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('termination cleans up owned descendants even after the Codex leader has exited', async t => {
  const f = await fixture(t, { HUD_TEST_DESCENDANT: '1' });
  let pid;
  await until(async () => {
    try { pid = Number(await readFile(join(f.settings.cwd, 'descendant-pid'), 'utf8')); return true; }
    catch { return false; }
  }, 'descendant did not start');
  t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* Already terminated. */ } });
  process.kill(f.child.pid, 'SIGTERM');
  await f.exited;
  await until(() => {
    try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
  }, 'owned descendant survived Codex shutdown');
  await f.flush();
  assert.match(f.output(), /RESTORED \{"raw":false/);
});

test('a stalled physical terminal does not block signal handling or Codex termination', async t => {
  const f = await fixture(t, { HUD_TEST_FLOOD: '1' });
  const pid = (await f.records()).find(event => event.type === 'ready').pid;
  await delay(100);
  f.child.pause();
  t.after(() => f.child.resume());
  await delay(1300);
  process.kill(f.child.pid, 'SIGTERM');
  try {
    await until(async () => {
      try { return await readFile(join(f.settings.cwd, 'handled-signal'), 'utf8') === 'handled'; }
      catch { return false; }
    }, 'host output stalled the signal handler');
    await until(() => {
      try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
    }, 'Codex remained alive while host output was stalled');
  } finally {
    f.child.resume();
  }
  await f.exited;
  await f.flush();
  assert.match(f.output(), /RESTORED \{"raw":false/);
});
