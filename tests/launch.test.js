import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fstatSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { launch, shellQuote } from '../src/launch.js';

const execFileAsync = promisify(execFile);

// The fake replaces tmux's server, not the launcher or the shell. It records the
// actual execFile/spawn boundary and executes pane argv through the real /bin/sh.
const fakeTmux = `#!${process.execPath}
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const argv = process.argv.slice(2);
const command = argv[0];
const env = process.env;
const value = (flag) => argv[argv.indexOf(flag) + 1];
const descriptor = (fd) => {
  const { dev, ino, mode } = fs.fstatSync(fd);
  return { dev, ino, mode };
};
fs.appendFileSync(env.CODEX_HUD_TEST_LOG, JSON.stringify({
  tool: 'tmux', argv, cwd: process.cwd(),
  home: env.CODEX_HOME, thread: env.CODEX_THREAD_ID ?? null,
  fds: [0, 1, 2].map(descriptor),
}) + '\\n');
const fails = (env.CODEX_HUD_TEST_FAIL || '').split(',').includes(command);
const creating = command === 'new-session' || command === 'new-window';
if (creating && (!fails || env.CODEX_HUD_TEST_PARTIAL_CREATE === '1')) {
  fs.writeFileSync(env.CODEX_HUD_TEST_STATE, JSON.stringify({
    sessionId: command === 'new-session' ? '$101' : '$40',
    sessionName: command === 'new-session' ? value('-s') : 'personal',
    windowId: '@201', windowName: value('-n'), outside: command === 'new-session',
  }));
}
if (fails) {
  if (command !== 'attach-session') process.stderr.write('forced ' + command + ' failure\\n');
  process.exit(17);
}
function runPane() {
  const separator = argv.indexOf('--');
  if (separator === -1) throw new Error('missing shell-command delimiter');
  const args = argv.slice(separator + 1);
  const child = spawnSync(args[0], args.slice(1), {
    cwd: env.CODEX_HUD_TEST_SERVER_CWD,
    env: { ...env, CODEX_HOME: '/stale/server/home',
      CODEX_THREAD_ID: 'stale-server-thread', PATH: '/stale/server/path',
      SHELL: '/this-shell-must-not-be-invoked' },
    encoding: 'utf8',
  });
  if (child.error || child.status !== 0) {
    process.stderr.write(String(child.error || child.stderr));
    process.exit(18);
  }
}
let state;
try { state = JSON.parse(fs.readFileSync(env.CODEX_HUD_TEST_STATE, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
switch (command) {
  case '-V':
    process.stdout.write('tmux 3.4\\n');
    break;
  case 'display-message':
    process.stdout.write(env.CODEX_HUD_TEST_BAD_CONTEXT === '1' ? 'not-a-session\\n' : '$40\\n');
    break;
  case 'new-session':
  case 'new-window':
    runPane();
    process.stdout.write(env.CODEX_HUD_TEST_BAD_CREATE === '1'
      ? 'malformed output\\n' : state.sessionId + '\\t@201\\t%301\\n');
    break;
  case 'split-window':
    runPane();
    process.stdout.write(env.CODEX_HUD_TEST_BAD_SPLIT === '1' ? 'not-a-pane\\n' : '%302\\n');
    break;
  case 'list-sessions':
    process.stdout.write('$40\\tpersonal\\n');
    if (state?.outside) process.stdout.write('$101\\t' + state.sessionName + '\\n');
    break;
  case 'list-windows':
    process.stdout.write('@10\\texisting-window\\n');
    if (state && !state.outside) process.stdout.write('@201\\t' + state.windowName + '\\n');
    break;
  case 'set-hook':
  case 'select-pane':
  case 'select-window':
  case 'attach-session':
  case 'kill-session':
  case 'kill-window':
    break;
  default:
    throw new Error('unexpected tmux command: ' + command);
}
`;

const fakeCodex = `#!${process.execPath}
const fs = require('node:fs');
const argv = process.argv.slice(2);
const probe = argv.length === 1 && argv[0] === '--version';
fs.appendFileSync(process.env.CODEX_HUD_TEST_LOG, JSON.stringify({
  tool: 'codex', argv, probe, cwd: process.cwd(),
  home: process.env.CODEX_HOME, thread: process.env.CODEX_THREAD_ID ?? null,
  path: process.env.PATH,
}) + '\\n');
if (probe) {
  if (process.env.CODEX_HUD_TEST_CODEX_FAIL === '1') {
    process.stderr.write('forced codex version failure\\n');
    process.exit(19);
  }
  process.stdout.write('codex-cli 0.test\\n');
}
`;

const fakeHud = `
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.CODEX_HUD_TEST_LOG, JSON.stringify({
  tool: 'hud', argv: process.argv.slice(2), cwd: process.cwd(),
  home: process.env.CODEX_HOME, thread: process.env.CODEX_THREAD_ID ?? null,
  path: process.env.PATH,
}) + '\\n');
`;

async function fixture(t, { inside = false, unusualPaths = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'codex-hud-launch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const suffix = unusualPaths ? " ' spaces $(touch INJECTED); newline\nend;" : '';
  const bin = join(root, `bin${suffix}`);
  const cwd = join(root, `work${suffix}`);
  const codexHome = join(root, `home${suffix}`);
  const cliPath = join(root, `hud${suffix}.mjs`);
  const log = join(root, 'calls.jsonl');
  await Promise.all([bin, cwd, codexHome].map((path) => mkdir(path)));
  await Promise.all([
    writeFile(join(bin, 'tmux'), fakeTmux, { mode: 0o755 }),
    writeFile(join(bin, 'codex'), fakeCodex, { mode: 0o755 }),
    writeFile(cliPath, fakeHud),
  ]);
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
  t.after(() => {
    if (descriptor) Object.defineProperty(process.stdin, 'isTTY', descriptor);
    else delete process.stdin.isTTY;
  });
  const env = {
    ...process.env,
    PATH: bin,
    CODEX_HOME: '/inherited/wrong-home',
    CODEX_THREAD_ID: 'inherited-wrong-thread',
    CODEX_HUD_TEST_LOG: log,
    CODEX_HUD_TEST_STATE: join(root, 'state.json'),
    CODEX_HUD_TEST_SERVER_CWD: root,
  };
  delete env.TMUX;
  delete env.TMUX_PANE;
  if (inside) {
    env.TMUX = '/tmp/fake-server,1234,40';
    env.TMUX_PANE = '%77';
  }
  let warnings = '';
  const options = {
    cwd, codexHome, cliPath, codexArgs: [], preset: 'full', language: 'en', env,
    stdout: { isTTY: true, columns: 100, rows: 40 },
    stderr: { write: (s) => { warnings += s; } },
  };
  return {
    root, bin, options,
    warnings: () => warnings,
    async calls() {
      try {
        return (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
    },
  };
}

const tmuxCalls = (calls) => calls.filter((call) => call.tool === 'tmux');
const flag = (call, name) => call.argv[call.argv.indexOf(name) + 1];
const killed = (calls) => tmuxCalls(calls).filter((call) => call.argv[0].startsWith('kill-'));

test('shellQuote preserves literal shell metacharacters, empty strings, and newlines', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codex-hud-quote-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const values = ['', 'two words', "O'Brien", '$(touch INJECTED)', '`touch INJECTED`',
    '; touch INJECTED; #', 'first\nsecond', '"double"', 'trailing\\', ';', '한글 🌱'];
  const command = `exec ${shellQuote(process.execPath)} -e `
    + `'process.stdout.write(JSON.stringify(process.argv.slice(1)))' -- `
    + values.map(shellQuote).join(' ');
  const { stdout } = await execFileAsync('/bin/sh', ['-c', command], { cwd: root });
  assert.deepEqual(JSON.parse(stdout), values);
  await assert.rejects(access(join(root, 'INJECTED')), { code: 'ENOENT' });
});

test('shellQuote rejects arguments the operating system cannot represent', () => {
  assert.throws(() => shellQuote('nul\0byte'), /NUL|null byte/i);
  assert.throws(() => shellQuote(123), /string/i);
});

test('outside tmux creates detached Codex and HUD panes before attaching with inherited stdio', async (t) => {
  const f = await fixture(t, { unusualPaths: true });
  f.options.codexArgs = ['--model', 'model with spaces', '--', "O'Brien",
    '$(touch INJECTED)', '`touch INJECTED`', '; touch INJECTED; #', 'first\nsecond', ''];
  Object.freeze(f.options.codexArgs);
  Object.freeze(f.options.env);
  const before = Date.now();
  const result = await launch(f.options);
  const after = Date.now();
  const calls = await f.calls();
  const tmux = tmuxCalls(calls);
  assert.deepEqual(tmux.map((call) => call.argv[0]),
    ['-V', 'new-session', 'split-window', 'set-hook', 'select-pane', 'attach-session']);
  assert.ok(calls.findIndex((call) => call.tool === 'codex' && call.probe)
    < calls.findIndex((call) => call.argv[0] === 'new-session'));
  assert.ok(tmux[1].argv.includes('-d'));
  assert.match(flag(tmux[1], '-s'), /^codex-hud-/);
  assert.equal(flag(tmux[1], '-F'), '#{session_id}\t#{window_id}\t#{pane_id}');
  assert.ok(tmux[2].argv.includes('-v'));
  assert.ok(tmux[2].argv.includes('-d'));
  assert.equal(flag(tmux[2], '-t'), '%301');
  assert.equal(flag(tmux[2], '-l'), '7');
  assert.deepEqual(tmux[3].argv, [
    'set-hook', '-w', '-t', '@201', 'pane-exited',
    'if-shell -F "#{==:#{hook_pane},%301}" "kill-pane -t %302"',
  ]);
  assert.equal(flag(tmux[4], '-t'), '%301');
  assert.equal(flag(tmux[5], '-t'), '$101');
  assert.deepEqual(tmux[5].fds, [0, 1, 2].map((fd) => {
    const { dev, ino, mode } = fstatSync(fd);
    return { dev, ino, mode };
  }));
  const main = calls.find((call) => call.tool === 'codex' && !call.probe);
  const hud = calls.find((call) => call.tool === 'hud');
  assert.deepEqual(main.argv, f.options.codexArgs);
  assert.deepEqual(hud.argv.slice(0, -2), [
    'watch', '--cwd', f.options.cwd, '--codex-home', f.options.codexHome,
    '--preset', 'full', '--language', 'en',
    '--interval', '1000', '--path-levels', '1',
    '--no-mouse',
  ]);
  assert.equal(hud.argv.at(-2), '--since');
  assert.ok(Number(hud.argv.at(-1)) >= before && Number(hud.argv.at(-1)) <= after);
  for (const omitted of ['--width', '--no-color', '--ascii', '--no-git', '--follow', '--config']) {
    assert.ok(!hud.argv.includes(omitted), `${omitted} should not be enabled by default`);
  }
  for (const pane of [main, hud]) {
    assert.equal(pane.cwd, f.options.cwd);
    assert.equal(pane.home, f.options.codexHome);
    assert.equal(pane.thread, null);
    assert.equal(pane.path, f.options.env.PATH);
  }
  assert.ok(tmux.every((call) => call.home === f.options.codexHome && call.thread === null));
  assert.equal(f.options.env.CODEX_THREAD_ID, 'inherited-wrong-thread');
  assert.equal(f.options.env.CODEX_HOME, '/inherited/wrong-home');
  assert.equal(f.warnings(), '');
  assert.deepEqual(result, {
    sessionId: '$101', windowId: '@201', mainPaneId: '%301', hudPaneId: '%302',
  });
  for (const path of [f.root, f.options.cwd]) {
    await assert.rejects(access(join(path, 'INJECTED')), { code: 'ENOENT' });
  }
});

test('inside tmux creates and focuses a new window in the originating session without nesting', async (t) => {
  const f = await fixture(t, { inside: true });
  f.options.preset = 'essential';
  f.options.language = 'ko';
  const result = await launch(f.options);
  const calls = await f.calls();
  const tmux = tmuxCalls(calls);
  assert.deepEqual(tmux.map((call) => call.argv[0]),
    ['-V', 'display-message', 'new-window', 'split-window', 'set-hook', 'select-pane', 'select-window']);
  assert.equal(flag(tmux[1], '-t'), '%77');
  assert.ok(tmux[2].argv.includes('-d'));
  assert.equal(flag(tmux[2], '-t'), '$40:');
  assert.equal(flag(tmux[3], '-t'), '%301');
  assert.equal(flag(tmux[3], '-l'), '5');
  assert.deepEqual(tmux[4].argv, [
    'set-hook', '-w', '-t', '@201', 'pane-exited',
    'if-shell -F "#{==:#{hook_pane},%301}" "kill-pane -t %302"',
  ]);
  assert.equal(flag(tmux[5], '-t'), '%301');
  assert.equal(flag(tmux[6], '-t'), '$40:@201');
  const hud = calls.find((call) => call.tool === 'hud');
  assert.equal(hud.argv[hud.argv.indexOf('--language') + 1], 'ko');
  assert.equal(hud.argv[hud.argv.indexOf('--preset') + 1], 'essential');
  assert.equal(result.sessionId, '$40');
  assert.deepEqual(killed(calls), []);
});

test('window exit hook keeps its condition and HUD command as separately quoted arguments', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.bin, 'if-shell'),
    `#!${process.execPath}\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n`,
    { mode: 0o755 });
  await launch(f.options);
  const hook = tmuxCalls(await f.calls()).find((call) => call.argv[0] === 'set-hook');
  assert.ok(hook, 'the new window must have an exit hook');
  const { stdout } = await execFileAsync('/bin/sh', ['-c', hook.argv.at(-1)], {
    cwd: f.root, env: f.options.env,
  });
  assert.deepEqual(JSON.parse(stdout), [
    '-F', '#{==:#{hook_pane},%301}', 'kill-pane -t %302',
  ]);
});

test('essential preset reserves all five renderer rows outside tmux', async (t) => {
  const f = await fixture(t);
  f.options.preset = 'essential';
  await launch(f.options);
  const split = tmuxCalls(await f.calls()).find((call) => call.argv[0] === 'split-window');
  assert.equal(flag(split, '-l'), '5');
});

test('minimal preset reserves a small HUD pane', async (t) => {
  const f = await fixture(t);
  f.options.preset = 'minimal';
  await launch(f.options);
  const split = tmuxCalls(await f.calls()).find((call) => call.argv[0] === 'split-window');
  assert.equal(flag(split, '-l'), '2');
});

for (const [option, directory] of [
  ['-C', 'resume'],
  ['--cd', "project ' $(touch INJECTED);\nwith spaces"],
  ['--cd=', 'project=with=equals'],
]) {
  test(`HUD follows Codex ${option} relative directory without applying it twice`, async (t) => {
    const f = await fixture(t);
    const target = join(f.options.cwd, directory);
    await mkdir(target);
    f.options.codexArgs = Object.freeze(option === '--cd='
      ? [`--cd=${directory}`] : [option, directory]);
    await launch(f.options);
    const calls = await f.calls();
    const main = calls.find((call) => call.tool === 'codex' && !call.probe);
    const hud = calls.find((call) => call.tool === 'hud');
    assert.equal(flag(hud, '--cwd'), target);
    assert.ok(hud.argv.includes('--since'));
    assert.equal(main.cwd, f.options.cwd);
    assert.deepEqual(main.argv, f.options.codexArgs);
    assert.equal(f.warnings(), '');
    await assert.rejects(access(join(f.options.cwd, 'INJECTED')), { code: 'ENOENT' });
  });
}

test('HUD follows an absolute Codex directory while the main pane keeps its base cwd', async (t) => {
  const f = await fixture(t, { inside: true });
  const target = join(f.root, 'absolute project');
  await mkdir(target);
  f.options.codexArgs = Object.freeze(['--cd', target]);
  await launch(f.options);
  const calls = await f.calls();
  const main = calls.find((call) => call.tool === 'codex' && !call.probe);
  const hud = calls.find((call) => call.tool === 'hud');
  assert.equal(flag(hud, '--cwd'), target);
  assert.equal(main.cwd, f.options.cwd);
  assert.deepEqual(main.argv, f.options.codexArgs);
});

test('last Codex directory before -- wins and resolves relative to the original cwd', async (t) => {
  const f = await fixture(t);
  const target = join(f.options.cwd, 'last project');
  await mkdir(target);
  f.options.codexArgs = Object.freeze([
    '-C', 'first', '--cd=second', '--cd', 'last project',
    '--', '--cd=ignored', '-C', 'also ignored', 'resume',
  ]);
  await launch(f.options);
  const calls = await f.calls();
  const main = calls.find((call) => call.tool === 'codex' && !call.probe);
  const hud = calls.find((call) => call.tool === 'hud');
  assert.equal(flag(hud, '--cwd'), target);
  assert.ok(hud.argv.includes('--since'));
  assert.equal(main.cwd, f.options.cwd);
  assert.deepEqual(main.argv, f.options.codexArgs);
});

test('Codex prompt arguments after -- cannot override HUD cwd or turn it into resume mode', async (t) => {
  const f = await fixture(t);
  f.options.codexArgs = Object.freeze(['--', '--cd=ignored', '-C', 'ignored', 'fork']);
  await launch(f.options);
  const calls = await f.calls();
  const hud = calls.find((call) => call.tool === 'hud');
  const main = calls.find((call) => call.tool === 'codex' && !call.probe);
  assert.equal(flag(hud, '--cwd'), f.options.cwd);
  assert.ok(hud.argv.includes('--since'));
  assert.deepEqual(main.argv, f.options.codexArgs);
  assert.equal(f.warnings(), '');
});

test('missing Codex directory values fail before running programs', async (t) => {
  const f = await fixture(t);
  for (const codexArgs of [['-C'], ['--cd'], ['--cd', '--', 'prompt']]) {
    await assert.rejects(launch({ ...f.options, codexArgs }), /directory/i);
  }
  assert.deepEqual(await f.calls(), []);
});

test('forwards resolved HUD preferences through the shell without modifying Codex arguments', async (t) => {
  const f = await fixture(t, { inside: true });
  const configPath = join(f.root, "HUD preferences ' $(touch INJECTED); extra\nsettings.json");
  await writeFile(configPath, '{}');
  Object.assign(f.options, {
    interval: 750, width: 97, pathLevels: 3,
    color: false, ascii: true, git: false, follow: true, mouse: true, configPath,
    codexArgs: ['--config', 'model="unchanged"', '--', "Codex ' $(touch INJECTED);\nprompt"],
  });
  Object.freeze(f.options.codexArgs);
  Object.freeze(f.options);
  await launch(f.options);
  const calls = await f.calls();
  const hud = calls.find((call) => call.tool === 'hud');
  const main = calls.find((call) => call.tool === 'codex' && !call.probe);
  assert.equal(flag(hud, '--interval'), '750');
  assert.equal(flag(hud, '--width'), '97');
  assert.equal(flag(hud, '--path-levels'), '3');
  assert.equal(flag(hud, '--config'), configPath);
  for (const enabled of ['--no-color', '--ascii', '--no-git', '--follow', '--mouse']) {
    assert.equal(hud.argv.filter((arg) => arg === enabled).length, 1);
  }
  assert.ok(hud.argv.includes('--since'));
  assert.deepEqual(main.argv, f.options.codexArgs);
  for (const directory of [f.root, f.options.cwd]) {
    await assert.rejects(access(join(directory, 'INJECTED')), { code: 'ENOENT' });
  }
});

test('explicit default preferences keep automatic width and first-session pinning', async (t) => {
  const f = await fixture(t);
  Object.assign(f.options, {
    interval: 1000, width: null, pathLevels: 1,
    color: true, ascii: false, git: true, follow: false, configPath: null,
  });
  await launch(f.options);
  const hud = (await f.calls()).find((call) => call.tool === 'hud');
  assert.ok(hud.argv.includes('--no-mouse'));
  assert.equal(flag(hud, '--interval'), '1000');
  assert.equal(flag(hud, '--path-levels'), '1');
  for (const omitted of ['--width', '--no-color', '--ascii', '--no-git', '--follow', '--config']) {
    assert.ok(!hud.argv.includes(omitted));
  }
});

for (const preferences of [
  { interval: 200, width: 1, pathLevels: 1 },
  { interval: 60_000, width: 1000, pathLevels: 3 },
]) {
  test(`forwards numeric preference bounds: ${JSON.stringify(preferences)}`, async (t) => {
    const f = await fixture(t);
    Object.assign(f.options, preferences);
    await launch(f.options);
    const hud = (await f.calls()).find((call) => call.tool === 'hud');
    assert.equal(flag(hud, '--interval'), String(preferences.interval));
    assert.equal(flag(hud, '--width'), String(preferences.width));
    assert.equal(flag(hud, '--path-levels'), String(preferences.pathLevels));
  });
}

test('rejects invalid HUD preferences before creating tmux resources', async (t) => {
  const f = await fixture(t);
  const cases = [
    [{ interval: 199 }, /interval/],
    [{ interval: 60_001 }, /interval/],
    [{ interval: 500.5 }, /interval/],
    [{ interval: '1000' }, /interval/],
    [{ width: 0 }, /width/],
    [{ width: 1001 }, /width/],
    [{ width: 80.5 }, /width/],
    [{ pathLevels: 0 }, /pathLevels/],
    [{ pathLevels: 4 }, /pathLevels/],
    [{ pathLevels: 1.5 }, /pathLevels/],
    [{ color: 'false' }, /color/],
    [{ ascii: 'true' }, /ascii/],
    [{ git: 0 }, /git/],
    [{ follow: 'true' }, /follow/],
    [{ mouse: 'true' }, /mouse/],
    [{ configPath: '' }, /configPath/],
    [{ configPath: 123 }, /configPath/],
    [{ configPath: 'bad\0path' }, /NUL|null byte/],
  ];
  for (const [overrides, message] of cases) {
    await assert.rejects(launch({ ...f.options, ...overrides }), message);
  }
  assert.deepEqual(await f.calls(), []);
});

for (const codexArgs of [['--profile', 'resume'], ['--profile=resume']]) {
  test(`tmux profile arguments ${JSON.stringify(codexArgs)} preserve the fresh-session cutoff`, async (t) => {
    const f = await fixture(t);
    f.options.codexArgs = Object.freeze(codexArgs);
    const before = Date.now();
    await launch(f.options);
    const after = Date.now();
    const calls = await f.calls();
    const main = calls.find(call => call.tool === 'codex' && !call.probe);
    const hud = calls.find(call => call.tool === 'hud');
    assert.ok(hud.argv.includes('--since'));
    const since = Number(flag(hud, '--since'));
    assert.ok(since >= before && since <= after);
    assert.equal(flag(hud, '--cwd'), f.options.cwd);
    assert.deepEqual(main.argv, codexArgs);
    assert.equal(f.warnings(), '');
  });
}

test('tmux option values preserve the last real cwd and the -- delimiter', async (t) => {
  const f = await fixture(t, { inside: true });
  const target = join(f.options.cwd, 'last');
  await mkdir(target);
  f.options.codexArgs = Object.freeze([
    '-C', 'first', '--profile', 'resume', '--model', 'fork', '--cd=last',
    '--config', '--cd=not-the-cwd', '--', '-C', 'ignored', 'resume',
  ]);
  await launch(f.options);
  const calls = await f.calls();
  const main = calls.find(call => call.tool === 'codex' && !call.probe);
  const hud = calls.find(call => call.tool === 'hud');
  assert.equal(flag(hud, '--cwd'), target);
  assert.ok(hud.argv.includes('--since'));
  assert.equal(main.cwd, f.options.cwd);
  assert.deepEqual(main.argv, f.options.codexArgs);
  assert.equal(f.warnings(), '');
});

for (const subcommand of ['resume', 'fork']) {
  test(`${subcommand} after option values preserves Codex argv and omits --since with an ambiguity warning`, async (t) => {
    const f = await fixture(t);
    f.options.codexArgs = Object.freeze([
      '--profile', 'resume', '--config', 'model="test"', subcommand, '--last', '--model', 'fork',
    ]);
    await launch(f.options);
    const calls = await f.calls();
    const main = calls.find((call) => call.tool === 'codex' && !call.probe);
    const hud = calls.find((call) => call.tool === 'hud');
    assert.deepEqual(main.argv, f.options.codexArgs);
    assert.ok(!hud.argv.includes('--since'));
    assert.ok(!hud.argv.includes('--session'));
    assert.equal(hud.thread, null);
    assert.match(f.warnings(), /--session/);
    assert.match(f.warnings(), /multiple|guarantee|ambiguous/i);
  });
}

test('explicit session pins the HUD without a creation cutoff or rewriting Codex arguments', async (t) => {
  const f = await fixture(t, { inside: true });
  const target = join(f.options.cwd, 'resumed project');
  await mkdir(target);
  f.options.session = "rollout ' $(touch INJECTED);\nexplicit.jsonl";
  f.options.codexArgs = ['resume', '12345678-1234-1234-1234-123456789abc', '--cd', target];
  f.options.env.CODEX_THREAD_ID = 'explicit-parent-thread';
  await launch(f.options);
  const calls = await f.calls();
  const hud = calls.find((call) => call.tool === 'hud');
  const main = calls.find((call) => call.tool === 'codex' && !call.probe);
  assert.deepEqual(main.argv, f.options.codexArgs);
  assert.ok(!hud.argv.includes('--since'));
  assert.equal(flag(hud, '--cwd'), target);
  assert.equal(hud.argv[hud.argv.indexOf('--session') + 1], f.options.session);
  assert.equal(hud.thread, 'explicit-parent-thread');
  assert.equal(main.thread, 'explicit-parent-thread');
  assert.equal(f.warnings(), '');
  await assert.rejects(access(join(f.options.cwd, 'INJECTED')), { code: 'ENOENT' });
});

for (const stream of ['stdin', 'stdout']) {
  test(`requires an interactive ${stream} before creating resources or running programs`, async (t) => {
    const f = await fixture(t);
    if (stream === 'stdin') {
      Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
    } else {
      f.options.stdout.isTTY = false;
    }
    await assert.rejects(launch(f.options), /TTY|interactive terminal/i);
    assert.deepEqual(await f.calls(), []);
  });
}

for (const executable of ['tmux', 'codex']) {
  test(`reports missing ${executable} without creating tmux resources`, async (t) => {
    const f = await fixture(t);
    await rm(join(f.bin, executable));
    await assert.rejects(launch(f.options), new RegExp(`${executable}.*PATH`, 'i'));
    assert.ok(!tmuxCalls(await f.calls()).some((call) => call.argv[0].startsWith('new-')));
  });

  test(`reports a broken ${executable} executable before creating tmux resources`, async (t) => {
    const f = await fixture(t);
    if (executable === 'tmux') f.options.env.CODEX_HUD_TEST_FAIL = '-V';
    else f.options.env.CODEX_HUD_TEST_CODEX_FAIL = '1';
    await assert.rejects(launch(f.options), new RegExp(`${executable}.*forced`, 'is'));
    assert.ok(!tmuxCalls(await f.calls()).some((call) => call.argv[0].startsWith('new-')));
  });
}

test('rejects invalid launch options before executing anything', async (t) => {
  const f = await fixture(t);
  const cases = [
    [{ cwd: 'relative' }, /cwd.*absolute/i],
    [{ codexHome: 'relative' }, /codexHome.*absolute/i],
    [{ cliPath: 'relative' }, /cliPath.*absolute/i],
    [{ codexArgs: 'resume' }, /codexArgs.*array/i],
    [{ codexArgs: ['ok', 42] }, /codexArgs.*string/i],
    [{ codexArgs: ['bad\0arg'] }, /NUL|null byte/i],
    [{ session: '' }, /session/i],
    [{ preset: 'giant' }, /preset/i],
    [{ language: 'xx' }, /language/i],
    [{ cwd: join(f.root, 'missing') }, /cwd|directory/i],
    [{ cliPath: join(f.root, 'missing.js') }, /cliPath|HUD|read/i],
  ];
  for (const [overrides, message] of cases) {
    await assert.rejects(launch({ ...f.options, ...overrides }), message);
  }
  assert.deepEqual(await f.calls(), []);
});

test('rejects an unidentifiable current tmux session without creating or killing anything', async (t) => {
  const f = await fixture(t, { inside: true });
  f.options.env.CODEX_HUD_TEST_BAD_CONTEXT = '1';
  await assert.rejects(launch(f.options), /tmux.*session|session.*tmux/i);
  const calls = tmuxCalls(await f.calls());
  assert.ok(!calls.some((call) => /^(new-|kill-)/.test(call.argv[0])));
});

for (const inside of [false, true]) {
  for (const failure of ['split-window', 'set-hook', 'select-pane', ...(inside ? ['select-window'] : [])]) {
    test(`${inside ? 'inside' : 'outside'} tmux cleans up only its new resource after ${failure} fails`, async (t) => {
      const f = await fixture(t, { inside });
      f.options.env.CODEX_HUD_TEST_FAIL = failure;
      await assert.rejects(launch(f.options), new RegExp(`forced ${failure} failure`));
      const calls = await f.calls();
      assert.deepEqual(killed(calls).map((call) => call.argv),
        [[inside ? 'kill-window' : 'kill-session', '-t', inside ? '@201' : '$101']]);
      assert.ok(!tmuxCalls(calls).some((call) => call.argv[0] === 'attach-session'));
      if (failure === 'split-window' || failure === 'set-hook') {
        assert.ok(!tmuxCalls(calls).some((call) => call.argv[0] === 'select-pane'));
      }
      if (failure !== 'select-window') {
        assert.ok(!tmuxCalls(calls).some((call) => call.argv[0] === 'select-window'));
      }
    });
  }

  test(`${inside ? 'window' : 'session'} creation failure never kills an existing resource`, async (t) => {
    const f = await fixture(t, { inside });
    const command = inside ? 'new-window' : 'new-session';
    f.options.env.CODEX_HUD_TEST_FAIL = command;
    await assert.rejects(launch(f.options), new RegExp(`forced ${command} failure`));
    assert.deepEqual(killed(await f.calls()), []);
  });

  test(`recovers the owned ${inside ? 'window' : 'session'} when creation fails after allocating it`, async (t) => {
    const f = await fixture(t, { inside });
    const command = inside ? 'new-window' : 'new-session';
    f.options.env.CODEX_HUD_TEST_FAIL = command;
    f.options.env.CODEX_HUD_TEST_PARTIAL_CREATE = '1';
    await assert.rejects(launch(f.options), new RegExp(`forced ${command} failure`));
    const calls = await f.calls();
    assert.deepEqual(killed(calls).map((call) => call.argv),
      [[inside ? 'kill-window' : 'kill-session', '-t', inside ? '@201' : '$101']]);
    if (inside) {
      const lookup = tmuxCalls(calls).find((call) => call.argv[0] === 'list-windows');
      assert.equal(flag(lookup, '-t'), '$40');
    }
  });

  test(`malformed ${inside ? 'window' : 'session'} creation output triggers scoped cleanup`, async (t) => {
    const f = await fixture(t, { inside });
    f.options.env.CODEX_HUD_TEST_BAD_CREATE = '1';
    await assert.rejects(launch(f.options), /tmux.*(identifier|output)|malformed/i);
    const calls = await f.calls();
    assert.ok(!tmuxCalls(calls).some((call) => call.argv[0] === 'set-hook'));
    assert.deepEqual(killed(calls).map((call) => call.argv),
      [[inside ? 'kill-window' : 'kill-session', '-t', inside ? '@201' : '$101']]);
  });
}

test('malformed split output cleans up the created session without guessing a pane target', async (t) => {
  const f = await fixture(t);
  f.options.env.CODEX_HUD_TEST_BAD_SPLIT = '1';
  await assert.rejects(launch(f.options), /tmux.*(identifier|output)|malformed/i);
  const calls = await f.calls();
  assert.ok(!tmuxCalls(calls).some((call) => call.argv[0] === 'set-hook'));
  assert.deepEqual(killed(calls).map((call) => call.argv),
    [['kill-session', '-t', '$101']]);
});

test('cleanup failure retains the original error and reports the owned resource', async (t) => {
  const f = await fixture(t);
  f.options.env.CODEX_HUD_TEST_FAIL = 'split-window,kill-session';
  await assert.rejects(launch(f.options), (error) => {
    assert.match(error.message, /forced split-window failure/);
    assert.match(error.message, /clean.?up/i);
    assert.match(error.message, /\$101/);
    return true;
  });
  assert.deepEqual(killed(await f.calls()).map((call) => call.argv),
    [['kill-session', '-t', '$101']]);
});

test('an attach failure preserves the launched session and gives a reattach command', async (t) => {
  const f = await fixture(t);
  f.options.env.CODEX_HUD_TEST_FAIL = 'attach-session';
  await assert.rejects(launch(f.options), (error) => {
    assert.match(error.message, /attach-session.*17/);
    assert.match(error.message, /attach-session/);
    assert.match(error.message, /\$101/);
    return true;
  });
  assert.deepEqual(killed(await f.calls()), []);
});
