import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { findSession } from '../src/sessions.js';

const rootId = '11111111-1111-7111-8111-111111111111';
const childId = '22222222-2222-7222-8222-222222222222';
async function fixture(t) {
  const codexHome = await mkdtemp(join(tmpdir(), 'codex-hud-sessions-'));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  const dir = join(codexHome, 'sessions', '2026', '09', '09');
  await mkdir(dir, { recursive: true });
  return { codexHome, dir };
}
async function session(dir, id, cwd, fields = {}, mtime = 1788948000) {
  const path = join(dir, `rollout-2026-09-09T10-00-00-${id}.jsonl`);
  await writeFile(path, JSON.stringify({ type: 'session_meta', payload: {
    id, cwd, timestamp: '2026-09-09T10:00:00Z', source: 'cli', ...fields,
  } }) + '\n');
  await utimes(path, mtime, mtime);
  return path;
}

test('selects the most recently modified matching root, excluding a busy child and other projects', async t => {
  const { codexHome, dir } = await fixture(t);
  const root = await session(dir, rootId, '/project');
  await session(dir, childId, '/project', { source: { subagent: { thread_spawn: { parent_thread_id: rootId, depth: 1 } } } }, 1788948010);
  await session(dir, '33333333-3333-7333-8333-333333333333', '/project-other', {}, 1788948020);
  assert.equal(await findSession({ codexHome, cwd: '/project' }), root);
  assert.equal(await findSession({ codexHome, cwd: '/unrelated' }), null);
});

test('matches the exact working directory, not arbitrary prefix parents', async t => {
  const { codexHome, dir } = await fixture(t);
  await session(dir, rootId, '/project/subfolder');
  assert.equal(await findSession({ codexHome, cwd: '/project' }), null);
});

test('an explicit path or session id pins selection independent of working directory', async t => {
  const { codexHome, dir } = await fixture(t);
  const path = await session(dir, rootId, '/another');
  assert.equal(await findSession({ codexHome, cwd: '/project', session: rootId }), path);
  assert.equal(await findSession({ codexHome, cwd: '/project', session: path }), path);
});

test('since waits for a new session and never accidentally picks an old one', async t => {
  const { codexHome, dir } = await fixture(t);
  await session(dir, rootId, '/project');
  assert.equal(await findSession({ codexHome, cwd: '/project', since: Date.parse('2026-09-09T10:01:00Z') }), null);
  const fresh = await session(dir, childId, '/project', { timestamp: '2026-09-09T10:02:00Z' }, 1788948120);
  assert.equal(await findSession({ codexHome, cwd: '/project', since: Date.parse('2026-09-09T10:01:00Z') }), fresh);
});

test('resumed sessions win by mtime even when their creation date is old', async t => {
  const { codexHome, dir } = await fixture(t);
  await session(dir, rootId, '/project');
  const old = await session(dir, childId, '/project', { timestamp: '2026-01-01T10:00:00Z' }, 1788948100);
  assert.equal(await findSession({ codexHome, cwd: '/project' }), old);
});

test('tolerates incomplete metadata and missing session directories', async t => {
  const { codexHome, dir } = await fixture(t);
  await writeFile(join(dir, 'rollout-partial.jsonl'), '{"type":"session_meta"');
  assert.equal(await findSession({ codexHome, cwd: '/project' }), null);
  assert.equal(await findSession({ codexHome: join(codexHome, 'missing'), cwd: '/project' }), null);
});

test('rejects a nonexistent explicit session instead of silently following another', async t => {
  const { codexHome, dir } = await fixture(t);
  await session(dir, rootId, '/project');
  await assert.rejects(findSession({ codexHome, cwd: '/project', session: childId }), /not found/i);
});
