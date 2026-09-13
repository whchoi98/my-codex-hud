import assert from 'node:assert/strict';
import test from 'node:test';
import { createState, applyRecord } from '../src/state.js';

const stamp = '2026-09-09T10:00:00.000Z';
const record = (type, payload) => ({ timestamp: stamp, type, payload });
const event = (type, fields = {}) => record('event_msg', { type, ...fields });
const call = (name, args, id = 'call-1') =>
  record('response_item', { type: 'function_call', name, arguments: JSON.stringify(args), call_id: id });
const result = (output, id = 'call-1') =>
  record('response_item', { type: 'function_call_output', call_id: id, output });

test('reports latest context separately from cumulative usage without double counting cache', () => {
  const state = createState();
  const usage = event('token_count', {
    info: {
      model_context_window: 100_000,
      last_token_usage: { input_tokens: 24_000, cached_input_tokens: 20_000, output_tokens: 1_000, total_tokens: 25_000 },
      total_token_usage: { input_tokens: 880_000, cached_input_tokens: 700_000, output_tokens: 20_000, reasoning_output_tokens: 5_000, total_tokens: 900_000 },
    },
    rate_limits: { primary: { used_percent: 0, window_minutes: 300, resets_at: 1788951600 }, secondary: null, plan_type: 'plus' },
  });
  applyRecord(state, usage);
  applyRecord(state, usage);
  assert.deepEqual(state.context, { usedTokens: 25_000, windowTokens: 100_000, percent: 25, updatedAt: Date.parse(stamp) });
  assert.equal(state.tokens.total, 900_000);
  assert.equal(state.tokens.cached, 700_000);
  assert.equal(state.rateLimits.primary.usedPercent, 0);
  assert.equal(state.rateLimits.primary.resetsAt, 1788951600);
  assert.equal(state.rateLimits.secondary, null);
});

test('missing values stay unknown and sparse token events preserve the last usage snapshot', () => {
  const state = createState();
  assert.equal(state.context.percent, null);
  assert.equal(state.tokens.total, null);
  applyRecord(state, event('token_count', { info: { model_context_window: 100, last_token_usage: { total_tokens: 0 } } }));
  applyRecord(state, event('token_count', { info: null, rate_limits: null }));
  assert.equal(state.context.percent, 0);
  assert.equal(state.tokens.total, null);
  applyRecord(state, event('token_count', { info: { model_context_window: 0, last_token_usage: { total_tokens: -2 } } }));
  assert.equal(state.context.percent, null);
});

test('normalizes metadata and never retains prompts, instructions, or reasoning', () => {
  const state = createState();
  applyRecord(state, record('session_meta', {
    id: 'root-123', cwd: '/project', timestamp: stamp, cli_version: '0.153.4', source: 'cli', model_provider: 'openai',
    base_instructions: { text: 'PRIVATE_INSTRUCTION' },
  }));
  applyRecord(state, record('turn_context', { model: 'gpt-5', effort: 'high', cwd: '/project', instructions: 'PRIVATE_INSTRUCTION' }));
  applyRecord(state, record('response_item', { type: 'reasoning', summary: 'PRIVATE_REASONING', encrypted_content: 'PRIVATE_REASONING' }));
  assert.equal(state.session.id, 'root-123');
  assert.equal(state.session.model, 'gpt-5');
  assert.equal(state.session.effort, 'high');
  assert.equal(state.session.startedAt, Date.parse(stamp));
  assert.doesNotMatch(JSON.stringify(state), /PRIVATE_/);
});

test('tracks reported approval policy and reviewer without inferring a missing mode', () => {
  const state = createState();
  assert.equal(state.session.approvalPolicy, null);
  assert.equal(state.session.approvalsReviewer, null);
  applyRecord(state, record('turn_context', { approval_policy: 'on-request', approvals_reviewer: 'auto_review' }));
  assert.equal(state.session.approvalPolicy, 'on-request');
  assert.equal(state.session.approvalsReviewer, 'auto_review');
  applyRecord(state, record('turn_context', { model: 'same-session' }));
  assert.equal(state.session.approvalsReviewer, 'auto_review');
  applyRecord(state, record('turn_context', { approval_policy: 'never', approvals_reviewer: 'user' }));
  assert.equal(state.session.approvalPolicy, 'never');
  assert.equal(state.session.approvalsReviewer, 'user');
  applyRecord(state, record('turn_context', { approval_policy: [], approvals_reviewer: { text: 'PRIVATE_MODE' } }));
  assert.equal(state.session.approvalPolicy, null);
  assert.equal(state.session.approvalsReviewer, null);
  assert.doesNotMatch(JSON.stringify(state), /PRIVATE_MODE/);
});

test('normalizes granular approval settings and accepts historical reviewer values', () => {
  const state = createState();
  applyRecord(state, record('turn_context', {
    approval_policy: { granular: { sandbox_approval: true, rules: false, mcp_elicitations: true } },
    approvals_reviewer: 'guardian_subagent',
  }));
  assert.equal(state.session.approvalPolicy, 'granular');
  assert.equal(state.session.approvalsReviewer, 'guardian_subagent');
  applyRecord(state, record('turn_context', { approval_policy: 'on-failure' }));
  assert.equal(state.session.approvalPolicy, 'on-failure');
  applyRecord(state, record('turn_context', { approval_policy: { granular: 'PRIVATE_INVALID' } }));
  assert.equal(state.session.approvalPolicy, null);
});

test('records skills only after successful document reads and deduplicates repeated loads', () => {
  const state = createState();
  applyRecord(state, call('exec_command', {
    cmd: 'set -e\npwd\ncat "/home/me/.codex/skills/brainstorming/SKILL.md"\nsed -n \'1,200p\' /skills/test-driven-development/SKILL.md',
  }, 'skills'));
  assert.deepEqual(state.skills, []);
  applyRecord(state, result('Process exited with code 0\nOutput:\nPRIVATE_SKILL_INSTRUCTIONS', 'skills'));
  assert.deepEqual(state.skills.map(skill => skill.name), ['brainstorming', 'test-driven-development']);
  applyRecord(state, call('read_file', { file_path: '/skills/brainstorming/SKILL.md' }, 'again'));
  applyRecord(state, result({ content: 'PRIVATE_SKILL_BODY' }, 'again'));
  assert.deepEqual(state.skills.map(skill => skill.name), ['test-driven-development', 'brainstorming']);
  assert.equal(state.skills.at(-1).lastReadAt, Date.parse(stamp));
  assert.doesNotMatch(JSON.stringify(state), /PRIVATE_SKILL/);
});

test('does not turn skill searches, writes, failed reads, or pasted commands into loaded skills', () => {
  const state = createState();
  for (const [index, cmd] of [
    'rg SKILL.md /skills/example',
    'echo "cat /skills/example/SKILL.md"',
    'printf text > /skills/example/SKILL.md',
    'cat > /skills/example/SKILL.md',
    'false && cat /skills/example/SKILL.md; true',
    'cat /skills/example/SKILL.md || true',
    'cat /nonexistent/false-skill/SKILL.md; true',
    'cat --help /skills/example/SKILL.md',
    'head --version /skills/example/SKILL.md',
    'sed -i "s/foo/bar/" /skills/example/SKILL.md',
    'sed -e "w /skills/example/SKILL.md" README.md',
    'exit 0\ncat /skills/example/SKILL.md',
    'python3 - <<\'PY\'\ncat /skills/example/SKILL.md\nPY',
    '# cat /skills/example/SKILL.md\npwd',
  ].entries()) {
    applyRecord(state, call('exec_command', { cmd }, `not-load-${index}`));
    applyRecord(state, result('Process exited with code 0\nOutput:\nPRIVATE_OUTPUT', `not-load-${index}`));
  }
  applyRecord(state, call('read_file', { file_path: '/skills/failed/SKILL.md' }, 'failed'));
  applyRecord(state, result({ isError: true, error: 'permission denied' }, 'failed'));
  applyRecord(state, call('exec_command', { cmd: 'cat /skills/missing/SKILL.md' }, 'missing'));
  applyRecord(state, result('Process exited with code 1\nOutput:\nmissing file', 'missing'));
  assert.deepEqual(state.skills, []);
});

test('does not guess the working directory after a shell directory change', () => {
  const state = createState();
  state.session.cwd = '/project/wrong-name';
  for (const [index, cmd] of [
    'cd /skills/real-skill; cat SKILL.md',
    'command cd /skills/real-skill\ncat ./SKILL.md',
    'pushd /skills/real-skill\ncat SKILL.md',
  ].entries()) {
    applyRecord(state, call('exec_command', { cmd }, `relative-${index}`));
    applyRecord(state, result('Process exited with code 0\nOutput:\nPRIVATE_OUTPUT', `relative-${index}`));
  }
  assert.deepEqual(state.skills, []);
  applyRecord(state, call('exec_command', { cmd: 'cd /somewhere; cat /skills/absolute-skill/SKILL.md' }, 'absolute'));
  applyRecord(state, result('Process exited with code 0\nOutput:\nPRIVATE_OUTPUT', 'absolute'));
  assert.deepEqual(state.skills.map(skill => skill.name), ['absolute-skill']);
});

test('recognizes literal reads after shell loops and skips reads inside conditional blocks', () => {
  const state = createState();
  applyRecord(state, call('exec_command', { cmd: [
    'for path in /tmp/AGENTS.md; do',
    '  if [ -f "$path" ]; then',
    '    cat "$path"',
    '  fi',
    'done',
    'if false; then',
    '  cat /skills/not-loaded/SKILL.md',
    'fi',
    'cat /skills/real/SKILL.md',
  ].join('\n') }));
  applyRecord(state, result('Process exited with code 0\nOutput:\nPRIVATE_OUTPUT'));
  assert.deepEqual(state.skills.map(skill => skill.name), ['real']);
});

test('supports direct file tools, relative skill reads, and shell argv records', () => {
  const state = createState();
  applyRecord(state, call('read_multiple_files', {
    paths: ['/skills/first/SKILL.md', '/skills/first/references/example.md', 'C:\\skills\\second\\SKILL.md'],
  }, 'multiple'));
  applyRecord(state, result({ content: 'PRIVATE_OUTPUT' }, 'multiple'));
  applyRecord(state, call('exec_command', { cmd: 'cat SKILL.md', workdir: '/skills/third' }, 'relative'));
  applyRecord(state, result('Process exited with code 0\nOutput:\nPRIVATE_OUTPUT', 'relative'));
  applyRecord(state, event('exec_command_begin', { call_id: 'shell', command: ['/bin/bash', '-lc', 'head -n 100 /skills/fourth/SKILL.md'] }));
  applyRecord(state, event('exec_command_end', { call_id: 'shell', exit_code: 0 }));
  applyRecord(state, call('mcp__filesystem__read_file', { path: '/skills/fifth/SKILL.md' }, 'mcp'));
  applyRecord(state, result({ content: 'PRIVATE_OUTPUT' }, 'mcp'));
  applyRecord(state, call('exec_command', { cmd: 'cat ../SKILL.md', workdir: '/skills/sixth/references' }, 'parent'));
  applyRecord(state, result('Process exited with code 0\nOutput:\nPRIVATE_OUTPUT', 'parent'));
  assert.deepEqual(state.skills.map(skill => skill.name), ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']);
});

test('finishing a background skill read records it once and bounds retained skill metadata', () => {
  const state = createState();
  applyRecord(state, call('exec_command', { cmd: 'cat /skills/background/SKILL.md' }, 'read'));
  applyRecord(state, result('Process running with session ID 1234', 'read'));
  assert.deepEqual(state.skills, []);
  applyRecord(state, call('write_stdin', { session_id: 1234, chars: '' }, 'poll'));
  applyRecord(state, result('Process exited with code 0\nOutput:\nPRIVATE_OUTPUT', 'poll'));
  assert.deepEqual(state.skills.map(skill => skill.name), ['background']);
  for (let index = 0; index < 45; index += 1) {
    applyRecord(state, call('read_file', { path: `/skills/skill-${index}/SKILL.md` }, `load-${index}`));
    applyRecord(state, result({ content: 'PRIVATE_OUTPUT' }, `load-${index}`));
  }
  assert.equal(state.skills.length, 40);
  assert.equal(state.skills[0].name, 'skill-5');
  assert.equal(state.skills.at(-1).name, 'skill-44');
  applyRecord(state, event('task_started'));
  assert.equal(state.skills.length, 40, 'loaded documents remain part of the session history');
  assert.deepEqual(createState().skills, []);
});

test('compaction invalidates context until new usage while preserving cumulative totals', () => {
  const state = createState();
  applyRecord(state, event('token_count', { info: { model_context_window: 100_000, last_token_usage: { total_tokens: 90_000 }, total_token_usage: { total_tokens: 400_000 } } }));
  applyRecord(state, record('compacted', { message: 'PRIVATE_SUMMARY', replacement_history: [] }));
  assert.equal(state.compactions, 1);
  assert.equal(state.context.usedTokens, null);
  assert.equal(state.context.percent, null);
  assert.equal(state.tokens.total, 400_000);
  applyRecord(state, event('token_count', { info: { last_token_usage: { total_tokens: 20_000 } } }));
  assert.equal(state.context.percent, 20);
});

test('uses structured token_usage_record snapshots in newer Codex rollouts', () => {
  const state = createState();
  applyRecord(state, event('task_started', { model_context_window: 200_000 }));
  applyRecord(state, record('token_usage_record', {
    usage: { input_tokens: 30_000, output_tokens: 2_000, total_tokens: 32_000 },
    thread_token_usage: { input_tokens: 400_000, output_tokens: 30_000, total_tokens: 430_000 },
  }));
  assert.equal(state.context.percent, 16);
  assert.equal(state.tokens.total, 430_000);
});

test('tracks completed and failed commands without retaining output', () => {
  const state = createState();
  applyRecord(state, call('functions.exec_command', { cmd: 'npm test' }));
  assert.equal(state.tools[0].status, 'running');
  assert.equal(state.tools[0].target, 'npm test');
  applyRecord(state, result('Process exited with code 1\nPRIVATE_OUTPUT'));
  assert.equal(state.tools[0].status, 'error');
  assert.doesNotMatch(JSON.stringify(state), /PRIVATE_OUTPUT/);
  applyRecord(state, event('exec_command_end', { call_id: 'call-1', exit_code: 1 }));
  assert.equal(state.tools.length, 1);
});

test('keeps a yielded command running until its polling call reports exit', () => {
  const state = createState();
  applyRecord(state, call('exec_command', { cmd: 'npm test' }));
  applyRecord(state, result('Process running with session ID 2345\nOriginal token count: 0'));
  assert.equal(state.tools[0].status, 'running');
  applyRecord(state, call('write_stdin', { session_id: 2345, chars: '' }, 'poll'));
  applyRecord(state, result('Process exited with code 0\nOutput:\nPRIVATE_OUTPUT', 'poll'));
  assert.equal(state.tools.find(tool => tool.id === 'call-1').status, 'completed');
});

test('parses freeform patch tool calls and structured MCP results', () => {
  const state = createState();
  applyRecord(state, record('response_item', { type: 'custom_tool_call', name: 'apply_patch', call_id: 'patch', input: '*** Begin Patch\n*** Update File: src/main.js\n@@\n+SECRET_CODE\n*** End Patch' }));
  applyRecord(state, record('response_item', { type: 'custom_tool_call_output', call_id: 'patch', output: { success: true } }));
  assert.equal(state.tools[0].target, 'src/main.js');
  assert.equal(state.tools[0].status, 'completed');
  applyRecord(state, call('mcp__test__lookup', { query: 'lookup' }, 'mcp'));
  applyRecord(state, result({ isError: true, content: [{ type: 'text', text: 'PRIVATE_OUTPUT' }] }, 'mcp'));
  assert.equal(state.tools[1].status, 'error');
  assert.doesNotMatch(JSON.stringify(state), /SECRET_CODE|PRIVATE_OUTPUT/);
});

test('replaces plans atomically and does not keep a previous turn plan on a new turn', () => {
  const state = createState();
  applyRecord(state, call('update_plan', { plan: [{ step: 'Inspect', status: 'completed' }, { step: 'Build', status: 'in_progress' }] }));
  assert.equal(state.plan.length, 2);
  applyRecord(state, event('plan_update', { plan: [{ step: 'Ship', status: 'in_progress' }] }));
  assert.deepEqual(state.plan, [{ step: 'Ship', status: 'in_progress' }]);
  applyRecord(state, event('task_complete'));
  assert.equal(state.session.status, 'complete');
  applyRecord(state, event('task_started'));
  assert.deepEqual(state.plan, []);
});

test('tracks agents through function results and collaboration notifications', () => {
  const state = createState();
  applyRecord(state, call('spawn_agent', { agent_type: 'explorer', message: 'PRIVATE_PROMPT', model: 'gpt-5' }, 'spawn'));
  applyRecord(state, result(JSON.stringify({ agent_id: 'agent-1', nickname: 'Ada' }), 'spawn'));
  assert.equal(state.agents[0].name, 'Ada');
  assert.equal(state.agents[0].status, 'running');
  applyRecord(state, event('collab_waiting_end', { statuses: { 'agent-1': { completed: 'PRIVATE_ANSWER' } } }));
  assert.equal(state.agents[0].status, 'completed');
  applyRecord(state, event('collab_agent_spawn_end', { new_thread_id: 'agent-2', new_agent_nickname: 'Lin', new_agent_role: 'worker', model: 'gpt-5', status: 'running' }));
  applyRecord(state, event('collab_close_end', { receiver_thread_id: 'agent-2', status: 'running' }));
  assert.equal(state.agents[1].status, 'closed');
  assert.doesNotMatch(JSON.stringify(state), /PRIVATE_/);
});

test('recognizes hosted Codex agent completion notices without retaining the final answer', () => {
  const state = createState();
  applyRecord(state, call('multi_agent_v1.spawn_agent', { message: 'PRIVATE_PROMPT' }, 'spawn'));
  applyRecord(state, result('{"agent_id":"agent-1","nickname":"Ada"}', 'spawn'));
  applyRecord(state, record('response_item', {
    type: 'message', role: 'user',
    content: [{ type: 'input_text', text: '<subagent_notification>\n{"agent_path":"agent-1","status":{"completed":"PRIVATE_FINAL_ANSWER"}}\n</subagent_notification>' }],
  }));
  assert.equal(state.agents[0].status, 'completed');
  assert.doesNotMatch(JSON.stringify(state), /PRIVATE_/);
  applyRecord(state, call('multi_agent_v1.send_input', { target: 'agent-1', message: 'PRIVATE_FOLLOWUP' }, 'send'));
  applyRecord(state, result('{"submission_id":"submission-1"}', 'send'));
  assert.equal(state.agents[0].status, 'running');
});

test('uses custom tool output metadata to detect unsuccessful patch application', () => {
  const state = createState();
  applyRecord(state, record('response_item', { type: 'custom_tool_call', name: 'apply_patch', call_id: 'patch', input: '*** Begin Patch\n*** Update File: missing.js\n*** End Patch' }));
  applyRecord(state, record('response_item', { type: 'custom_tool_call_output', call_id: 'patch', output: JSON.stringify({ output: 'PRIVATE_FAILURE_BODY', metadata: { exit_code: 1 } }) }));
  assert.equal(state.tools[0].status, 'error');
  assert.doesNotMatch(JSON.stringify(state), /PRIVATE_/);
});

test('malformed patch arguments cannot stop subsequent valid records', () => {
  const state = createState();
  assert.doesNotThrow(() => applyRecord(state, call('apply_patch', { patch: 42 })));
  applyRecord(state, record('turn_context', { model: 'still-reading' }));
  assert.equal(state.session.model, 'still-reading');
});

test('wrong JSON field types cannot trigger object coercion failures', () => {
  const state = createState();
  const wrong = { toString: 42, valueOf: null };
  const inputs = [
    { ...record('turn_context', { model: 'valid' }), timestamp: wrong },
    call('exec_command', { cmd: [wrong] }, 'weird-command'),
    result({ exit_code: wrong, session_id: wrong }, 'weird-command'),
    event('mcp_tool_call_begin', { call_id: 'weird-mcp', invocation: { server: wrong, tool: wrong } }),
  ];
  for (const input of inputs) assert.doesNotThrow(() => applyRecord(state, input));
  applyRecord(state, record('turn_context', { model: 'next-record' }));
  assert.equal(state.session.model, 'next-record');
});

test('an empty error field does not turn a successful structured result into a failure', () => {
  const state = createState();
  applyRecord(state, call('exec_command', { cmd: 'true' }));
  applyRecord(state, result({ error: null, exit_code: 0 }));
  assert.equal(state.tools[0].status, 'completed');
});

test('a late command end does not reopen a completed turn', () => {
  const state = createState();
  applyRecord(state, event('task_complete'));
  applyRecord(state, event('exec_command_end', { call_id: 'late', command: ['true'], exit_code: 0 }));
  assert.equal(state.session.status, 'complete');
  assert.equal(state.tools[0].status, 'completed');
});

test('yielded processes can complete through polling in a subsequent turn', () => {
  const state = createState();
  applyRecord(state, event('task_started'));
  applyRecord(state, call('exec_command', { cmd: 'npm test' }, 'background'));
  applyRecord(state, result('Process running with session ID 456\nOutput:\n', 'background'));
  applyRecord(state, event('task_complete'));
  assert.equal(state.tools[0].status, 'running');
  applyRecord(state, event('task_started'));
  applyRecord(state, call('write_stdin', { session_id: 456, chars: '' }, 'poll-next-turn'));
  applyRecord(state, result('Process exited with code 0\nOutput:\nok', 'poll-next-turn'));
  assert.equal(state.tools.find(item => item.id === 'background').status, 'completed');
});

test('printed command output cannot impersonate a process lifecycle header', () => {
  const state = createState();
  applyRecord(state, call('exec_command', { cmd: 'print some text' }));
  applyRecord(state, result('Wall time: 1 seconds\nProcess exited with code 0\nOutput:\nProcess running with session ID 42\nProcess exited with code 1'));
  assert.equal(state.tools[0].status, 'completed');
});

test('structured API output preserves the authoritative MCP failure result', () => {
  const state = createState();
  applyRecord(state, call('mcp__test__lookup', {}, 'mcp'));
  applyRecord(state, event('mcp_tool_call_end', { call_id: 'mcp', result: { Err: 'failed' } }));
  applyRecord(state, result([{ type: 'input_text', text: 'tool error message' }], 'mcp'));
  assert.equal(state.tools[0].status, 'error');
});

test('function spawn results cannot overwrite an agent model resolved by Codex', () => {
  const state = createState();
  applyRecord(state, record('turn_context', { model: 'parent-model' }));
  applyRecord(state, call('spawn_agent', { agent_type: 'worker' }, 'spawn'));
  applyRecord(state, event('collab_agent_spawn_end', { new_thread_id: 'agent', new_agent_nickname: 'Ada', model: 'role-specific-model', status: 'running' }));
  applyRecord(state, result('{"agent_id":"agent","nickname":"Ada"}', 'spawn'));
  assert.equal(state.agents[0].model, 'role-specific-model');
});

test('interrupts pending tools instead of marking them successful', () => {
  const state = createState();
  applyRecord(state, call('exec_command', { cmd: 'sleep 100' }));
  applyRecord(state, event('turn_aborted', { reason: 'interrupted' }));
  assert.equal(state.session.status, 'interrupted');
  assert.equal(state.tools[0].status, 'interrupted');
});

test('ignores unknown/malformed records and bounds retained activity', () => {
  const state = createState();
  for (const entry of [null, [], {}, { type: 'event_msg', payload: null }, { type: 'response_item', payload: { type: 'function_call', arguments: '{' } }]) {
    assert.doesNotThrow(() => applyRecord(state, entry));
  }
  for (let i = 0; i < 1_000; i++) {
    applyRecord(state, call('read_file', { path: `file-${i}.js` }, `c-${i}`));
    applyRecord(state, result('ok', `c-${i}`));
  }
  assert.ok(state.tools.length <= 100);
  assert.equal(state.tools.at(-1).id, 'c-999');
});
