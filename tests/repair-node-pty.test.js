import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, copyFile, link, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const posix = { skip: process.platform === 'win32' ? 'POSIX file permissions required' : false };

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codex-hud-pty-repair-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const installation = join(root, "hud ' with spaces");
  const dependency = join(installation, 'node_modules', 'node-pty');
  const script = join(installation, 'src', 'repair-node-pty.js');
  const outside = join(root, 'outside');
  const preload = join(root, 'platform.cjs');
  await Promise.all([dirname(script), dependency, outside].map(path => mkdir(path, { recursive: true })));
  await Promise.all([
    copyFile(new URL('../src/repair-node-pty.js', import.meta.url), script),
    writeFile(join(installation, 'package.json'), JSON.stringify({ type: 'module' })),
    writeFile(join(dependency, 'package.json'), JSON.stringify({ name: 'node-pty', main: 'index.cjs' })),
    // Permission recovery must also work after --ignore-scripts, without loading
    // a potentially missing or incompatible native addon.
    writeFile(join(dependency, 'index.cjs'), 'throw new Error("repair must not load the native addon");\n'),
  ]);
  const run = async ({ platform = 'darwin', arch = 'arm64', entry = script } = {}) => {
    await writeFile(preload, Object.entries({ platform, arch }).map(([name, value]) =>
      `Object.defineProperty(process, ${JSON.stringify(name)}, { value: ${JSON.stringify(value)} });`).join('\n'));
    return exec(process.execPath, ['--require', preload, entry], {
      cwd: outside, env: { PATH: '/usr/bin:/bin' }, timeout: 5000,
    });
  };
  return { root, installation, dependency, outside, script, run };
}

async function file(path, mode = 0o664) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, 'controlled helper contents\n');
  await chmod(path, mode);
  return path;
}

async function snapshot(path) {
  const info = await stat(path);
  return { mode: info.mode & 0o7777, ctimeMs: info.ctimeMs, contents: await readFile(path, 'utf8') };
}

async function rejectedReport(run) {
  let report;
  await assert.rejects(run(), error => {
    assert.equal(error.code, 1);
    report = JSON.parse(error.stdout);
    assert.equal(report.status, 'failed');
    assert.ok(report.errors.length > 0);
    return true;
  });
  return report;
}

for (const arch of ['arm64', 'x64']) {
  test(`manual/postinstall repair restores only readable ${arch} helper execute bits and is idempotent`, posix, async t => {
    const f = await fixture(t);
    const selected = [
      ['build/Release/spawn-helper', 0o664, 0o775],
      ['build/Debug/spawn-helper', 0o640, 0o750],
      [`prebuilds/darwin-${arch}/spawn-helper`, 0o600, 0o700],
      [`lib/prebuilds/darwin-${arch}/spawn-helper`, 0o444, 0o555],
    ];
    const ignored = [
      `prebuilds/darwin-${arch === 'arm64' ? 'x64' : 'arm64'}/spawn-helper`,
      'prebuilds/linux-arm64/spawn-helper', 'build/Release/pty.node', 'spawn-helper', 'unrelated.txt',
    ];
    await Promise.all([
      ...selected.map(([path, mode]) => file(join(f.dependency, path), mode)),
      ...ignored.map(path => file(join(f.dependency, path))),
    ]);
    const ignoredBefore = await Promise.all(ignored.map(path => snapshot(join(f.dependency, path))));
    const first = await f.run({ arch });
    for (const [path, , expected] of selected) {
      const after = await snapshot(join(f.dependency, path));
      assert.equal(after.mode, expected, path);
      assert.equal(after.contents, 'controlled helper contents\n');
    }
    assert.deepEqual(await Promise.all(ignored.map(path => snapshot(join(f.dependency, path)))), ignoredBefore);
    const report = JSON.parse(first.stdout);
    assert.equal(report.status, 'repaired');
    assert.deepEqual(report.repaired.sort(), selected.map(([path]) => join(f.dependency, path)).sort());
    assert.deepEqual(report.errors, []);
    const beforeRepeat = await Promise.all(selected.map(([path]) => snapshot(join(f.dependency, path))));
    const repeated = JSON.parse((await f.run({ arch })).stdout);
    assert.equal(repeated.status, 'ok');
    assert.deepEqual(repeated.repaired, []);
    assert.deepEqual(await Promise.all(selected.map(([path]) => snapshot(join(f.dependency, path)))), beforeRepeat);
  });
}

test('manual repair resolves a symlinked script entry while keeping dependency resolution at the installation', posix, async t => {
  const f = await fixture(t);
  const helper = await file(join(f.dependency, 'prebuilds/darwin-arm64/spawn-helper'));
  const entry = join(f.outside, 'repair.js');
  await symlink(f.script, entry);
  const output = await f.run({ entry });
  assert.equal((await snapshot(helper)).mode, 0o775);
  assert.equal(JSON.parse(output.stdout).status, 'repaired');
});

test('postinstall leaves Darwin helpers untouched on other platforms and unsupported architectures', posix, async t => {
  const f = await fixture(t);
  const helper = await file(join(f.dependency, 'prebuilds/darwin-arm64/spawn-helper'));
  const before = await snapshot(helper);
  for (const options of [
    { platform: 'linux', arch: 'arm64' }, { platform: 'win32', arch: 'x64' },
    { platform: 'darwin', arch: '../escape' },
  ]) {
    const report = JSON.parse((await f.run(options)).stdout);
    assert.equal(report.status, 'skipped');
    assert.deepEqual(report.repaired, []);
    assert.deepEqual(await snapshot(helper), before);
  }
});

for (const segment of ['spawn-helper', 'darwin-arm64', 'prebuilds']) {
  test(`repair refuses a ${segment} symlink and preserves its external target`, posix, async t => {
    const f = await fixture(t);
    const outside = await file(join(f.outside, 'darwin-arm64', 'spawn-helper'));
    let target;
    let alias;
    if (segment === 'spawn-helper') {
      alias = join(f.dependency, 'prebuilds/darwin-arm64/spawn-helper');
      target = outside;
    } else if (segment === 'darwin-arm64') {
      alias = join(f.dependency, 'prebuilds/darwin-arm64');
      target = dirname(outside);
    } else {
      alias = join(f.dependency, 'prebuilds');
      target = f.outside;
    }
    await mkdir(dirname(alias), { recursive: true });
    await symlink(target, alias);
    const before = await snapshot(outside);
    const report = await rejectedReport(() => f.run());
    assert.equal(report.errors.some(error => error.code === 'UNSAFE_PATH'), true);
    assert.deepEqual(await snapshot(outside), before);
    assert.equal((await lstat(alias)).isSymbolicLink(), true);
  });
}

test('repair refuses a linked node-pty package root instead of changing the external installation', posix, async t => {
  const f = await fixture(t);
  await file(join(f.dependency, 'prebuilds/darwin-arm64/spawn-helper'));
  const external = join(f.outside, 'node-pty');
  await rename(f.dependency, external);
  await symlink(external, f.dependency);
  const helper = join(external, 'prebuilds/darwin-arm64/spawn-helper');
  const before = await snapshot(helper);
  await rejectedReport(() => f.run());
  assert.deepEqual(await snapshot(helper), before);
});

test('repair refuses a linked node_modules directory instead of following it outside the installation', posix, async t => {
  const f = await fixture(t);
  await file(join(f.dependency, 'prebuilds/darwin-arm64/spawn-helper'));
  const external = join(f.outside, 'node_modules');
  await rename(dirname(f.dependency), external);
  await symlink(external, dirname(f.dependency));
  const helper = join(external, 'node-pty/prebuilds/darwin-arm64/spawn-helper');
  const before = await snapshot(helper);
  await rejectedReport(() => f.run());
  assert.deepEqual(await snapshot(helper), before);
});

test('repair refuses hardlinked helpers so chmod cannot alter an unrelated file', posix, async t => {
  const f = await fixture(t);
  const external = await file(join(f.outside, 'helper'));
  const helper = join(f.dependency, 'prebuilds/darwin-arm64/spawn-helper');
  await mkdir(dirname(helper), { recursive: true });
  await link(external, helper);
  const before = await snapshot(external);
  await rejectedReport(() => f.run());
  assert.deepEqual(await snapshot(external), before);
});

test('repair reports missing helpers and does not fabricate native build files', posix, async t => {
  const f = await fixture(t);
  const report = await rejectedReport(() => f.run());
  assert.equal(report.errors.some(error => error.code === 'ENOENT'), true);
  await assert.rejects(stat(join(f.dependency, 'build')), { code: 'ENOENT' });
  await assert.rejects(stat(join(f.dependency, 'prebuilds')), { code: 'ENOENT' });
});

test('repair rejects a helper directory without changing its permissions', posix, async t => {
  const f = await fixture(t);
  const helper = join(f.dependency, 'prebuilds/darwin-arm64/spawn-helper');
  await mkdir(helper, { recursive: true, mode: 0o700 });
  const before = (await stat(helper)).mode;
  await rejectedReport(() => f.run());
  assert.equal((await stat(helper)).mode, before);
});

test('repair checks the dependency identity before changing known helper files', posix, async t => {
  const f = await fixture(t);
  const helper = await file(join(f.dependency, 'prebuilds/darwin-arm64/spawn-helper'));
  await writeFile(join(f.dependency, 'package.json'), JSON.stringify({ name: 'another-package' }));
  const before = await snapshot(helper);
  await rejectedReport(() => f.run());
  assert.deepEqual(await snapshot(helper), before);
});
