import { applyActivity, finishPendingTools } from './activity.js';

/** All retained data is display metadata; message and tool output bodies are discarded. */
export function createState() {
  return {
    session: {
      id: null, cwd: null, model: null, effort: null, provider: null,
      cliVersion: null, startedAt: null, updatedAt: null,
      status: 'idle', source: null, path: null,
      approvalPolicy: null, approvalsReviewer: null,
    },
    context: { usedTokens: null, windowTokens: null, percent: null, updatedAt: null },
    tokens: { input: null, cached: null, output: null, reasoning: null, total: null },
    rateLimits: { primary: null, secondary: null, planType: null, updatedAt: null },
    tools: [],
    agents: [],
    skills: [],
    plugins: [],
    plan: [],
    compactions: 0,
    diagnostics: { malformedLines: 0, oversizedLines: 0 },
    git: null,
  };
}

export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export const shortText = (value, max = 180) =>
  typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim().slice(0, max) : null;
export function timestamp(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const result = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function updateApprovals(state, payload) {
  if ('approval_policy' in payload) {
    const value = payload.approval_policy;
    const granular = isObject(value) && isObject(value.granular)
      && ['sandbox_approval', 'rules', 'mcp_elicitations'].every(key => typeof value.granular[key] === 'boolean');
    state.session.approvalPolicy = ['untrusted', 'on-request', 'on-failure', 'never'].includes(value)
      ? value : granular ? 'granular' : null;
  }
  if ('approvals_reviewer' in payload) {
    state.session.approvalsReviewer = ['user', 'auto_review', 'guardian_subagent'].includes(payload.approvals_reviewer)
      ? payload.approvals_reviewer : null;
  }
}

function updateContext(state, usage, window, now) {
  if (window !== undefined) state.context.windowTokens = count(window) > 0 ? window : null;
  if (isObject(usage)) {
    state.context.usedTokens = count(usage.total_tokens);
    state.context.updatedAt = now;
  }
  const { usedTokens, windowTokens } = state.context;
  state.context.percent = usedTokens !== null && windowTokens > 0
    ? Math.min(100, usedTokens / windowTokens * 100)
    : null;
}

function updateTokens(state, usage) {
  if (!isObject(usage)) return;
  state.tokens = {
    input: count(usage.input_tokens),
    cached: count(usage.cached_input_tokens),
    output: count(usage.output_tokens),
    reasoning: count(usage.reasoning_output_tokens),
    total: count(usage.total_tokens),
  };
}

function limitWindow(window) {
  if (!isObject(window) || count(window.used_percent) === null) return null;
  return {
    usedPercent: Math.min(100, window.used_percent),
    windowMinutes: count(window.window_minutes),
    resetsAt: count(window.resets_at),
  };
}

function updateLimits(state, limits, now) {
  if (!isObject(limits)) return;
  state.rateLimits = {
    primary: limitWindow(limits.primary),
    secondary: limitWindow(limits.secondary),
    planType: shortText(limits.plan_type, 32),
    updatedAt: now,
  };
}

function compact(state, now) {
  state.compactions++;
  state.context.usedTokens = null;
  state.context.percent = null;
  state.context.updatedAt = now;
}

export function replacePlan(state, plan) {
  if (!Array.isArray(plan)) return;
  state.plan = plan.filter(item => isObject(item) && typeof item.step === 'string'
    && ['pending', 'in_progress', 'completed'].includes(item.status))
    .slice(0, 100)
    .map(item => ({ step: shortText(item.step, 240), status: item.status }));
}

/** Reduce one Codex rollout record in place. Unknown versions/records are ignored. */
export function applyRecord(state, record) {
  if (!isObject(record) || !isObject(record.payload)) return state;
  const payload = record.payload;
  const now = timestamp(record.timestamp);
  if (now !== null) state.session.updatedAt = now;
  switch (record.type) {
    case 'session_meta':
      Object.assign(state.session, {
        id: shortText(payload.id ?? payload.session_id, 128),
        cwd: typeof payload.cwd === 'string' ? payload.cwd : null,
        provider: shortText(payload.model_provider, 80),
        cliVersion: shortText(payload.cli_version, 40),
        startedAt: timestamp(payload.timestamp) ?? now,
        source: typeof payload.source === 'string' ? shortText(payload.source, 40)
          : isObject(payload.source) && 'subagent' in payload.source ? 'subagent' : null,
      });
      break;
    case 'turn_context':
      if (typeof payload.model === 'string') state.session.model = shortText(payload.model, 100);
      if (typeof payload.cwd === 'string') state.session.cwd = payload.cwd;
      if ('effort' in payload) state.session.effort = shortText(payload.effort, 24);
      updateApprovals(state, payload);
      break;
    case 'token_usage_record':
      updateContext(state, payload.usage, undefined, now);
      updateTokens(state, payload.thread_token_usage);
      break;
    case 'compacted':
      compact(state, now);
      break;
    case 'response_item':
      applyActivity(state, payload, now);
      break;
    case 'event_msg':
      switch (payload.type) {
        case 'token_count':
          if (isObject(payload.info)) {
            updateContext(state, payload.info.last_token_usage, payload.info.model_context_window, now);
            updateTokens(state, payload.info.total_token_usage);
          }
          updateLimits(state, payload.rate_limits, now);
          break;
        case 'task_started':
        case 'turn_started':
          finishPendingTools(state, 'interrupted', now, true);
          state.session.status = 'working';
          state.plan = [];
          updateContext(state, null, payload.model_context_window, now);
          break;
        case 'task_complete':
        case 'turn_complete':
          state.session.status = 'complete';
          // An absent tool result cannot prove success.
          finishPendingTools(state, 'interrupted', now, true);
          break;
        case 'turn_aborted':
          state.session.status = 'interrupted';
          finishPendingTools(state, 'interrupted', now);
          break;
        case 'plan_update':
          replacePlan(state, payload.plan);
          break;
        default:
          applyActivity(state, payload, now);
      }
      break;
  }
  return state;
}
