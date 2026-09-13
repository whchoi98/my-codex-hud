import { isObject, shortText, replacePlan } from './state.js';
import { recordLoadedSkills, skillsForTool } from './skills.js';

const MAX_TOOLS = 100;
const MAX_AGENTS = 40;
const details = new WeakMap();
const toolName = name => typeof name === 'string' ? name.split('.').at(-1).slice(0, 100) : null;

function internals(state) {
  if (!details.has(state)) details.set(state, new Map());
  return details.get(state);
}

function objectFrom(value) {
  if (isObject(value)) return value;
  if (typeof value !== 'string' || value.length > 131_072) return {};
  try {
    const parsed = JSON.parse(value);
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function resultObject(value) {
  const object = objectFrom(value);
  const content = Array.isArray(value) ? value : object.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (isObject(item) && ['text', 'input_text', 'output_text'].includes(item.type)) {
        const nested = objectFrom(item.text);
        if (Object.keys(nested).length) return { ...nested, isError: object.isError ?? nested.isError };
      }
    }
  }
  return object;
}

function targetFor(name, args, input) {
  if (name === 'apply_patch') {
    const patch = typeof input === 'string' ? input : args.patch ?? '';
    return typeof patch === 'string'
      ? shortText(patch.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/m)?.[1]) : null;
  }
  const target = args.file_path ?? args.path ?? args.filename ?? args.cmd ?? args.command
    ?? args.pattern ?? args.query ?? args.url;
  return shortText(Array.isArray(target) ? target.filter(value => typeof value === 'string').join(' ') : target);
}

function startTool(state, id, name, args, now, input, activate = true) {
  if (typeof id !== 'string' || !name) return null;
  id = id.slice(0, 160);
  let tool = state.tools.find(item => item.id === id);
  if (!tool) {
    tool = { id, name, target: targetFor(name, args, input), status: 'running', startedAt: now, endedAt: null };
    state.tools.push(tool);
    const skillReads = skillsForTool(name, args, state.session.cwd);
    if (skillReads.names.length) internals(state).set(id, { skillReads });
    while (state.tools.length > MAX_TOOLS) {
      const index = state.tools.findIndex(item => item.status !== 'running');
      const [removed] = state.tools.splice(index < 0 ? 0 : index, 1);
      internals(state).delete(removed.id);
    }
  }
  if (activate && tool.status === 'running') state.session.status = 'working';
  return tool;
}

function finishTool(state, id, status, now, authoritative = false) {
  const tool = state.tools.find(item => item.id === id);
  if (!tool) return;
  tool.status = status;
  tool.endedAt = status === 'running' ? null : now;
  const meta = internals(state).get(id) ?? {};
  if (status === 'completed' && meta.skillReads) {
    recordLoadedSkills(state, meta.skillReads, now);
    delete meta.skillReads;
  }
  if (status !== 'running') delete meta.processId;
  if (authoritative) meta.authoritative = true;
  internals(state).set(id, meta);
}

export function finishPendingTools(state, status, now, preserveBackground = false) {
  for (const tool of state.tools) {
    if (tool.status === 'running' && !(preserveBackground && internals(state).get(tool.id)?.processId)) {
      finishTool(state, tool.id, status, now);
    }
  }
}

function agentStatus(status) {
  let key = typeof status === 'string' ? status : isObject(status) ? Object.keys(status)[0] : 'running';
  key = key?.toLowerCase().replaceAll('_', '');
  if (key === 'completed') return 'completed';
  if (['errored', 'error', 'notfound'].includes(key)) return 'error';
  if (['shutdown', 'closed'].includes(key)) return 'closed';
  if (key === 'interrupted') return 'interrupted';
  return 'running';
}

function upsertAgent(state, id, fields, now) {
  if (typeof id !== 'string' || !id) return;
  let agent = state.agents.find(item => item.id === id);
  if (!agent) {
    agent = { id: id.slice(0, 160), name: null, role: null, model: null, status: 'running', startedAt: now, endedAt: null };
    state.agents.push(agent);
    if (state.agents.length > MAX_AGENTS) state.agents.shift();
  }
  for (const key of ['name', 'role', 'model']) {
    if (typeof fields[key] === 'string') agent[key] = shortText(fields[key], 100);
  }
  if (fields.status !== undefined) agent.status = agentStatus(fields.status);
  agent.endedAt = agent.status === 'running' ? null : now;
}

function resultHeader(output) {
  // Text after the envelope's Output: belongs to the command and has no authority.
  return output.split(/(?:^|\r?\n)(?:Output|Final output|Original output):(?:[ \t]*\r?\n|$)/i, 1)[0];
}

function parseExit(header, object) {
  if (object.isError === true || object.is_error === true || object.success === false
    || object.error != null) return 'error';
  const code = object.exit_code ?? object.exitCode ?? object.metadata?.exit_code
    ?? header.match(/^(?:Process exited with code|Exit code:)[ \t]+(-?\d+)[ \t]*\r?$/im)?.[1];
  if (!(typeof code === 'number' && Number.isFinite(code))
    && !(typeof code === 'string' && /^-?\d+$/.test(code))) return null;
  return Number(code) !== 0 ? 'error' : 'completed';
}

function outputText(value) {
  if (typeof value === 'string') return value;
  if (typeof value?.output === 'string') return value.output;
  const content = Array.isArray(value) ? value : value?.content;
  return Array.isArray(content)
    ? content.filter(item => typeof item?.text === 'string').map(item => item.text).join('\n').slice(0, 131_072)
    : '';
}

function completeCall(state, payload, now) {
  const id = payload.call_id ?? payload.id;
  const tool = state.tools.find(item => item.id === id);
  if (!tool) return;
  const meta = internals(state).get(id) ?? {};
  const object = resultObject(payload.output);
  const header = resultHeader(outputText(payload.output));
  const exitStatus = parseExit(header, object);
  const isCommand = ['exec_command', 'shell', 'shell_command', 'write_stdin'].includes(tool.name);
  const validSessionId = typeof object.session_id === 'string'
    || (typeof object.session_id === 'number' && Number.isFinite(object.session_id));
  const processId = isCommand && !exitStatus
    ? (validSessionId ? object.session_id : undefined)
      ?? header.match(/^Process running with session ID ([\w-]+)[ \t]*\r?$/m)?.[1]
    : undefined;
  const status = processId !== undefined ? 'running' : exitStatus ?? 'completed';
  if (!meta.authoritative) {
    finishTool(state, id, tool.name === 'write_stdin' ? exitStatus ?? 'completed' : status, now);
  }
  if (processId !== undefined && tool.name !== 'write_stdin' && !meta.authoritative) {
    internals(state).set(id, { ...meta, processId: String(processId) });
  }
  if (tool.name === 'write_stdin' && meta.pollProcessId) {
    for (const [callId, info] of internals(state)) {
      if (callId !== id && info.processId === meta.pollProcessId) {
        finishTool(state, callId, status, now);
      }
    }
  }
  if (tool.name === 'spawn_agent' && status !== 'error') {
    const agentId = object.agent_id ?? object.thread_id;
    const existing = state.agents.find(agent => agent.id === agentId);
    upsertAgent(state, agentId, {
      name: object.nickname ?? object.agent_nickname,
      role: existing?.role ?? meta.role,
      model: existing?.model ?? meta.model ?? state.session.model,
      status: existing?.status ?? 'running',
    }, tool.startedAt ?? now);
  }
  if (['wait', 'wait_agent'].includes(tool.name)) {
    const statuses = object.status ?? object.statuses;
    if (isObject(statuses)) {
      for (const [agentId, status] of Object.entries(statuses)) upsertAgent(state, agentId, { status }, now);
    }
  }
  if (tool.name === 'close_agent' && status !== 'error') {
    upsertAgent(state, meta.receiverId, { status: 'closed' }, now);
  }
  if (['send_input', 'resume_agent'].includes(tool.name) && status !== 'error') {
    upsertAgent(state, meta.receiverId, { status: 'running' }, now);
  }
}

function functionCall(state, payload, now) {
  const name = toolName(payload.name);
  const args = objectFrom(payload.arguments);
  const id = payload.call_id ?? payload.id;
  const tool = startTool(state, id, name, args, now, payload.input);
  if (!tool) return;
  // Keep only fields needed to correlate results, never original arguments.
  internals(state).set(tool.id, {
    ...internals(state).get(tool.id),
    role: shortText(args.agent_type ?? args.agent_role, 60),
    model: shortText(args.model, 100),
    receiverId: shortText(args.agent_id ?? args.id ?? args.target, 160),
    pollProcessId: ['string', 'number'].includes(typeof args.session_id) ? String(args.session_id) : null,
  });
  if (name === 'update_plan') replacePlan(state, args.plan);
}

function collabEvent(state, payload, now) {
  if (payload.type === 'collab_agent_spawn_end') {
    upsertAgent(state, payload.new_thread_id, {
      name: payload.new_agent_nickname, role: payload.new_agent_role,
      model: payload.model, status: payload.status,
    }, now);
  } else if (payload.type === 'collab_waiting_end') {
    if (isObject(payload.statuses)) {
      for (const [id, status] of Object.entries(payload.statuses)) upsertAgent(state, id, { status }, now);
    }
    if (Array.isArray(payload.agent_statuses)) {
      for (const item of payload.agent_statuses) {
        if (isObject(item)) upsertAgent(state, item.thread_id, { name: item.agent_nickname, role: item.agent_role, status: item.status }, now);
      }
    }
  } else if (['collab_close_end', 'collab_resume_end', 'collab_agent_interaction_end'].includes(payload.type)) {
    upsertAgent(state, payload.receiver_thread_id, {
      name: payload.receiver_agent_nickname,
      role: payload.receiver_agent_role,
      status: payload.type === 'collab_close_end' ? 'closed' : payload.status,
    }, now);
  } else if (payload.type === 'sub_agent_activity') {
    const statuses = { started: 'running', interacted: 'running', interrupted: 'interrupted', completed: 'completed' };
    upsertAgent(state, payload.agent_thread_id, { name: payload.agent_path, status: statuses[payload.kind] }, now);
  }
}

export function applyActivity(state, payload, now) {
  switch (payload.type) {
    case 'message':
      if (payload.role === 'user' && Array.isArray(payload.content)) {
        for (const item of payload.content) {
          if (typeof item?.text !== 'string') continue;
          const match = item.text.match(/^\s*<subagent_notification>\s*([\s\S]+?)\s*<\/subagent_notification>\s*$/);
          if (!match) continue;
          const notice = objectFrom(match[1]);
          // Only update an agent this session actually spawned. Discard its answer.
          const id = notice.agent_path ?? notice.agent_id;
          if (state.agents.some(agent => agent.id === id)) upsertAgent(state, id, { status: notice.status }, now);
        }
      }
      break;
    case 'function_call':
    case 'custom_tool_call':
      functionCall(state, payload, now);
      break;
    case 'function_call_output':
    case 'custom_tool_call_output':
      completeCall(state, payload, now);
      break;
    case 'web_search_call': {
      const id = payload.call_id ?? payload.id;
      startTool(state, id, 'web_search', objectFrom(payload.action), now);
      if (payload.status === 'completed') finishTool(state, id, 'completed', now);
      if (payload.status === 'failed') finishTool(state, id, 'error', now);
      break;
    }
    case 'exec_command_begin':
      startTool(state, payload.call_id, 'exec_command', { command: payload.command }, now);
      break;
    case 'exec_command_end':
      // Some rollout policies keep only the end event.
      startTool(state, payload.call_id, 'exec_command', { command: payload.command }, now, undefined, false);
      finishTool(state, payload.call_id, payload.exit_code === 0 ? 'completed' : 'error', now, true);
      break;
    case 'mcp_tool_call_begin':
      startTool(state, payload.call_id,
        `${shortText(payload.invocation?.server, 60) ?? 'mcp'}/${shortText(payload.invocation?.tool, 60) ?? 'tool'}`, {}, now);
      break;
    case 'mcp_tool_call_end': {
      const output = payload.result?.Ok ?? payload.result;
      const failed = isObject(payload.result) && Object.hasOwn(payload.result, 'Err');
      finishTool(state, payload.call_id, failed ? 'error' : parseExit('', objectFrom(output)) ?? 'completed', now, true);
      break;
    }
    case 'patch_apply_begin':
      startTool(state, payload.call_id, 'apply_patch', { path: isObject(payload.changes) ? Object.keys(payload.changes)[0] : null }, now);
      break;
    case 'patch_apply_end':
      finishTool(state, payload.call_id, payload.success ? 'completed' : 'error', now, true);
      break;
    default:
      collabEvent(state, payload, now);
  }
}
