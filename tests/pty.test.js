import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { constants } from 'node:fs';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPty, prepareCodex, ptyAvailable } from '../src/pty.js';
import { findSession } from '../src/sessions.js';

const childSource = new URL('./fixtures/pty-child.cjs', import.meta.url);
const posix = { skip: process.platform === 'win32' ? 'Inline PTYs require POSIX' : false };

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codex-hud-pty-')));
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

test('ptyAvailable probes the installed native dependency without launching Codex', posix, async (t) => {
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
  for (let i = 0; i < 2; i++) {
    const status = await ptyAvailable();
    assert.equal(status.available, true, status.error);
    assert.equal(status.probe.status, 'ok');
    assert.equal(status.probe.exitCode, 0);
  }
  await assert.rejects(access(f.log), { code: 'ENOENT' });
});

async function isolatedAdapter(t, source, setup = async () => {}) {
  const f = await fixture(t);
  const isolated = join(f.root, 'isolated');
  const dependency = join(isolated, 'node_modules', 'node-pty');
  await mkdir(dependency, { recursive: true });
  await Promise.all([
    ...['pty.js', 'codex-args.js', 'config.js', 'repair-node-pty.js'].map(name =>
      copyFile(new URL(`../src/${name}`, import.meta.url), join(isolated, name))),
    writeFile(join(isolated, 'package.json'), JSON.stringify({ type: 'module' })),
    writeFile(join(dependency, 'package.json'), JSON.stringify({ name: 'node-pty', main: 'index.cjs' })),
    writeFile(join(dependency, 'index.cjs'), source),
  ]);
  await setup(dependency);
  const adapter = await import(pathToFileURL(join(isolated, 'pty.js')).href);
  const native = (await import(pathToFileURL(join(dependency, 'index.cjs')).href)).default;
  return { ...f, adapter, native, dependency };
}

// Only the native boundary is substituted; the adapter owns subscriptions,
// timeout, error classification and cleanup just as it does with node-pty.
function probeNative(action) {
  return `
const { EventEmitter } = require('node:events');
const state = { calls: [], kills: [], destroyed: false };
exports.state = state;
exports.spawn = (file, args, options) => {
  state.calls.push({ file, args, options });
  const child = state.child = new EventEmitter();
  for (const [method, event] of [['onData', 'data'], ['onExit', 'exit']]) {
    child[method] = callback => {
      child.on(event, callback);
      return { dispose: () => child.removeListener(event, callback) };
    };
  }
  child.kill = signal => { state.kills.push(signal); };
  child.destroy = () => { state.destroyed = true; };
  child.resume = () => {};
  ${action}
  return child;
};
`;
}

function trackProbeTimers(t) {
  const pending = new Set();
  const schedule = globalThis.setTimeout;
  const cancel = globalThis.clearTimeout;
  t.mock.method(globalThis, 'setTimeout', (...args) => {
    const timer = schedule(...args);
    pending.add(timer);
    return timer;
  });
  t.mock.method(globalThis, 'clearTimeout', timer => {
    pending.delete(timer);
    cancel(timer);
  });
  t.after(() => { for (const timer of pending) cancel(timer); });
  return pending;
}

function assertProbeReleased(state, timers) {
  for (const event of ['data', 'exit', 'error']) {
    assert.equal(state.child.listenerCount(event), 0, `${event} listener leaked`);
  }
  assert.equal(timers.size, 0, 'probe timer leaked');
}

test('ptyAvailable rejects an importable dependency when native spawning fails', posix, async t => {
  const f = await isolatedAdapter(t, `exports.spawn = () => { throw new Error('posix_spawnp failed.'); };`);
  const timers = trackProbeTimers(t);
  const status = await f.adapter.ptyAvailable({ cwd: f.settings.cwd });
  assert.equal(status.available, false);
  assert.equal(status.probe.status, 'spawn-failed');
  assert.equal(status.executable, process.execPath);
  assert.equal(status.cwd, f.settings.cwd);
  assert.equal(status.platform, process.platform);
  assert.equal(status.arch, process.arch);
  assert.match(status.error, /posix_spawnp failed/);
  assert.match(status.error, /codex-hud doctor/);
  assert.equal(timers.size, 0);
  await assert.rejects(access(f.log), { code: 'ENOENT' });
});

test('ptyAvailable waits for a successful exit, drains output and releases its listeners and timer', posix, async t => {
  const f = await isolatedAdapter(t, probeNative(`
  queueMicrotask(() => {
    // A producer cannot finish a large write if nobody drains its PTY output.
    if (!child.listenerCount('data')) return;
    child.emit('data', 'probe output\\r\\n'.repeat(10_000));
    child.emit('exit', { exitCode: 0, signal: 0 });
  });`));
  const timers = trackProbeTimers(t);
  const status = await f.adapter.ptyAvailable({ cwd: f.settings.cwd, timeoutMs: 100 });
  assert.equal(status.available, true);
  assert.equal(status.probe.status, 'ok');
  assert.equal(status.probe.exitCode, 0);
  const { state } = f.native;
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].file, process.execPath);
  assert.equal(state.calls[0].options.cwd, f.settings.cwd);
  assert.equal(state.calls[0].options.env.NODE_OPTIONS, undefined);
  assert.equal(state.calls[0].options.env.CODEX_HUD_PTY_STARTED, undefined);
  assert.deepEqual(state.kills, []);
  assertProbeReleased(state, timers);
});

for (const event of [{ exitCode: 1, signal: 0 }, { exitCode: 0, signal: 9 }]) {
  test(`ptyAvailable rejects unsuccessful probe exit ${JSON.stringify(event)}`, posix, async t => {
    const f = await isolatedAdapter(t, probeNative(`
    queueMicrotask(() => child.emit('exit', ${JSON.stringify(event)}));`));
    const timers = trackProbeTimers(t);
    const status = await f.adapter.ptyAvailable();
    assert.equal(status.available, false);
    assert.equal(status.probe.status, 'exit-failed');
    assert.equal(status.probe.exitCode, event.exitCode);
    assert.equal(status.probe.signal, event.signal);
    assert.deepEqual(f.native.state.kills, []);
    assertProbeReleased(f.native.state, timers);
  });
}

test('ptyAvailable bounds a hung probe and kills and releases it on timeout', { ...posix, timeout: 2000 }, async t => {
  const f = await isolatedAdapter(t, probeNative(''));
  const timers = trackProbeTimers(t);
  const status = await f.adapter.ptyAvailable({ timeoutMs: 25 });
  assert.equal(status.available, false);
  assert.equal(status.probe.status, 'timeout');
  assert.equal(status.probe.timeoutMs, 25);
  assert.deepEqual(f.native.state.kills, ['SIGKILL']);
  assert.equal(f.native.state.destroyed, true);
  assertProbeReleased(f.native.state, timers);
});

test('a timed-out native probe terminates its real harmless child', { ...posix, timeout: 3000 }, async t => {
  const require = createRequire(import.meta.url);
  const f = await isolatedAdapter(t, `
const native = require(${JSON.stringify(require.resolve('node-pty'))});
const state = exports.state = {};
exports.spawn = (file, args, options) => {
  const child = state.child = native.spawn(file, ['--eval', 'setInterval(() => {}, 1000)'], options);
  state.exited = new Promise(resolve => {
    const listener = child.onExit(event => { state.done = true; listener.dispose(); resolve(event); });
  });
  return child;
};`);
  t.after(() => { if (!f.native.state.done) f.native.state.child?.kill('SIGKILL'); });
  const status = await f.adapter.ptyAvailable({ timeoutMs: 50 });
  assert.equal(status.available, false);
  assert.equal(status.probe.status, 'timeout');
  const exit = await f.native.state.exited;
  assert.equal(exit.signal, 9);
  assert.throws(() => process.kill(f.native.state.child.pid, 0), { code: 'ESRCH' });
});

test('ptyAvailable handles asynchronous native errors and cleans up the live probe', posix, async t => {
  const f = await isolatedAdapter(t, probeNative(`
  queueMicrotask(() => child.emit('error', Object.assign(new Error('PTY read failed'), { code: 'EBADF' })));`));
  const timers = trackProbeTimers(t);
  const status = await f.adapter.ptyAvailable();
  assert.equal(status.available, false);
  assert.equal(status.probe.status, 'spawn-failed');
  assert.deepEqual(f.native.state.kills, ['SIGKILL']);
  assert.equal(f.native.state.destroyed, true);
  assertProbeReleased(f.native.state, timers);
});

test('ptyAvailable accepts node-pty EAGAIN reads and EIO closure only after a successful exit', posix, async t => {
  const f = await isolatedAdapter(t, probeNative(`
  queueMicrotask(() => {
    child.emit('error', Object.assign(new Error('read EAGAIN'), { code: 'EAGAIN' }));
    child.emit('error', Object.assign(new Error('read EIO'), { code: 'EIO' }));
    child.emit('exit', { exitCode: 0, signal: 0 });
  });`));
  const status = await f.adapter.ptyAvailable();
  assert.equal(status.available, true);
  assert.equal(status.probe.exitCode, 0);
  assert.deepEqual(f.native.state.kills, []);
});

test('createPty wraps native spawn failures with safe invocation context and remediation', posix, async t => {
  const prompt = 'PRIVATE PROMPT WITH CREDENTIALS';
  const f = await isolatedAdapter(t, `exports.spawn = () => {
    throw new Error(${JSON.stringify(`posix_spawnp failed. ${prompt}`)});
  };`);
  await assert.rejects(f.adapter.createPty({
    file: process.execPath, args: ['-e', prompt], cwd: f.settings.cwd, cols: 80, rows: 24,
  }), error => {
    assert.equal(error.code, 'ERR_PTY_SPAWN');
    assert.equal(error.diagnostics.executable, process.execPath);
    assert.equal(error.diagnostics.cwd, f.settings.cwd);
    assert.equal(error.diagnostics.platform, process.platform);
    assert.equal(error.diagnostics.arch, process.arch);
    assert.ok(error.message.includes(process.execPath));
    assert.ok(error.message.includes(f.settings.cwd));
    assert.match(error.message, /codex-hud doctor/);
    assert.match(error.message, /rebuild|reinstall/i);
    assert.equal(error.message.includes(prompt), false);
    assert.equal(JSON.stringify(error.diagnostics).includes(prompt), false);
    assert.ok(error.cause instanceof Error);
    return true;
  });
});

for (const { arch, layout, mode, expected } of [
  { arch: 'arm64', layout: 'build/Release', mode: 0o664, expected: 'not-executable' },
  { arch: 'x64', layout: 'build/Debug', mode: null, expected: 'missing' },
  { arch: 'arm64', layout: 'prebuilds/darwin-arm64', mode: 0o664, expected: 'not-executable' },
  { arch: 'x64', layout: 'prebuilds/darwin-x64', mode: 0o755, expected: 'executable' },
]) {
  test(`macOS probe inspects the selected ${layout} helper (${expected}) without changing it`, posix, async t => {
    const require = createRequire(import.meta.url);
    const utilsPath = require.resolve('node-pty/lib/utils.js');
    const hostAddon = resolve(dirname(utilsPath), require(utilsPath).loadNativeModule('pty').dir, 'pty.node');
    const f = await isolatedAdapter(t, probeNative(`
    queueMicrotask(() => child.emit('exit', { exitCode: 0, signal: 0 }));`)
      + "\nrequire('./lib/utils.js').loadNativeModule('pty');\n", async dependency => {
      await mkdir(join(dependency, 'lib'));
      await mkdir(join(dependency, layout), { recursive: true });
      await Promise.all([
        copyFile(utilsPath, join(dependency, 'lib', 'utils.js')),
        // Resolution uses this directory just like node-pty's UnixTerminal.
        writeFile(join(dependency, 'lib', 'unixTerminal.js'), ''),
        copyFile(hostAddon, join(dependency, layout, 'pty.node')),
      ]);
      if (layout !== 'build/Release') {
        await mkdir(join(dependency, 'build', 'Release'), { recursive: true });
        // An existing but unloadable addon/helper must not mask the chosen one.
        await writeFile(join(dependency, 'build', 'Release', 'pty.node'), 'invalid native addon');
        await writeFile(join(dependency, 'build', 'Release', 'spawn-helper'), 'decoy', { mode: 0o755 });
      }
      if (mode !== null) {
        const helper = join(dependency, layout, 'spawn-helper');
        await writeFile(helper, 'fixture helper');
        await chmod(helper, mode);
      }
      for (const [key, value] of Object.entries({ platform: 'darwin', arch })) {
        const descriptor = Object.getOwnPropertyDescriptor(process, key);
        Object.defineProperty(process, key, { value });
        t.after(() => Object.defineProperty(process, key, descriptor));
      }
    });
    const helperPath = join(f.dependency, layout, 'spawn-helper');
    const before = mode === null ? null : await stat(helperPath);
    const status = await f.adapter.ptyAvailable();
    assert.equal(status.helper?.path, helperPath);
    assert.equal(status.helper.status, expected);
    assert.equal(status.available, expected === 'executable', status.error);
    assert.equal(f.native.state.calls.length, expected === 'executable' ? 1 : 0);
    if (expected !== 'executable') {
      assert.equal(status.probe.status, 'helper-unavailable');
      assert.ok(status.error.includes(helperPath));
      if (expected === 'not-executable') {
        assert.equal(status.helper.mode, '0664');
        assert.equal(status.helper.repairCommand[0], process.execPath);
        assert.match(status.error, /ignore-scripts/);
      }
      await assert.rejects(f.adapter.createPty({
        file: process.execPath, cwd: f.settings.cwd, cols: 80, rows: 24,
      }), error => {
        assert.equal(error.diagnostics.helper.path, helperPath);
        assert.equal(error.diagnostics.helper.status, expected);
        assert.ok(error.message.includes(helperPath));
        return true;
      });
    }
    if (before) {
      const after = await stat(helperPath);
      assert.equal(after.mode, before.mode);
      assert.equal(after.ctimeMs, before.ctimeMs);
    } else {
      await assert.rejects(access(helperPath), { code: 'ENOENT' });
    }
  });
}

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
      copyFile(new URL('../src/repair-node-pty.js', import.meta.url), join(isolated, 'repair-node-pty.js')),
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
