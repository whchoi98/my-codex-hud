import assert from 'node:assert/strict';
import test from 'node:test';
import { createState, applyRecord } from '../src/state.js';

const stamp = '2026-09-13T04:00:00.000Z';
const record = payload => ({ timestamp: stamp, type: 'response_item', payload });
const call = (name, args, id = 'read') => record({
  type: 'function_call', name, arguments: JSON.stringify(args), call_id: id,
});
const result = (output, id = 'read') => record({ type: 'function_call_output', call_id: id, output });
const cache = '/home/example/.codex/plugins/cache';

test('successful plugin skill reads expose name, marketplace and version without retaining bodies', () => {
  const state = createState();
  applyRecord(state, call('exec_command', {
    cmd: `cat ${cache}/personal/review-kit/1.2.0+codex.20260913/skills/review/SKILL.md`,
  }));
  assert.equal(state.plugins?.length ?? 0, 0);
  applyRecord(state, result('Process exited with code 0\nOutput:\nPRIVATE_PLUGIN_INSTRUCTIONS'));
  assert.deepEqual(state.plugins, [{
    name: 'review-kit', marketplace: 'personal', version: '1.2.0+codex.20260913',
    lastReadAt: Date.parse(stamp),
  }]);
  assert.deepEqual(state.skills.map(skill => skill.name), ['review']);
  assert.doesNotMatch(JSON.stringify(state), /PRIVATE_PLUGIN_INSTRUCTIONS/);
  assert.doesNotMatch(JSON.stringify(state.plugins), /\/home|SKILL\.md/);
});

test('plugin usage deduplicates multiple skills while distinguishing marketplaces and refreshing versions', () => {
  const state = createState();
  applyRecord(state, call('read_multiple_files', { paths: [
    `${cache}/personal/review-kit/1.0.0/skills/review/SKILL.md`,
    `${cache}/personal/review-kit/1.0.0/skills/check/SKILL.md`,
    `${cache}/team/review-kit/2.0.0/skills/review/SKILL.md`,
  ] }, 'multiple'));
  applyRecord(state, result({ content: 'PRIVATE_PLUGIN_BODY' }, 'multiple'));
  assert.deepEqual(state.plugins?.map(({ name, marketplace, version }) => ({ name, marketplace, version })), [
    { name: 'review-kit', marketplace: 'personal', version: '1.0.0' },
    { name: 'review-kit', marketplace: 'team', version: '2.0.0' },
  ]);
  applyRecord(state, call('read_file', {
    path: `${cache}/personal/review-kit/1.1.0/skills/review/SKILL.md`,
  }, 'updated'));
  applyRecord(state, { ...result({ content: 'PRIVATE_PLUGIN_BODY' }, 'updated'), timestamp: '2026-09-13T04:01:00.000Z' });
  assert.deepEqual(state.plugins?.map(plugin => [plugin.marketplace, plugin.version]), [
    ['team', '2.0.0'], ['personal', '1.1.0'],
  ]);
  assert.equal(state.plugins.at(-1).lastReadAt, Date.parse('2026-09-13T04:01:00.000Z'));
});

test('plugin detection supports relative reads and Windows cache paths', () => {
  const state = createState();
  state.session.cwd = '/custom/codex-home/plugins/cache/team/relative-kit/3.0.0/skills/check/references';
  applyRecord(state, call('exec_command', { cmd: 'cat ../SKILL.md' }, 'relative'));
  applyRecord(state, result('Process exited with code 0', 'relative'));
  applyRecord(state, call('mcp__filesystem__read_file', {
    path: 'C:\\Users\\example\\.codex\\plugins\\cache\\personal\\windows-kit\\2.1.0\\skills\\check\\SKILL.md',
  }, 'windows'));
  applyRecord(state, result({ content: 'PRIVATE_PLUGIN_BODY' }, 'windows'));
  assert.deepEqual(state.plugins?.map(plugin => [plugin.name, plugin.marketplace, plugin.version]), [
    ['relative-kit', 'team', '3.0.0'], ['windows-kit', 'personal', '2.1.0'],
  ]);
});

test('failed reads, searches, ordinary skills and invalid cache metadata do not report plugin usage', () => {
  const state = createState();
  const path = `${cache}/personal/review-kit/1.0.0/skills/review/SKILL.md`;
  for (const [index, args, output] of [
    [0, { cmd: `cat ${path}` }, 'Process exited with code 1'],
    [1, { cmd: `rg SKILL.md ${cache}` }, 'Process exited with code 0'],
    [2, { cmd: `cat ${path}; true` }, 'Process exited with code 0'],
    [3, { cmd: `echo "cat ${path}"` }, 'Process exited with code 0'],
  ]) {
    applyRecord(state, call('exec_command', args, `shell-${index}`));
    applyRecord(state, result(output, `shell-${index}`));
  }
  for (const [index, path] of [
    '/home/example/.codex/skills/review/SKILL.md',
    `${cache}/personal/review-kit/1.0.0/.codex-plugin/plugin.json`,
    `${cache}/personal/review-kit/1.0.0/skills/review/references/guide.md`,
    `${cache}/personal/review-kit/1.0.0/skills/../../../ordinary/SKILL.md`,
    `${cache}/bad\nmarket/review-kit/1.0.0/skills/review/SKILL.md`,
    `${cache}/personal/bad\u001bplugin/1.0.0/skills/review/SKILL.md`,
    `${cache}/personal/review-kit/bad\nversion/skills/review/SKILL.md`,
  ].entries()) {
    applyRecord(state, call('read_file', { path }, `not-plugin-${index}`));
    applyRecord(state, result({ content: 'PRIVATE_PLUGIN_BODY' }, `not-plugin-${index}`));
  }
  applyRecord(state, call('read_file', { path }, 'failed'));
  applyRecord(state, result({ isError: true, error: 'permission denied' }, 'failed'));
  assert.deepEqual(state.plugins, []);
});

test('background plugin reads appear only after success and retained plugins are bounded independently of skills', () => {
  const state = createState();
  applyRecord(state, call('exec_command', {
    cmd: `cat ${cache}/personal/background-kit/1.0.0/skills/check/SKILL.md`,
  }, 'background'));
  applyRecord(state, result('Process running with session ID 1234', 'background'));
  assert.equal(state.plugins?.length ?? 0, 0);
  applyRecord(state, call('write_stdin', { session_id: 1234, chars: '' }, 'poll'));
  applyRecord(state, result('Process exited with code 0', 'poll'));
  assert.deepEqual(state.plugins?.map(plugin => plugin.name), ['background-kit']);
  for (let index = 0; index < 45; index += 1) {
    applyRecord(state, call('read_file', {
      path: `${cache}/personal/plugin-${index}/1.0.0/skills/check/SKILL.md`,
    }, `plugin-${index}`));
    applyRecord(state, result({ content: 'PRIVATE_PLUGIN_BODY' }, `plugin-${index}`));
  }
  assert.equal(state.plugins.length, 40);
  assert.equal(state.plugins[0].name, 'plugin-5');
  assert.equal(state.plugins.at(-1).name, 'plugin-44');
  assert.deepEqual(state.skills.map(skill => skill.name), ['check']);
  applyRecord(state, { timestamp: stamp, type: 'event_msg', payload: { type: 'task_started' } });
  assert.equal(state.plugins.length, 40);
  assert.deepEqual(createState().plugins, []);
});

test('a large mixed batch retains plugin usage after the ordinary skill limit is reached', () => {
  const state = createState();
  const paths = Array.from({ length: 40 }, (_, index) => `/skills/ordinary-${index}/SKILL.md`);
  paths.push(`${cache}/personal/review-kit/1.0.0/skills/check/SKILL.md`);
  applyRecord(state, call('read_multiple_files', { paths }));
  applyRecord(state, result({ content: 'PRIVATE_PLUGIN_BODY' }));
  assert.deepEqual(state.plugins.map(plugin => plugin.name), ['review-kit']);
  assert.equal(state.skills.length, 40);
  assert.equal(state.skills[0].name, 'ordinary-1');
  assert.equal(state.skills.at(-1).name, 'check');
});

test('many plugins sharing a skill name do not crowd out distinct skills in one batch', () => {
  const state = createState();
  const paths = Array.from({ length: 40 }, (_, index) =>
    `${cache}/personal/plugin-${index}/1.0.0/skills/check/SKILL.md`);
  paths.push('/skills/ordinary/SKILL.md');
  applyRecord(state, call('read_multiple_files', { paths }));
  applyRecord(state, result({ content: 'PRIVATE_PLUGIN_BODY' }));
  assert.deepEqual(state.skills.map(skill => skill.name), ['check', 'ordinary']);
  assert.equal(state.plugins.length, 40);
  assert.equal(state.plugins[0].name, 'plugin-0');
  assert.equal(state.plugins.at(-1).name, 'plugin-39');
});

test('ordered reads of an older plugin version retain the actual last-read version', () => {
  const state = createState();
  applyRecord(state, call('exec_command', { cmd: [
    'set -e',
    `cat ${cache}/personal/review-kit/1.0.0/skills/review/SKILL.md`,
    `cat ${cache}/personal/review-kit/2.0.0/skills/review/SKILL.md`,
    `cat ${cache}/personal/review-kit/1.0.0/skills/review/SKILL.md`,
  ].join('\n') }));
  applyRecord(state, result('Process exited with code 0'));
  assert.deepEqual(state.plugins.map(plugin => plugin.version), ['1.0.0']);
});

test('repeated reads within a command move both skills and plugins to the most-recent position', () => {
  const state = createState();
  applyRecord(state, call('exec_command', { cmd: [
    'set -e',
    `cat ${cache}/personal/first-kit/1.0.0/skills/first/SKILL.md`,
    `cat ${cache}/personal/second-kit/1.0.0/skills/second/SKILL.md`,
    `cat ${cache}/personal/first-kit/1.0.0/skills/first/SKILL.md`,
  ].join('\n') }));
  applyRecord(state, result('Process exited with code 0'));
  assert.deepEqual(state.plugins.map(plugin => plugin.name), ['second-kit', 'first-kit']);
  assert.deepEqual(state.skills.map(skill => skill.name), ['second', 'first']);
});
