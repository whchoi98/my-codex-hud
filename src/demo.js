import { createState } from './state.js';

export function demoState(now = Date.now()) {
  const state = createState();
  Object.assign(state.session, {
    id: '00000000-0000-7000-8000-000000000001', cwd: '/workspace/my-project',
    model: 'gpt-5', effort: 'high', provider: 'openai', cliVersion: '0.153.4',
    startedAt: now - 12 * 60_000, updatedAt: now, status: 'working', source: 'demo',
    approvalPolicy: 'on-request', approvalsReviewer: 'auto_review',
  });
  state.context = { usedTokens: 108_528, windowTokens: 258_400, percent: 42, updatedAt: now };
  state.tokens = { input: 215_400, cached: 168_500, output: 8500, reasoning: 3200, total: 223_900 };
  state.rateLimits = {
    primary: { usedPercent: 23, windowMinutes: 300, resetsAt: (now + 96 * 60_000) / 1000 },
    secondary: { usedPercent: 41, windowMinutes: 10_080, resetsAt: (now + 3 * 86_400_000) / 1000 },
    planType: 'plus', updatedAt: now,
  };
  state.git = { branch: 'feat/codex-hud', dirty: true, ahead: 2, behind: 0, changed: 3, untracked: 1 };
  state.tools = [
    { id: 'read', name: 'read_file', target: 'src/state.js', status: 'completed', startedAt: now - 25_000, endedAt: now - 24_000 },
    { id: 'patch', name: 'apply_patch', target: 'src/render.js', status: 'completed', startedAt: now - 16_000, endedAt: now - 15_000 },
    { id: 'test', name: 'exec_command', target: 'npm test', status: 'running', startedAt: now - 2000, endedAt: null },
  ];
  state.agents = [
    { id: 'agent-ada', name: 'Ada', role: 'reviewer', model: 'gpt-5', status: 'running', startedAt: now - 45_000, endedAt: null },
    { id: 'agent-lin', name: 'Lin', role: 'worker', model: 'gpt-5', status: 'running', startedAt: now - 30_000, endedAt: null },
    { id: 'agent-max', name: 'Max', role: 'explorer', model: 'gpt-5', status: 'completed', startedAt: now - 60_000, endedAt: now - 15_000 },
  ];
  state.skills = [
    { name: 'brainstorming', lastReadAt: now - 60_000 },
    { name: 'test-driven-development', lastReadAt: now - 45_000 },
    { name: 'code-review', lastReadAt: now - 30_000 },
  ];
  state.plugins = [
    { name: 'review-kit', version: '1.2.0', marketplace: 'personal', lastReadAt: now - 30_000 },
  ];
  state.plan = [
    { step: 'Inspect Codex session events', status: 'completed' },
    { step: 'Build the terminal HUD', status: 'in_progress' },
    { step: 'Verify the npm package', status: 'pending' },
  ];
  state.compactions = 1;
  return state;
}
