import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const exec = promisify(execFile);
const posix = { skip: process.platform === 'win32' ? 'Managed shell installations require POSIX' : false };

async function fixture(t, { installed = true, managed = true, scope = 'user',
  autostart = false, version = '0.6.0' } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'hud-doctor-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "project ' 한글");
  const prefix = installed ? join(scope === 'project' ? project : root, 'custom hud') : null;
  const packageRoot = prefix ? join(prefix, 'lib', 'node_modules', 'my-codex-hud') : join(root, 'source');
  const codexHome = join(root, 'codex');
  const tools = join(root, 'tools');
  await Promise.all([packageRoot, codexHome, tools, project].map(path => mkdir(path, { recursive: true })));
  await Promise.all([
    cp(resolve('src'), join(packageRoot, 'src'), { recursive: true }),
    cp(resolve('bin'), join(packageRoot, 'bin'), { recursive: true }),
  ]);
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ ...pkg, version }));
  // Only the native probe is replaced. CLI, install discovery and filesystem reads stay real.
  await writeFile(join(packageRoot, 'src', 'pty.js'),
    'export async function ptyAvailable() { return { available: true }; }\n');
  let command = join(packageRoot, 'bin', 'codex-hud.js');
  let stateFile = null;
  let shellFile = null;
  if (prefix) {
    await mkdir(join(prefix, 'bin'));
    const link = join(prefix, 'bin', 'codex-hud');
    await symlink(command, link);
    command = link;
    shellFile = join(prefix, 'shell.sh');
    stateFile = join(prefix, 'install-state.json');
    if (managed) {
      await writeFile(shellFile, '# Managed by codex-hud-install.\n'
        + `# scope: ${scope}\n# language: en\n`
        + (autostart ? '# codex-hud autostart enabled\n' : ''));
      await writeFile(stateFile, JSON.stringify({
        schemaVersion: 1, owner: 'codex-hud-install', version, scope,
        project: scope === 'project' ? project : null, prefix, command, shellFile,
        startupFiles: [], shell: 'none', language: 'en', autostart,
      }));
    }
  }
  const env = { ...process.env, CODEX_HOME: codexHome, PATH: tools, NO_COLOR: '1' };
  const run = args => exec(process.execPath, [command, ...args], {
    cwd: project, env,
    timeout: 5000,
  });
  const doctor = async (args = []) => JSON.parse((await run(['doctor', '--json', ...args])).stdout);
  return { root, project, prefix, packageRoot, codexHome, tools, command, shellFile, stateFile, env, run, doctor };
}

async function bundle(path, version) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({
    name: 'my-codex-hud', version, file: `my-codex-hud-${version}.tgz`, sha256: '0'.repeat(64),
  }));
  return path;
}

async function plugins(f, entries) {
  await writeFile(join(f.tools, 'codex'), `#!${process.execPath}
const args = process.argv.slice(2);
if (JSON.stringify(args) === '["--version"]') console.log('codex-cli 0.test');
else if (JSON.stringify(args) === '["plugin","list","--json"]') {
  require('node:fs').writeFileSync(${JSON.stringify(join(f.root, 'probe-home'))}, process.env.CODEX_HOME);
  console.log(${JSON.stringify(JSON.stringify({ installed: entries, available: [] }))});
} else process.exitCode = 2;
`, { mode: 0o755 });
}

function plugin(marketplaceName, version = '1.0.0', enabled = true) {
  return {
    pluginId: `codex-hud@${marketplaceName}`, name: 'codex-hud', marketplaceName,
    version, installed: true, enabled, source: { source: 'local', path: '/unused/source' },
    installPolicy: 'AVAILABLE', authPolicy: 'ON_INSTALL',
  };
}

function cachedBundle(codexHome, entry) {
  return join(codexHome, 'plugins', 'cache', entry.marketplaceName, 'codex-hud', entry.version,
    'skills', 'codex-hud-install', 'assets', 'package.json');
}

test('doctor identifies the running source copy without inventing an installation or active shell', async t => {
  const f = await fixture(t, { installed: false });
  const report = await f.doctor();
  assert.equal(report.hud?.version, '0.6.0');
  assert.equal(report.hud.packageRoot, f.packageRoot);
  assert.equal(report.hud.command, f.command);
  assert.equal(report.hud.prefix, null);
  assert.equal(report.hud.scope, null);
  assert.deepEqual(report.hud.autostart, { configured: null, active: null });
  assert.equal(report.stages.hud, 'source');
  assert.equal(report.plugin.status, 'unknown');
  assert.equal(report.bundle.comparison, 'unknown');
});

test('doctor reports a managed custom project installation and configured autostart without writes', posix, async t => {
  const f = await fixture(t, { scope: 'project', autostart: true });
  const before = await Promise.all([f.stateFile, f.shellFile].map(async path =>
    [await readFile(path, 'utf8'), (await stat(path)).mtimeMs]));
  const report = await f.doctor();
  assert.equal(report.hud?.version, '0.6.0');
  assert.equal(report.hud.command, f.command);
  assert.equal(report.hud.prefix, f.prefix);
  assert.equal(report.hud.scope, 'project');
  assert.equal(report.hud.project, f.project);
  assert.equal(report.hud.language, 'en');
  assert.equal(report.hud.shellFile, f.shellFile);
  assert.deepEqual(report.hud.autostart, { configured: true, active: null });
  assert.equal(report.stages.hud, 'installed');
  assert.equal(report.stages.autostart, 'configured');
  assert.deepEqual(await Promise.all([f.stateFile, f.shellFile].map(async path =>
    [await readFile(path, 'utf8'), (await stat(path)).mtimeMs])), before);
  const text = (await f.run(['doctor'])).stdout;
  assert.match(text, /HUD.*0\.6\.0/);
  assert.ok(text.includes(f.prefix));
  assert.match(text, /autostart.*configured/i);
  assert.match(text, /activation.*unknown|active.*unknown/i);
});

test('doctor keeps unmanaged npm installation autostart unknown rather than claiming it is disabled', posix, async t => {
  const f = await fixture(t, { managed: false });
  const report = await f.doctor();
  assert.equal(report.hud?.prefix, f.prefix);
  assert.equal(report.hud.scope, null);
  assert.equal(report.hud.managed, false);
  assert.deepEqual(report.hud.autostart, { configured: null, active: null });
  assert.equal(report.stages.autostart, 'unknown');
});

test('doctor reads legacy managed shell metadata when no install state exists', posix, async t => {
  const f = await fixture(t);
  await rm(f.stateFile);
  await writeFile(f.shellFile, '# Managed by codex-hud-install.\n# language: ko\n'
    + '# codex-hud autostart enabled\n');
  const report = await f.doctor();
  assert.equal(report.hud?.scope, 'user');
  assert.equal(report.hud.language, 'ko');
  assert.equal(report.hud.autostart.configured, true);
  assert.equal(report.hud.autostart.active, null);
});

test('doctor recovers a legacy project root assignment without a scope header', posix, async t => {
  const f = await fixture(t, { scope: 'project', autostart: true });
  await rm(f.stateFile);
  const quoted = "'" + f.project.replaceAll("'", "'\"'\"'") + "'";
  await writeFile(f.shellFile, '# Managed by codex-hud-install.\n# language: en\n'
    + '# codex-hud autostart enabled\n'
    + `_CODEX_HUD_PROJECT_ROOT=${quoted}\n`);
  const report = await f.doctor();
  assert.equal(report.hud.scope, 'project');
  assert.equal(report.hud.project, f.project);
  assert.equal(report.hud.autostart.configured, true);
  assert.deepEqual(report.hud.warnings, []);
});

test('doctor reports an expanding legacy project assignment as unknown without evaluating it', posix, async t => {
  const f = await fixture(t, { scope: 'project' });
  await rm(f.stateFile);
  const marker = join(f.root, 'must-not-exist');
  await writeFile(f.shellFile, '# Managed by codex-hud-install.\n# language: en\n'
    + `_CODEX_HUD_PROJECT_ROOT=$(touch '${marker}')\n`);
  const report = await f.doctor();
  assert.equal(report.hud.scope, 'project');
  assert.equal(report.hud.project, null);
  assert.ok(report.hud.warnings.length > 0);
  await assert.rejects(stat(marker), { code: 'ENOENT' });
});

test('doctor promptly rejects expansion after a long unquoted legacy project prefix', posix, async t => {
  const f = await fixture(t, { scope: 'project' });
  await rm(f.stateFile);
  await writeFile(f.shellFile, '# Managed by codex-hud-install.\n# language: en\n'
    + `_CODEX_HUD_PROJECT_ROOT=/tmp/${'long-project-'.repeat(12)}$UNRESOLVED\n`);
  const { stdout } = await exec(process.execPath, [f.command, 'doctor', '--json'], {
    cwd: f.project, env: f.env, timeout: 1500, killSignal: 'SIGKILL',
  });
  const report = JSON.parse(stdout);
  assert.equal(report.hud.scope, 'project');
  assert.equal(report.hud.project, null);
  assert.ok(report.hud.warnings.length > 0);
});

test('doctor does not report a saved project root when the managed shell selects a conflicting root', posix, async t => {
  const f = await fixture(t, { scope: 'project' });
  await writeFile(f.shellFile, '# Managed by codex-hud-install.\n# scope: project\n# language: en\n'
    + `_CODEX_HUD_PROJECT_ROOT='${join(f.root, 'another-project')}'\n`);
  const report = await f.doctor();
  assert.equal(report.hud.project, null);
  assert.ok(report.hud.warnings.length > 0);
  assert.equal(report.hud.prefix, f.prefix);
});

test('doctor compares the selected bundle using numeric versions, prereleases and build metadata', posix, async t => {
  const f = await fixture(t);
  const metadata = join(f.root, 'bundle', 'package.json');
  for (const [version, expected] of [
    ['0.10.0', 'upgrade'], ['0.5.2', 'downgrade'], ['0.6.0', 'same'],
    ['0.6.0+repacked.2', 'same'], ['0.6.0-rc.1', 'downgrade'],
  ]) {
    await bundle(metadata, version);
    const report = await f.doctor(['--bundle', metadata]);
    assert.equal(report.bundle?.version, version);
    assert.equal(report.bundle.comparison, expected, version);
    assert.equal(report.bundle.metadataPath, metadata);
  }
  const releaseCandidate = await fixture(t, { version: '0.6.0-rc.2' });
  await bundle(metadata, '0.6.0-rc.10');
  assert.equal((await releaseCandidate.doctor(['--bundle', metadata])).bundle.comparison, 'upgrade');
});

test('doctor finds the enabled plugin bundle in the selected Codex home without choosing disabled copies', posix, async t => {
  const f = await fixture(t);
  const enabled = plugin('personal', '1.0.0+cache.1');
  const disabled = plugin('old', '9.0.0', false);
  await plugins(f, [enabled, disabled]);
  const alternateHome = join(f.root, 'alternate-codex-home');
  const path = await bundle(cachedBundle(alternateHome, enabled), '0.7.0');
  const report = await f.doctor(['--codex-home', alternateHome]);
  assert.equal(report.plugin?.status, 'registered');
  assert.equal(report.stages.plugin, 'registered');
  assert.equal(report.bundle.metadataPath, path);
  assert.equal(report.bundle.version, '0.7.0');
  assert.equal(report.bundle.comparison, 'upgrade');
  assert.equal(await readFile(join(f.root, 'probe-home'), 'utf8'), alternateHome);
});

test('doctor requires an explicit bundle when multiple enabled HUD plugins are registered', posix, async t => {
  const f = await fixture(t);
  const entries = [plugin('personal'), plugin('codex-hud')];
  await plugins(f, entries);
  const first = await bundle(cachedBundle(f.codexHome, entries[0]), '0.5.2');
  await bundle(cachedBundle(f.codexHome, entries[1]), '0.7.0');
  const ambiguous = await f.doctor();
  assert.equal(ambiguous.plugin?.status, 'ambiguous');
  assert.equal(ambiguous.bundle.status, 'ambiguous');
  assert.equal(ambiguous.bundle.comparison, 'unknown');
  const explicit = await f.doctor(['--bundle', first]);
  assert.equal(explicit.bundle.version, '0.5.2');
  assert.equal(explicit.bundle.comparison, 'downgrade');
});

test('doctor distinguishes an unregistered plugin from an unavailable plugin probe', posix, async t => {
  const f = await fixture(t);
  await plugins(f, []);
  const report = await f.doctor();
  assert.equal(report.plugin?.status, 'not-registered');
  assert.equal(report.bundle.status, 'not-found');
  assert.equal(report.hud.version, '0.6.0');
});

test('doctor retains diagnostics when saved install state or explicit bundle metadata is malformed', posix, async t => {
  const f = await fixture(t, { autostart: true });
  await writeFile(f.stateFile, '{"broken":');
  const metadata = join(f.root, 'broken-bundle.json');
  await writeFile(metadata, JSON.stringify({ name: 'my-codex-hud', version: 'invalid' }));
  const report = await f.doctor(['--bundle', metadata]);
  assert.equal(report.inline.available, true);
  assert.equal(report.hud.version, '0.6.0');
  assert.ok(report.hud.warnings.length > 0);
  assert.equal(report.bundle.status, 'invalid');
  assert.equal(report.bundle.comparison, 'unknown');
  assert.ok(report.bundle.error);
});

test('bundle comparison is a doctor option and does not affect ordinary HUD commands', async t => {
  const f = await fixture(t, { installed: false });
  await assert.rejects(f.run(['demo', '--bundle', '/some/bundle.json']), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /--bundle.*doctor/);
    return true;
  });
});

test('doctor rejects an empty explicit bundle instead of silently selecting a different plugin', async t => {
  const f = await fixture(t, { installed: false });
  await assert.rejects(f.doctor(['--bundle', '']), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /--bundle.*(empty|path)/i);
    return true;
  });
});

test('doctor reports actual Node and terminal context without treating a terminal name as active autostart', async t => {
  const f = await fixture(t, { installed: false });
  Object.assign(f.env, { TERM_PROGRAM: 'ghostty', TERM: 'xterm-ghostty',
    SHELL: '/bin/zsh', ZDOTDIR: join(f.root, 'zsh-config') });
  const report = await f.doctor();
  assert.equal(report.platform, process.platform);
  assert.equal(report.arch, process.arch);
  assert.equal(report.nodeExecutable, process.execPath);
  assert.deepEqual(report.terminal, {
    program: 'ghostty', term: 'xterm-ghostty', shell: '/bin/zsh', zDotDir: join(f.root, 'zsh-config'),
    stdinIsTTY: false, stdoutIsTTY: false,
  });
  assert.equal(report.hud.autostart.active, null);
});
