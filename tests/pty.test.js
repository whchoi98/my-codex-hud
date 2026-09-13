import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPty, prepareCodex, ptyAvailable } from '../src/pty.js';
import { findSession } from '../src/sessions.js';

const childSource = new URL('./fixtures/pty-child.cjs', import.meta.url);
const posix = { skip: process.platform === 'win32' ? 'Inline PTYs require POSIX' : false };

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'codex-hud-pty-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin ' spaces");
  const cwd = join(root, "work ' $(touch INJECTED);\nproject");
  const codexHome = join(root, 'codex home');
  const log = join(root, 'started');
  await Promise.all([bin, cwd].map(path => mkdir(path)));
  await writeFile(join(bin, 'codex'),
    `#!${process.execPath}\n${await readFile(childSource, 'utf8')}`, { mode: 0o755 });
  return {
    root, bin, log,
    settings: {
      cwd, codexHome,
      env: {
        ...process.env,
        PATH: bin,
        CODEX_HOME: '/stale/home',
        CODEX_THREAD_ID: 'stale-thread',
        TERM: 'dumb',
        COLUMNS: '999',
        LINES: '999',
        CODEX_HUD_PTY_STARTED: log,
        CODEX_HUD_PTY_VALUE: "two words ' $HOME; 한글 🌱\nnext",
      },
    },
  };
}

test('prepareCodex resolves an executable without launching it and isolates the child environment', posix, async (t) => {
  const f = await fixture(t);
  const codexArgs = Object.freeze(['--', '', "O'Brien", '$(touch INJECTED)', 'first\nsecond']);
  Object.freeze(f.settings.env);
  const settings = Object.freeze({ ...f.settings, codexArgs });
  const before = Date.now();
  const prepared = await prepareCodex(settings);
  assert.equal(prepared.file, join(f.bin, 'codex'));
  await access(prepared.file, constants.X_OK);
  assert.deepEqual(prepared.args, codexArgs);
  assert.equal(prepared.cwd, settings.cwd);
  assert.equal(prepared.hudSettings.cwd, settings.cwd);
  assert.equal(prepared.hudSettings.codexHome, settings.codexHome);
  assert.ok(prepared.hudSettings.since >= before && prepared.hudSettings.since <= Date.now());
  assert.equal(prepared.note, undefined);
  assert.equal(prepared.env.CODEX_HOME, settings.codexHome);
  assert.equal(prepared.env.TERM, 'xterm-256color');
  assert.equal(prepared.env.PATH, settings.env.PATH);
  assert.equal(prepared.env.CODEX_HUD_PTY_VALUE, settings.env.CODEX_HUD_PTY_VALUE);
  for (const key of ['CODEX_THREAD_ID', 'COLUMNS', 'LINES']) {
    assert.equal(Object.hasOwn(prepared.env, key), false, `${key} must not leak to the child`);
  }
  assert.equal(settings.env.CODEX_THREAD_ID, 'stale-thread');
  assert.equal(settings.env.CODEX_HOME, '/stale/home');
  assert.equal(settings.env.TERM, 'dumb');
  assert.equal(settings.env.LINES, '999');
  await assert.rejects(access(f.log), { code: 'ENOENT' });
});

test('prepareCodex supplies the launcher HUD defaults and an empty argv', posix, async (t) => {
  const f = await fixture(t);
  const { args, hudSettings } = await prepareCodex(f.settings);
  assert.deepEqual(args, []);
  for (const [key, expected] of Object.entries({
    preset: 'full', language: 'en', interval: 1000, width: null,
    pathLevels: 1, color: true, ascii: false, git: true, follow: false,
  })) assert.equal(hudSettings[key], expected, key);
});

test('prepareCodex forwards resolved HUD fields and replaces a stale fresh-launch cutoff', posix, async (t) => {
  const f = await fixture(t);
  const preferences = {
    preset: 'essential', language: 'ko', interval: 750, width: 97,
    pathLevels: 3, color: false, ascii: true, git: false, follow: true,
    configPath: join(f.root, "preferences ' with spaces.json"),
  };
  const before = Date.now();
  const { hudSettings } = await prepareCodex({
    ...f.settings, ...preferences, since: 1,
  });
  for (const [key, value] of Object.entries(preferences)) assert.equal(hudSettings[key], value);
  assert.ok(hudSettings.since >= before && hudSettings.since <= Date.now());
});

// Value-taking root/resume/fork flags from Codex 0.153.4 --help. Image is
// variadic and --cd changes context, so their behavior is covered separately.
for (const option of [
  '--profile', '-p', '--model', '-m', '--config', '-c',
  '--enable', '--disable', '--remote', '--remote-auth-token-env',
  '--local-provider', '--sandbox', '-s', '--add-dir', '--ask-for-approval', '-a',
]) {
  test(`${option} values named resume/fork preserve the fresh-session cutoff in every argv form`, posix, async (t) => {
    const f = await fixture(t);
    for (const value of ['resume', 'fork']) {
      const forms = [[option, value], [`${option}=${value}`]];
      if (!option.startsWith('--')) forms.push([`${option}${value}`]);
      for (const codexArgs of forms) {
        Object.freeze(codexArgs);
        const before = Date.now();
        const prepared = await prepareCodex({ ...f.settings, codexArgs });
        assert.ok(prepared.hudSettings.since >= before && prepared.hudSettings.since <= Date.now(),
          `expected a fresh-session cutoff for ${JSON.stringify(codexArgs)}`);
        assert.equal(prepared.hudSettings.cwd, f.settings.cwd);
        assert.equal(prepared.note, undefined);
        assert.deepEqual(prepared.args, codexArgs);
      }
    }
  });
}

test('profile/model/config payloads cannot be interpreted as cwd flags', posix, async (t) => {
  const f = await fixture(t);
  for (const option of ['--profile', '-p', '--model', '-m', '--config', '-c']) {
    for (const value of ['-Cignored', '-C=ignored', '--cd=ignored', '-C', '--cd']) {
      for (const codexArgs of [[option, value], [`${option}=${value}`]]) {
        // Codex validates the payload itself; the adapter must forward it intact.
        const prepared = await prepareCodex({ ...f.settings, codexArgs });
        assert.equal(prepared.hudSettings.cwd, f.settings.cwd, JSON.stringify(codexArgs));
        assert.equal(typeof prepared.hudSettings.since, 'number');
        assert.equal(prepared.note, undefined);
        assert.deepEqual(prepared.args, codexArgs);
      }
    }
  }
});

test('option values cannot override the last actual Codex cwd or consume the -- delimiter', posix, async (t) => {
  const f = await fixture(t);
  const target = join(f.settings.cwd, 'last');
  await mkdir(target);
  for (const tail of [
    ['--', 'resume', '--cd=ignored'],
    ['--profile', '--', 'fork', '-C', 'ignored'],
    ['--model', '--', 'resume', '--cd=ignored'],
    ['--config', '--', 'fork', '-Cignored'],
  ]) {
    const codexArgs = [
      '-C', 'first', '--profile', 'resume', '--model', 'fork',
      '--cd=last', '--config', '-Cignored', ...tail,
    ];
    const prepared = await prepareCodex({ ...f.settings, codexArgs });
    assert.equal(prepared.cwd, f.settings.cwd);
    assert.equal(prepared.hudSettings.cwd, target);
    assert.equal(typeof prepared.hudSettings.since, 'number');
    assert.equal(prepared.note, undefined);
    assert.deepEqual(prepared.args, codexArgs);
  }
});

for (const command of ['resume', 'fork']) {
  test(`real ${command} after option values still omits the cutoff and tracks subsequent cwd flags`, posix, async (t) => {
    const f = await fixture(t);
    const target = join(f.settings.cwd, 'last');
    await mkdir(target);
    for (const prefix of [
      ['--profile', 'resume', '--model', 'fork', '--config', 'resume'],
      ['-presume', '-m=fork', '--config=resume'],
      ['--add-dir', 'extra'],
      ['--search', '--no-alt-screen'],
      ['--image=first.png'],
      ['-ifirst.png'],
      ['-i=first.png'],
    ]) {
      const codexArgs = [
        ...prefix, command, '--last', '--cd', 'last',
        '--profile', 'resume', '-m', 'fork', '--config', '-Cignored',
        '--', '-C', 'ignored',
      ];
      const prepared = await prepareCodex({ ...f.settings, codexArgs });
      assert.equal(Object.hasOwn(prepared.hudSettings, 'since'), false, JSON.stringify(codexArgs));
      assert.match(prepared.note, /--session/);
      assert.equal(prepared.hudSettings.cwd, target);
      assert.equal(prepared.cwd, f.settings.cwd);
      assert.deepEqual(prepared.args, codexArgs);
    }
  });
}

test('separate image options consume multiple values without mistaking filenames for subcommands', posix, async (t) => {
  const f = await fixture(t);
  for (const codexArgs of [
    ['--image', 'first.png', 'resume', 'fork'],
    ['-i', 'first.png', 'fork', 'resume'],
    ['--image', 'first.png', 'resume', '-i', 'second.png', 'fork'],
    ['--image', '-', 'resume'],
    ['--image', 'first.png', 'resume', '--', 'fork', '-C', 'ignored'],
  ]) {
    const prepared = await prepareCodex({ ...f.settings, codexArgs });
    assert.equal(typeof prepared.hudSettings.since, 'number', JSON.stringify(codexArgs));
    assert.equal(prepared.hudSettings.cwd, f.settings.cwd);
    assert.equal(prepared.note, undefined);
    assert.deepEqual(prepared.args, codexArgs);
  }
});

test('a real flag terminates image values so cwd and subsequent subcommands are still recognized', posix, async (t) => {
  const f = await fixture(t);
  const target = join(f.settings.cwd, 'last');
  await mkdir(target);
  for (const command of [null, 'resume', 'fork']) {
    const codexArgs = [
      '--image', 'first.png', 'resume', 'fork', '-C', 'last',
      ...(command ? [command, '--last'] : []),
    ];
    const prepared = await prepareCodex({ ...f.settings, codexArgs });
    assert.equal(prepared.hudSettings.cwd, target);
    assert.equal(prepared.cwd, f.settings.cwd);
    assert.deepEqual(prepared.args, codexArgs);
    if (command) {
      assert.equal(Object.hasOwn(prepared.hudSettings, 'since'), false);
      assert.match(prepared.note, /--session/);
    } else {
      assert.equal(typeof prepared.hudSettings.since, 'number');
      assert.equal(prepared.note, undefined);
    }
  }
});

test('a profile named resume waits for new history instead of selecting an old session', posix, async (t) => {
  const f = await fixture(t);
  const sessions = join(f.settings.codexHome, 'sessions');
  await mkdir(sessions, { recursive: true });
  const writeSession = (name, id, timestamp) => writeFile(join(sessions, name),
    JSON.stringify({
      type: 'session_meta', payload: { id, cwd: f.settings.cwd, timestamp },
    }) + '\n');
  await writeSession('rollout-old.jsonl', '22222222-2222-4222-8222-222222222222', '2020-01-01T00:00:00Z');
  const { hudSettings } = await prepareCodex({
    ...f.settings, codexArgs: ['--profile', 'resume'],
  });
  assert.equal(await findSession(hudSettings), null, 'old history must not be selected by a fresh launch');
  await writeSession('rollout-new.jsonl', '33333333-3333-4333-8333-333333333333', new Date().toISOString());
  assert.equal(await findSession(hudSettings), join(sessions, 'rollout-new.jsonl'));
});

for (const codexArgs of [
  ['-C', 'resume'],
  ['--cd', 'resume'],
  ['--cd=resume'],
  ['-Cresume'],
  ['-C=resume'],
]) {
  test(`HUD follows ${JSON.stringify(codexArgs)} without changing the child cwd or argv`, posix, async (t) => {
    const f = await fixture(t);
    await mkdir(join(f.settings.cwd, 'resume'));
    const prepared = await prepareCodex({ ...f.settings, codexArgs });
    assert.equal(prepared.cwd, f.settings.cwd);
    assert.equal(prepared.hudSettings.cwd, join(f.settings.cwd, 'resume'));
    assert.deepEqual(prepared.args, codexArgs);
    assert.equal(typeof prepared.hudSettings.since, 'number');
    assert.equal(prepared.note, undefined);
  });
}

test('the final Codex directory resolves against initial cwd and parsing stops at --', posix, async (t) => {
  const f = await fixture(t);
  const target = join(f.settings.cwd, 'last');
  await mkdir(target);
  const codexArgs = Object.freeze([
    '-C', 'first', '--cd=second', '--cd', 'last',
    '--', '--cd=ignored', '-C', 'ignored', 'resume', 'fork',
  ]);
  const prepared = await prepareCodex({ ...f.settings, codexArgs });
  assert.equal(prepared.cwd, f.settings.cwd);
  assert.equal(prepared.hudSettings.cwd, target);
  assert.deepEqual(prepared.args, codexArgs);
  assert.equal(typeof prepared.hudSettings.since, 'number');
  assert.equal(prepared.note, undefined);
});

test('an absolute Codex directory changes only the HUD cwd', posix, async (t) => {
  const f = await fixture(t);
  const prepared = await prepareCodex({ ...f.settings, codexArgs: ['--cd', f.root] });
  assert.equal(prepared.cwd, f.settings.cwd);
  assert.equal(prepared.hudSettings.cwd, f.root);
});

for (const command of ['resume', 'fork']) {
  test(`${command} removes the cutoff and inherited thread and reports ambiguous selection`, posix, async (t) => {
    const f = await fixture(t);
    const codexArgs = ['--config', 'model="test"', command, '--last'];
    const prepared = await prepareCodex({ ...f.settings, codexArgs, since: Date.now() });
    assert.deepEqual(prepared.args, codexArgs);
    assert.equal(Object.hasOwn(prepared.hudSettings, 'since'), false);
    assert.equal(Object.hasOwn(prepared.env, 'CODEX_THREAD_ID'), false);
    assert.match(prepared.note, /--session/);
    assert.match(prepared.note, /multiple|guarantee|ambiguous/i);
  });
}

test('an explicit session pins only the HUD, omits since, and preserves an inherited thread', posix, async (t) => {
  const f = await fixture(t);
  const session = "rollout ' literal.jsonl";
  for (const codexArgs of [[], ['resume', '--last'], ['fork', '--last']]) {
    const prepared = await prepareCodex({
      ...f.settings, codexArgs, session, since: 1,
    });
    assert.equal(prepared.hudSettings.session, session);
    assert.equal(Object.hasOwn(prepared.hudSettings, 'since'), false);
    assert.equal(prepared.env.CODEX_THREAD_ID, 'stale-thread');
    assert.deepEqual(prepared.args, codexArgs);
    assert.equal(prepared.note, undefined);
  }
});

test('executable resolution skips nonexecutables and directories and accepts symlinks', posix, async (t) => {
  const f = await fixture(t);
  const blocked = join(f.root, 'not-executable');
  const directory = join(f.root, 'directory');
  const linked = join(f.root, 'linked');
  await Promise.all([blocked, directory, linked].map(path => mkdir(path)));
  await Promise.all([
    writeFile(join(blocked, 'codex'), 'not executable', { mode: 0o644 }),
    mkdir(join(directory, 'codex')),
    symlink(join(f.bin, 'codex'), join(linked, 'codex')),
  ]);
  const env = { ...f.settings.env, PATH: [blocked, directory, linked, f.bin].join(':') };
  const prepared = await prepareCodex({ ...f.settings, env });
  assert.equal(prepared.file, join(linked, 'codex'));
  assert.equal(prepared.env.PATH, env.PATH);
  await assert.rejects(access(f.log), { code: 'ENOENT' });
});

test('empty and relative PATH entries are relative to the initial child cwd', posix, async (t) => {
  const f = await fixture(t);
  await copyFile(join(f.bin, 'codex'), join(f.settings.cwd, 'codex'));
  await mkdir(join(f.settings.cwd, 'local-bin'));
  await copyFile(join(f.bin, 'codex'), join(f.settings.cwd, 'local-bin', 'codex'));
  for (const [path, expected] of [
    ['', join(f.settings.cwd, 'codex')],
    [':missing', join(f.settings.cwd, 'codex')],
    ['missing:local-bin', join(f.settings.cwd, 'local-bin', 'codex')],
  ]) {
    const prepared = await prepareCodex({
      ...f.settings, env: { ...f.settings.env, PATH: path },
    });
    assert.equal(prepared.file, expected);
    assert.equal(prepared.env.PATH, path);
  }
});

test('a missing or nonexecutable Codex reports PATH before anything is started', posix, async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'codex'), 'not executable', { mode: 0o644 });
  for (const path of [join(f.root, 'missing'), f.root]) {
    await assert.rejects(prepareCodex({
      ...f.settings, env: { ...f.settings.env, PATH: path },
    }), /codex.*executable.*PATH/i);
  }
  await assert.rejects(access(f.log), { code: 'ENOENT' });
});

test('invalid paths, arguments, environments, and sessions are rejected before launch', posix, async (t) => {
  const f = await fixture(t);
  const cases = [
    [{ cwd: 'relative' }, /cwd.*absolute/i],
    [{ cwd: join(f.root, 'missing') }, /cwd.*directory/i],
    [{ cwd: join(f.bin, 'codex') }, /cwd.*directory/i],
    [{ cwd: 'bad\0cwd' }, /NUL/i],
    [{ codexHome: 'relative' }, /codexHome.*absolute/i],
    [{ codexHome: 'bad\0home' }, /NUL/i],
    [{ codexArgs: 'resume' }, /codexArgs.*array/i],
    [{ codexArgs: [42] }, /codexArgs.*string/i],
    [{ codexArgs: ['bad\0arg'] }, /NUL/i],
    [{ codexArgs: ['-C'] }, /directory/i],
    [{ codexArgs: ['--cd'] }, /directory/i],
    [{ codexArgs: ['--cd', '--', 'prompt'] }, /directory/i],
    [{ codexArgs: ['--cd='] }, /directory/i],
    [{ session: '' }, /session/i],
    [{ session: 42 }, /session/i],
    [{ session: 'bad\0session' }, /NUL/i],
    [{ env: null }, /env.*object/i],
    [{ env: [] }, /env.*object/i],
    [{ env: { PATH: 42 } }, /env|PATH/i],
    [{ env: { PATH: 'bad\0path' } }, /NUL/i],
    [{ env: { 'BAD=KEY': 'value' } }, /env|name/i],
    [{ env: { '': 'value' } }, /env|name/i],
    [{ env: { VALUE: 'bad\0value' } }, /NUL/i],
  ];
  for (const [overrides, expected] of cases) {
    await assert.rejects(prepareCodex({ ...f.settings, ...overrides }), expected);
  }
  await assert.rejects(access(f.log), { code: 'ENOENT' });
});

test('invalid HUD preferences fail during preparation', posix, async (t) => {
  const f = await fixture(t);
  for (const [key, values] of Object.entries({
    preset: ['giant'], language: ['xx'], interval: [199, 60001, 500.5, '1000'],
    width: [0, 1001, 80.5], pathLevels: [0, 4, 1.5],
    color: ['false'], ascii: ['true'], git: [0], follow: ['true'], mouse: ['true', 1],
    configPath: ['', 123, 'bad\0path'],
  })) {
    for (const value of values) {
      await assert.rejects(prepareCodex({ ...f.settings, [key]: value }), new RegExp(`${key}|NUL`));
    }
  }
});

test('native Windows is rejected with WSL and watch guidance before preparing or spawning', async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  t.after(() => Object.defineProperty(process, 'platform', descriptor));
  await assert.rejects(prepareCodex(), /WSL.*codex-hud watch/s);
  await assert.rejects(createPty(), /WSL.*codex-hud watch/s);
  const result = await ptyAvailable();
  assert.equal(result.available, false);
  assert.match(result.error, /WSL.*codex-hud watch/s);
});

// Subscribe immediately, and keep all output so fast exits and split PTY reads
// are observable. Cleanup belongs to this test harness, not to the adapter.
async function observePty(t, options) {
  const pty = await createPty(options);
  const events = new EventEmitter();
  const messages = [];
  let pending = '';
  let output = '';
  let exit;
  let parseError;
  const dataListener = pty.onData(data => {
    output += data;
    pending += data;
    let newline;
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline).replace(/\r$/, '');
      pending = pending.slice(newline + 1);
      const marker = line.indexOf('PTY_TEST:');
      if (marker !== -1) {
        try { messages.push(JSON.parse(line.slice(marker + 'PTY_TEST:'.length))); }
        catch (error) { parseError = error; }
      }
    }
    events.emit('update');
  });
  const exitListener = pty.onExit(event => {
    exit = event;
    events.emit('update');
  });
  const waitFor = async predicate => {
    const signal = AbortSignal.timeout(5000);
    for (;;) {
      if (parseError) throw parseError;
      const result = predicate();
      if (result) return result;
      if (exit) throw new Error(`PTY exited before the expected output: ${JSON.stringify(exit)}\n${output}`);
      await once(events, 'update', { signal });
    }
  };
  t.after(async () => {
    try {
      if (!exit) {
        pty.kill('SIGKILL');
        await waitFor(() => exit);
      }
    } finally {
      dataListener.dispose();
      exitListener.dispose();
    }
  });
  return {
    pty, messages,
    message: type => waitFor(() => messages.find(message => message.type === type)),
    exited: () => waitFor(() => exit),
    waitFor,
  };
}

test('a real PTY supplies TTYs and exact dimensions, literal argv, cwd, environment, and UTF-8 output', posix, async (t) => {
  const f = await fixture(t);
  const codexArgs = Object.freeze([
    '', 'two words', "O'Brien", '"double"', '$(touch INJECTED)', '`touch INJECTED`',
    '; touch INJECTED; #', 'first\nsecond', 'trailing\\', '한글 🌱', '--', '*',
  ]);
  const prepared = await prepareCodex({ ...f.settings, codexArgs });
  const trace = await observePty(t, { ...prepared, cols: 93, rows: 17 });
  const ready = await trace.message('ready');
  assert.deepEqual(ready.tty, [true, true, true]);
  assert.equal(ready.cols, 93);
  assert.equal(ready.rows, 17);
  assert.deepEqual(ready.argv, codexArgs);
  assert.equal(ready.cwd, await import('node:fs/promises').then(fs => fs.realpath(f.settings.cwd)));
  assert.deepEqual(ready.env, {
    CODEX_HOME: f.settings.codexHome,
    CODEX_THREAD_ID: null,
    PATH: f.settings.env.PATH,
    TERM: 'xterm-256color',
    COLUMNS: null,
    LINES: null,
    CODEX_HUD_PTY_VALUE: f.settings.env.CODEX_HUD_PTY_VALUE,
  });
  const exit = await trace.exited();
  assert.equal(exit.exitCode, 23);
  assert.equal(exit.signal, 0);
  assert.equal((await trace.message('exit')).message, 'finished 한글 🌱');
  await assert.rejects(access(join(f.settings.cwd, 'INJECTED')), { code: 'ENOENT' });
});

test('the native PTY resizes the child and forwards raw keyboard input, paste, Ctrl+C, and Ctrl+D', posix, async (t) => {
  const f = await fixture(t);
  const prepared = await prepareCodex({
    ...f.settings, env: { ...f.settings.env, CODEX_HUD_PTY_MODE: 'raw' },
  });
  const trace = await observePty(t, { ...prepared, cols: 80, rows: 24 });
  await trace.message('ready');
  trace.pty.resize(51, 9);
  const resized = await trace.message('resize');
  assert.equal(resized.cols, 51);
  assert.equal(resized.rows, 9);
  assert.equal(trace.pty.cols, 51);
  assert.equal(trace.pty.rows, 9);
  const input = 'typing 한글 🌱\x1b[A\x1b[200~pasted\nline two\x1b[201~\x03';
  trace.pty.write(input);
  const received = () => Buffer.concat(trace.messages
    .filter(message => message.type === 'input')
    .map(message => Buffer.from(message.data, 'base64')));
  await trace.waitFor(() => received().length >= Buffer.byteLength(input));
  assert.deepEqual(received(), Buffer.from(input));
  trace.pty.write('\x04');
  assert.equal((await trace.exited()).exitCode, 23);
  assert.equal((await trace.message('exit')).message, 'finished 한글 🌱');
});

test('Ctrl+C reaches a cooked child as SIGINT and native exit signal metadata is preserved', posix, async (t) => {
  const f = await fixture(t);
  const prepared = await prepareCodex({
    ...f.settings, env: { ...f.settings.env, CODEX_HUD_PTY_MODE: 'signal' },
  });
  const trace = await observePty(t, { ...prepared, cols: 80, rows: 24 });
  await trace.message('ready');
  trace.pty.write('\x03');
  assert.equal((await trace.exited()).signal, 2);
});

test('createPty rejects invalid dimensions and unsafe spawn arguments before starting a child', posix, async (t) => {
  const f = await fixture(t);
  const options = {
    file: process.execPath, args: [fileURLToPath(childSource)],
    cwd: f.settings.cwd, env: f.settings.env, cols: 80, rows: 24,
  };
  for (const name of ['cols', 'rows']) {
    for (const value of [undefined, null, 0, -1, 1.5, '80', NaN, Infinity, 65536]) {
      await assert.rejects(createPty({ ...options, [name]: value }), new RegExp(name));
    }
  }
  for (const [overrides, message] of [
    [{ file: '' }, /file/i],
    [{ file: 'bad\0file' }, /NUL/i],
    [{ args: 'shell commands' }, /args.*array/i],
    [{ args: ['bad\0arg'] }, /NUL/i],
    [{ cwd: join(f.root, 'missing') }, /cwd.*directory/i],
    [{ env: null }, /env.*object/i],
  ]) await assert.rejects(createPty({ ...options, ...overrides }), message);
  await assert.rejects(access(f.log), { code: 'ENOENT' });
});

test('prepareCodex defaults to process.env without mutating it', posix, async (t) => {
  const f = await fixture(t);
  const keys = ['PATH', 'CODEX_HOME', 'CODEX_THREAD_ID', 'TERM', 'COLUMNS', 'LINES'];
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  for (const key of keys) process.env[key] = f.settings.env[key];
  const prepared = await prepareCodex({ cwd: f.settings.cwd, codexHome: f.settings.codexHome });
  assert.equal(prepared.file, join(f.bin, 'codex'));
  assert.equal(prepared.env.PATH, f.bin);
  assert.equal(prepared.env.CODEX_THREAD_ID, undefined);
  assert.equal(process.env.CODEX_THREAD_ID, 'stale-thread');
  assert.equal(process.env.LINES, '999');
});

test('ptyAvailable loads the installed native dependency without launching Codex', posix, async (t) => {
  const f = await fixture(t);
  const originalPath = process.env.PATH;
  const originalLog = process.env.CODEX_HUD_PTY_STARTED;
  process.env.PATH = f.bin;
  process.env.CODEX_HUD_PTY_STARTED = f.log;
  t.after(() => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalLog === undefined) delete process.env.CODEX_HUD_PTY_STARTED;
    else process.env.CODEX_HUD_PTY_STARTED = originalLog;
  });
  assert.deepEqual(await ptyAvailable(), { available: true });
  assert.deepEqual(await ptyAvailable(), { available: true });
  await assert.rejects(access(f.log), { code: 'ENOENT' });
});

for (const brokenNative of [false, true]) {
  test(`${brokenNative ? 'broken native addon' : 'missing dependency'} yields actionable diagnostics and leaves preparation usable`, posix, async (t) => {
    const f = await fixture(t);
    const isolated = join(f.root, 'isolated');
    const dependency = join(isolated, 'node_modules', 'node-pty');
    await mkdir(dependency, { recursive: true });
    await Promise.all([
      copyFile(new URL('../src/pty.js', import.meta.url), join(isolated, 'pty.js')),
      copyFile(new URL('../src/codex-args.js', import.meta.url), join(isolated, 'codex-args.js')),
      copyFile(new URL('../src/config.js', import.meta.url), join(isolated, 'config.js')),
      writeFile(join(isolated, 'package.json'), JSON.stringify({ type: 'module' })),
      writeFile(join(dependency, 'package.json'), JSON.stringify({ main: 'index.cjs' })),
    ]);
    if (brokenNative) {
      await writeFile(join(dependency, 'index.cjs'), 'throw new Error("native addon ABI mismatch fixture");\n');
    }
    const adapter = await import(pathToFileURL(join(isolated, 'pty.js')).href);
    const prepared = await adapter.prepareCodex(f.settings);
    assert.equal(prepared.file, join(f.bin, 'codex'));
    const status = await adapter.ptyAvailable();
    assert.equal(status.available, false);
    assert.match(status.error, /node-pty/);
    assert.match(status.error, /install/i);
    assert.match(status.error, /rebuild/i);
    if (brokenNative) assert.match(status.error, /native addon ABI mismatch fixture/);
    await assert.rejects(adapter.createPty({ ...prepared, cols: 80, rows: 24 }), error => {
      assert.match(error.message, /node-pty/);
      assert.match(error.message, /rebuild/i);
      assert.ok(error.cause instanceof Error);
      return true;
    });
    await assert.rejects(access(f.log), { code: 'ENOENT' });
  });
}
