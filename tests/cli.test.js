import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const exec = promisify(execFile);
const cli = resolve('bin/codex-hud.js');
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'codex-hud-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const codexHome = join(dir, 'codex');
  await mkdir(codexHome);
  return { cwd: dir, codexHome };
}
async function run(args, settings) {
  return exec(process.execPath, [settings.cli ?? cli, ...args], {
    cwd: settings.cwd,
    env: { ...process.env, CODEX_HOME: settings.codexHome, NO_COLOR: '1', ...settings.env },
    timeout: 5000,
  });
}

// Keep the CLI, configuration and rendering real. Only replace the interactive
// launch/probe boundaries so these tests need neither a terminal nor native code.
async function isolatedCli(t, modules = {}) {
  const settings = await fixture(t);
  const app = join(settings.cwd, 'app');
  await mkdir(app);
  await Promise.all([
    cp(resolve('src'), join(app, 'src'), {
      recursive: true,
      filter: path => !['inline.js', 'launch.js', 'pty.js'].includes(basename(path)),
    }),
    cp(resolve('bin'), join(app, 'bin'), { recursive: true }),
    cp(resolve('package.json'), join(app, 'package.json')),
  ]);
  await Promise.all(Object.entries(modules).map(([name, source]) =>
    writeFile(join(app, 'src', name), source)));
  return { ...settings, cli: join(app, 'bin', 'codex-hud.js') };
}

async function launchFixture(t) {
  return isolatedCli(t, {
    'inline.js': `
      export async function launchInline(settings) {
        await new Promise(resolve => setTimeout(resolve, 10));
        process.stdout.write(JSON.stringify({ backend: 'inline', settings }) + '\\n');
        return { exitCode: Number(process.env.CODEX_HUD_TEST_EXIT_CODE ?? 0), signal: 0 };
      }
    `,
    'launch.js': `
      export async function launch(settings) {
        process.stdout.write(JSON.stringify({ backend: 'tmux', settings }) + '\\n');
        return { sessionId: '$1', windowId: '@2', mainPaneId: '%3', hudPaneId: '%4' };
      }
    `,
  });
}

test('offline demo renders a real HUD and can produce a parseable JSON snapshot', async t => {
  const settings = await fixture(t);
  const plain = await run(['demo'], settings);
  assert.match(plain.stdout, /Context|컨텍스트/);
  assert.doesNotMatch(plain.stdout, /\x1b/);
  const { stdout } = await run(['demo', '--json'], settings);
  const state = JSON.parse(stdout);
  assert.equal(state.context.percent, 42);
  assert.equal(state.plan.length, 3);
});

test('status consumes an actual local rollout and emits only normalized metadata', async t => {
  const settings = await fixture(t);
  const path = join(settings.cwd, 'rollout.jsonl');
  await writeFile(path, [
    { type: 'session_meta', payload: { id: 'example', cwd: settings.cwd, base_instructions: { text: 'PRIVATE_TEXT' } } },
    { type: 'turn_context', payload: { model: 'gpt-5', effort: 'high', approval_policy: 'on-request', approvals_reviewer: 'auto_review' } },
    { type: 'event_msg', payload: { type: 'token_count', info: { model_context_window: 1000, last_token_usage: { total_tokens: 100 }, total_token_usage: { total_tokens: 9000 } } } },
    { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'skill-read', arguments: '{"cmd":"cat /skills/brainstorming/SKILL.md"}' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'skill-read', output: 'Process exited with code 0\nOutput:\nPRIVATE_SKILL_BODY' } },
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
  const { stdout } = await run(['status', '--session', path, '--json'], settings);
  const state = JSON.parse(stdout);
  assert.equal(state.context.percent, 10);
  assert.equal(state.tokens.total, 9000);
  assert.equal(state.session.approvalPolicy, 'on-request');
  assert.equal(state.session.approvalsReviewer, 'auto_review');
  assert.deepEqual(state.skills.map(skill => skill.name), ['brainstorming']);
  assert.doesNotMatch(stdout, /PRIVATE_TEXT/);
  assert.doesNotMatch(stdout, /PRIVATE_SKILL_BODY/);
  const plain = await run(['status', '--session', path, '--language', 'ko', '--no-color'], settings);
  assert.match(plain.stdout, /승인 auto-review \(on-request\)/);
  assert.match(plain.stdout, /^로드한 스킬 1 · brainstorming$/m);
  assert.doesNotMatch(plain.stdout, /PRIVATE_/);
});

test('status exposes plugin usage from a rollout in both JSON and Korean HUD output', async t => {
  const settings = await fixture(t);
  const path = join(settings.cwd, 'rollout.jsonl');
  await writeFile(path, [
    { type: 'session_meta', payload: { id: 'plugin-example', cwd: settings.cwd } },
    { type: 'response_item', payload: {
      type: 'function_call', name: 'read_file', call_id: 'plugin-read',
      arguments: JSON.stringify({
        path: '/custom/codex/plugins/cache/personal/review-kit/1.2.0/skills/review/SKILL.md',
      }),
    } },
    { type: 'response_item', payload: {
      type: 'function_call_output', call_id: 'plugin-read', output: 'PRIVATE_PLUGIN_BODY',
    } },
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
  const { stdout } = await run(['status', '--session', path, '--json', '--no-git'], settings);
  const state = JSON.parse(stdout);
  assert.deepEqual(state.plugins?.map(({ name, version, marketplace }) => ({ name, version, marketplace })), [
    { name: 'review-kit', version: '1.2.0', marketplace: 'personal' },
  ]);
  assert.doesNotMatch(stdout, /PRIVATE_PLUGIN_BODY/);
  const plain = await run(['status', '--session', path, '--language', 'ko', '--no-color', '--no-git'], settings);
  assert.match(plain.stdout, /사용한 플러그인 1\n.*review-kit v1\.2\.0.*personal/);
  assert.doesNotMatch(plain.stdout, /PRIVATE_PLUGIN_BODY/);
});

test('status displays the session project Git changes and labelled elapsed time, honoring no-git', async t => {
  const settings = await fixture(t);
  const project = join(settings.cwd, 'working-project');
  await exec('git', ['init', '-b', 'hud-test', project]);
  await writeFile(join(project, 'staged.txt'), 'staged\n');
  await exec('git', ['-C', project, 'add', 'staged.txt']);
  await writeFile(join(project, 'untracked.txt'), 'untracked\n');
  const path = join(settings.cwd, 'rollout.jsonl');
  await writeFile(path, [
    { type: 'session_meta', payload: {
      id: 'git-session', cwd: project, timestamp: '2026-09-13T04:00:00Z',
    } },
    { type: 'turn_context', payload: { model: 'test-model' } },
    { type: 'event_msg', timestamp: '2026-09-13T04:12:34Z', payload: { type: 'task_complete' } },
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
  const args = ['status', '--session', path, '--language', 'ko', '--no-color', '--width', '220'];
  const { stdout } = await run(args, settings);
  assert.match(stdout.split('\n')[0], /working-project \[Git hud-test\* 변경 1 미추적 1\]/);
  assert.match(stdout, /세션 12분 34초/);
  assert.doesNotMatch(stdout, /세션 0초/);
  const withoutGit = await run([...args, '--no-git'], settings);
  assert.doesNotMatch(withoutGit.stdout, /\[Git /);
  assert.match(withoutGit.stdout, /working-project/);
  assert.match(withoutGit.stdout, /세션 12분 34초/);
});

test('redirected watch prints once and exits instead of hanging a pipe', async t => {
  const settings = await fixture(t);
  const { stdout } = await run(['watch'], settings);
  assert.match(stdout, /waiting|세션|대기/i);
  assert.doesNotMatch(stdout, /\x1b/);
});

test('setup prints a native status-line snippet without rewriting user preferences', async t => {
  const settings = await fixture(t);
  const config = join(settings.codexHome, 'config.toml');
  await writeFile(config, '# untouched\nmodel = "my-model"\n');
  const { stdout } = await run(['setup'], settings);
  assert.match(stdout, /\[tui\]/);
  assert.match(stdout, /status_line/);
  assert.match(stdout, /model-with-reasoning/);
  assert.equal(await readFile(config, 'utf8'), '# untouched\nmodel = "my-model"\n');
});

test('invalid arguments fail early and missing explicit sessions do not silently fall back', async t => {
  const settings = await fixture(t);
  for (const args of [['unknown'], ['status', '--interval', '-1'], ['demo', '--preset', 'wrong'], ['status', '--width', 'NaN'], ['status', '--session', 'missing.jsonl']]) {
    await assert.rejects(run(args, settings), error => {
      assert.equal(error.code, 1);
      assert.ok(error.stderr.trim().length > 0);
      assert.doesNotMatch(error.stderr, /at file:|node:internal/);
      return true;
    });
  }
});

test('help and version work even if user preferences are invalid', async t => {
  const settings = await fixture(t);
  await writeFile(join(settings.codexHome, 'codex-hud.json'), '{bad');
  assert.match((await run(['--help'], settings)).stdout, /codex-hud start/);
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal((await run(['--version'], settings)).stdout, `${pkg.version}\n`);
});

test('start defaults to inline with the full HUD and no Codex arguments', async t => {
  const settings = await launchFixture(t);
  const { stdout, stderr } = await run(['start'], settings);
  const result = JSON.parse(stdout);
  assert.equal(result.backend, 'inline');
  assert.equal(result.settings.preset, 'full');
  assert.equal(result.settings.mouse, false);
  assert.equal(result.settings.cwd, settings.cwd);
  assert.equal(result.settings.codexHome, settings.codexHome);
  assert.deepEqual(result.settings.codexArgs, []);
  assert.equal(stderr, '');
});

for (const [backend, flags] of [['inline', []], ['tmux', ['--tmux']]]) {
  test(`start ${backend} receives resolved preferences and literal Codex arguments`, async t => {
    const settings = await launchFixture(t);
    await mkdir(join(settings.cwd, 'chosen home'));
    await mkdir(join(settings.cwd, 'my project'));
    await writeFile(join(settings.codexHome, 'codex-hud.json'), '{invalid inherited config');
    await writeFile(join(settings.cwd, 'hud preferences.json'), JSON.stringify({
      preset: 'minimal', language: 'en', interval: 800, width: 91, pathLevels: 2,
      color: true, ascii: false, git: true, mouse: false,
    }));
    const { stdout, stderr } = await run([
      'start', ...flags, '--cwd', 'my project', '--codex-home', 'chosen home',
      '--config', 'hud preferences.json', '--preset', 'essential', '--language', 'ko',
      '--interval', '750', '--ascii', '--no-color', '--no-git', '--follow', '--mouse',
      '--session', 'rollout with spaces.jsonl', '--since', '1234',
      '--', 'resume', '--cd', 'another project', '--', '--tmux', '--json', '--once',
      "literal ' $(touch INJECTED);\nprompt",
    ], settings);
    const result = JSON.parse(stdout);
    assert.equal(result.backend, backend);
    assert.deepEqual(result.settings, {
      preset: 'essential', language: 'ko', interval: 750, width: 91, pathLevels: 2,
      color: false, ascii: true, git: false, mouse: true,
      cwd: join(settings.cwd, 'my project'), codexHome: join(settings.cwd, 'chosen home'),
      configPath: join(settings.cwd, 'hud preferences.json'),
      session: 'rollout with spaces.jsonl', follow: true, since: 1234,
      codexArgs: [
        'resume', '--cd', 'another project', '--', '--tmux', '--json', '--once',
        "literal ' $(touch INJECTED);\nprompt",
      ],
      ...(backend === 'tmux' ? { cliPath: settings.cli } : {}),
    });
    assert.equal(stderr, '');
  });

  test(`start ${backend} can restore native dragging over a saved mouse preference`, async t => {
    const settings = await launchFixture(t);
    await writeFile(join(settings.codexHome, 'codex-hud.json'), '{"mouse":true}');
    const enabled = JSON.parse((await run(['start', ...flags], settings)).stdout);
    assert.equal(enabled.settings.mouse, true);
    const disabled = JSON.parse((await run(['start', ...flags, '--no-mouse'], settings)).stdout);
    assert.equal(disabled.settings.mouse, false);
    assert.deepEqual(disabled.settings.codexArgs, []);
  });
}

for (const exitCode of [23, 130]) {
  test(`inline start preserves the child exit code ${exitCode}`, async t => {
    const settings = await launchFixture(t);
    settings.env = { CODEX_HUD_TEST_EXIT_CODE: String(exitCode) };
    await assert.rejects(run(['start'], settings), error => {
      assert.equal(error.code, exitCode);
      assert.equal(JSON.parse(error.stdout).backend, 'inline');
      assert.equal(error.stderr, '');
      return true;
    });
  });
}

test('--tmux is accepted only by start, including the implicit watch command', async t => {
  const settings = await isolatedCli(t);
  for (const args of [
    ['--tmux'], ['watch', '--tmux'], ['status', '--tmux'],
    ['demo', '--tmux'], ['setup', '--tmux'], ['doctor', '--tmux'],
  ]) {
    await assert.rejects(run(args, settings), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /--tmux.*(only|supported).*start/i);
      assert.equal(error.stdout, '');
      assert.doesNotMatch(error.stderr, /at file:|node:internal/);
      return true;
    });
  }
});

test('start rejects snapshot flags before loading either backend or user preferences', async t => {
  const settings = await isolatedCli(t);
  await writeFile(join(settings.codexHome, 'codex-hud.json'), '{invalid');
  for (const backend of [[], ['--tmux']]) {
    for (const flag of ['--json', '--once']) {
      await assert.rejects(run(['start', ...backend, flag], settings), error => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, new RegExp(`${flag}.*(not supported|only).*start`, 'i'));
        assert.equal(error.stdout, '');
        return true;
      });
    }
  }
});

test('monitor, demo, setup, help and version work when launch modules are absent', async t => {
  const settings = await isolatedCli(t);
  for (const args of [[], ['watch', '--once'], ['status'], ['demo'], ['setup'], ['--help'], ['--version']]) {
    const { stdout, stderr } = await run(args, settings);
    assert.ok(stdout.trim().length > 0, `${args.join(' ') || 'default command'} should produce output`);
    assert.equal(stderr, '');
  }
});

test('both start backends explain the interactive terminal requirement when redirected', async t => {
  const settings = await fixture(t);
  for (const args of [['start'], ['start', '--tmux']]) {
    await assert.rejects(run(args, settings), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /interactive.*TTY|interactive terminal/i);
      assert.doesNotMatch(error.stderr, /at file:|node:internal|\x1b/);
      assert.equal(error.stdout, '');
      return true;
    });
  }
});

test('doctor checks installed inline PTY support without Codex or tmux on PATH', async t => {
  const settings = await fixture(t);
  const emptyBin = join(settings.cwd, 'empty-bin');
  await mkdir(emptyBin);
  settings.env = { PATH: emptyBin };
  const { stdout, stderr } = await run(['doctor', '--json'], settings);
  const report = JSON.parse(stdout);
  assert.equal(report.inline.available, process.platform !== 'win32');
  if (process.platform === 'win32') assert.match(report.inline.error, /WSL.*watch/s);
  assert.equal(report.codex, null);
  assert.equal(report.tmux, null);
  assert.equal(stderr, '');
});

test('doctor reports inline availability and optional tmux in JSON and text', async t => {
  const settings = await isolatedCli(t, {
    'pty.js': 'export async function ptyAvailable() { return { available: true }; }',
  });
  const emptyBin = join(settings.cwd, 'empty-bin');
  await mkdir(emptyBin);
  settings.env = { PATH: emptyBin };
  const report = JSON.parse((await run(['doctor', '--json'], settings)).stdout);
  assert.deepEqual(report.inline, { available: true });
  assert.equal(report.node, process.version);
  assert.equal(report.codex, null);
  assert.equal(report.tmux, null);
  assert.equal(report.codexHome, settings.codexHome);
  assert.equal(report.sessionsDirectory, false);
  assert.equal(report.matchingSession, null);

  const { stdout, stderr } = await run(['doctor'], settings);
  assert.match(stdout, /inline.*available/i);
  assert.match(stdout, /tmux.*optional.*start --tmux/i);
  assert.match(stdout, /Codex.*not found/i);
  assert.equal(stderr, '');
});

for (const mode of ['unavailable', 'throws']) {
  test(`doctor retains other diagnostics when the PTY probe ${mode}`, async t => {
    const settings = await isolatedCli(t, {
      'pty.js': mode === 'unavailable'
        ? `export async function ptyAvailable() {
            return { available: false, error: '\\x1b[31mnode-pty native binding missing\\x1b[0m' };
          }`
        : `export async function ptyAvailable() {
            throw new Error('node-pty native binding missing');
          }`,
    });
    const emptyBin = join(settings.cwd, 'empty-bin');
    await mkdir(emptyBin);
    settings.env = { PATH: emptyBin };
    const report = JSON.parse((await run(['doctor', '--json'], settings)).stdout);
    assert.equal(report.inline.available, false);
    assert.match(report.inline.error, /node-pty native binding missing/);
    assert.equal(report.tmux, null);
    assert.equal(report.codexHome, settings.codexHome);

    const { stdout, stderr } = await run(['doctor'], settings);
    assert.match(stdout, /inline.*unavailable/i);
    assert.match(stdout, /node-pty native binding missing/);
    assert.match(stdout, /watch|WSL|reinstall|build tools/i);
    assert.match(stdout, /tmux.*optional/i);
    assert.doesNotMatch(stdout, /\x1b/);
    assert.equal(stderr, '');
  });
}

test('doctor preserves PTY spawn/helper diagnostics and probes the requested working directory', async t => {
  const settings = await isolatedCli(t, {
    'pty.js': `export async function ptyAvailable(options = {}) {
      return {
        available: false, platform: 'darwin', arch: 'arm64', cwd: options.cwd ?? null,
        probe: { status: 'helper-unavailable', timeoutMs: 2000 },
        helper: { path: '/hud/node-pty/spawn-helper', status: 'not-executable', mode: '0664',
          repairCommand: ['/node', '/hud/src/repair-node-pty.js'] },
        error: 'Native helper cannot execute',
      };
    }`,
  });
  const project = join(settings.cwd, 'selected-project');
  const emptyBin = join(settings.cwd, 'empty-bin');
  await Promise.all([project, emptyBin].map(path => mkdir(path)));
  settings.env = { PATH: emptyBin };
  const report = JSON.parse((await run(['doctor', '--cwd', project, '--json'], settings)).stdout);
  assert.equal(report.inline.available, false);
  assert.equal(report.inline.cwd, project);
  assert.equal(report.inline.probe.status, 'helper-unavailable');
  assert.equal(report.inline.helper.mode, '0664');
  assert.deepEqual(report.inline.helper.repairCommand, ['/node', '/hud/src/repair-node-pty.js']);
  const text = (await run(['doctor', '--cwd', project], settings)).stdout;
  assert.match(text, /helper-unavailable/);
  assert.match(text, /\/hud\/node-pty\/spawn-helper/);
});
