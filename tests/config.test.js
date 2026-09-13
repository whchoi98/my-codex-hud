import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

test('loads optional preferences and gives explicit CLI values precedence', async t => {
  const codexHome = await mkdtemp(join(tmpdir(), 'codex-hud-config-'));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  await writeFile(join(codexHome, 'codex-hud.json'), '{"preset":"minimal","language":"ko","interval":500}');
  const config = await loadConfig({ codexHome, overrides: { preset: 'full' } });
  assert.equal(config.preset, 'full');
  assert.equal(config.language, 'ko');
  assert.equal(config.interval, 500);
});

test('rejects malformed configs and unknown preference names with actionable errors', async t => {
  const codexHome = await mkdtemp(join(tmpdir(), 'codex-hud-config-'));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  const path = join(codexHome, 'codex-hud.json');
  await writeFile(path, '{oops');
  await assert.rejects(loadConfig({ codexHome }), /JSON/);
  await writeFile(path, '{"interval":1}');
  await assert.rejects(loadConfig({ codexHome }), /interval/);
  await writeFile(path, '{"colour":true}');
  await assert.rejects(loadConfig({ codexHome }), /colour/);
  await writeFile(path, '{"constructor":"wrong"}');
  await assert.rejects(loadConfig({ codexHome }), /constructor/);
  await writeFile(path, 'null');
  await assert.rejects(loadConfig({ codexHome }), /object/);
});

test('allows a missing default config but fails for a missing explicitly requested file', async () => {
  assert.equal((await loadConfig({ codexHome: '/tmp/no-codex-hud-config-here' })).preset, 'full');
  await assert.rejects(loadConfig({ codexHome: '/tmp', configPath: '/tmp/no-codex-hud-config-here/explicit.json' }), /ENOENT/);
});

test('mouse capture requires opt-in and can be disabled over saved preferences', async t => {
  const codexHome = await mkdtemp(join(tmpdir(), 'codex-hud-mouse-config-'));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  assert.equal((await loadConfig({ codexHome })).mouse, false);
  const path = join(codexHome, 'codex-hud.json');
  await writeFile(path, '{"mouse":true}');
  assert.equal((await loadConfig({ codexHome })).mouse, true);
  assert.equal((await loadConfig({ codexHome, overrides: { mouse: false } })).mouse, false);
  await writeFile(path, '{"mouse":"true"}');
  await assert.rejects(loadConfig({ codexHome }), /mouse.*true or false/);
});
