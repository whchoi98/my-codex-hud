import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { getGitStatus } from '../src/git.js';

const exec = promisify(execFile);
test('reads a real repository including unborn branch, untracked, and staged files', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'codex-hud-git-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await exec('git', ['init', '-b', 'hud-test', cwd]);
  let info = await getGitStatus(cwd);
  assert.equal(info.branch, 'hud-test');
  assert.equal(info.dirty, false);
  await writeFile(join(cwd, 'hello.txt'), 'hello\n');
  info = await getGitStatus(cwd);
  assert.equal(info.untracked, 1);
  assert.equal(info.dirty, true);
  await exec('git', ['-C', cwd, 'add', 'hello.txt']);
  info = await getGitStatus(cwd);
  assert.equal(info.changed, 1);
  assert.equal(info.untracked, 0);
});

test('returns null outside a Git repository', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'codex-hud-no-git-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  assert.equal(await getGitStatus(cwd), null);
});

test('counts individual untracked files in new directories and excludes ignored files', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'codex-hud-git-nested-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await exec('git', ['init', '-b', 'hud-test', cwd]);
  await mkdir(join(cwd, 'new', 'nested'), { recursive: true });
  await mkdir(join(cwd, 'ignored'));
  await Promise.all([
    writeFile(join(cwd, '.gitignore'), 'ignored/\n'),
    writeFile(join(cwd, 'new', 'first.txt'), 'first\n'),
    writeFile(join(cwd, 'new', 'nested', 'second.txt'), 'second\n'),
    writeFile(join(cwd, 'ignored', 'cache.txt'), 'ignored\n'),
  ]);
  await exec('git', ['-C', cwd, 'add', '.gitignore']);
  const info = await getGitStatus(cwd);
  assert.equal(info.untracked, 2);
  assert.equal(info.changed, 1);
  assert.equal(info.dirty, true);
});
