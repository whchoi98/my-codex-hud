import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TranscriptReader } from '../src/transcript.js';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'codex-hud-reader-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'session.jsonl');
}
const line = (type, payload) => JSON.stringify({ timestamp: '2026-09-09T10:00:00Z', type, payload }) + '\n';
const usage = value => line('event_msg', { type: 'token_count', info: { model_context_window: 100, last_token_usage: { total_tokens: value } } });

test('only processes newly appended complete records and preserves split UTF-8', async t => {
  const path = await fixture(t);
  const reader = new TranscriptReader({ chunkSize: 17 });
  const record = Buffer.from(line('turn_context', { model: '한글모델', effort: 'high' }));
  const split = record.indexOf(Buffer.from('글')) + 1;
  await writeFile(path, record.subarray(0, split));
  assert.equal((await reader.read(path)).session.model, null);
  await appendFile(path, record.subarray(split));
  assert.equal((await reader.read(path)).session.model, '한글모델');
  await appendFile(path, usage(20));
  assert.equal((await reader.read(path)).context.percent, 20);
  assert.equal((await reader.read(path)).context.percent, 20);
});

test('skips malformed and oversized lines and recovers at the next newline', async t => {
  const path = await fixture(t);
  const reader = new TranscriptReader({ maxLineBytes: 250, chunkSize: 31 });
  await writeFile(path, '{broken}\n' + 'x'.repeat(500));
  let state = await reader.read(path);
  assert.equal(state.diagnostics.malformedLines, 1);
  assert.equal(state.diagnostics.oversizedLines, 1);
  await appendFile(path, '\n' + usage(45));
  state = await reader.read(path);
  assert.equal(state.context.percent, 45);
  assert.equal(state.diagnostics.oversizedLines, 1);
});

test('resets old state after truncation and inode replacement', async t => {
  const path = await fixture(t);
  const reader = new TranscriptReader();
  await writeFile(path, line('turn_context', { model: 'first-model' }) + usage(70));
  await reader.read(path);
  await writeFile(path, usage(10));
  let state = await reader.read(path);
  assert.equal(state.context.percent, 10);
  assert.equal(state.session.model, null);
  await rename(path, path + '.old');
  await writeFile(path, usage(30));
  state = await reader.read(path);
  assert.equal(state.context.percent, 30);
});

test('detects a file truncated and regrown beyond the previous cursor', async t => {
  const path = await fixture(t);
  const reader = new TranscriptReader();
  await writeFile(path, usage(90));
  await reader.read(path);
  await writeFile(path, line('turn_context', { model: 'replacement-long-model' }) + usage(15));
  const state = await reader.read(path);
  assert.equal(state.context.percent, 15);
  assert.equal(state.session.model, 'replacement-long-model');
});

test('detects same-size rewrites even when the last 128 bytes are unchanged', async t => {
  const path = await fixture(t);
  const reader = new TranscriptReader();
  const tail = line('ignored', { padding: 'x'.repeat(300) });
  await writeFile(path, line('turn_context', { model: 'first-model' }) + tail);
  await reader.read(path);
  await writeFile(path, line('turn_context', { model: 'other-model' }) + tail);
  await utimes(path, 1788948000, 1788948000);
  assert.equal((await reader.read(path)).session.model, 'other-model');
});

test('immediate same-size rewrites do not depend on filesystem timestamp resolution', async t => {
  const path = await fixture(t);
  const reader = new TranscriptReader();
  const tail = line('ignored', { padding: 'x'.repeat(300) });
  for (let index = 0; index < 100; index++) {
    const model = `model-${String(index).padStart(3, '0')}`;
    await writeFile(path, line('turn_context', { model }) + tail);
    assert.equal((await reader.read(path)).session.model, model);
  }
});

test('bounds work per read and exposes whether it has caught up', async t => {
  const path = await fixture(t);
  const reader = new TranscriptReader({ maxReadBytes: 100, chunkSize: 40 });
  await writeFile(path, usage(10) + usage(80));
  await reader.read(path);
  assert.equal(reader.caughtUp, false);
  for (let i = 0; i < 10 && !reader.caughtUp; i++) await reader.read(path);
  assert.equal(reader.caughtUp, true);
  assert.equal(reader.state.context.percent, 80);
});

test('missing files return a recoverable filesystem error', async t => {
  const path = await fixture(t);
  await assert.rejects(new TranscriptReader().read(path), { code: 'ENOENT' });
});
