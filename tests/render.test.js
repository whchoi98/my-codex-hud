import assert from 'node:assert/strict';
import test from 'node:test';
import { renderHud, renderWaiting } from '../src/render.js';
import { displayWidth, sanitizeText, truncateText } from '../src/terminal.js';

const NOW = Date.UTC(2026, 8, 9, 12);
const plainOptions = { color: false, width: 160, now: NOW };
const stripSgr = (text) => text.replace(/\x1b\[[\d;]*m/g, '');
const lines = (text) => text.split('\n');

function sessionState() {
  return {
    session: {
      id: 'fixture-session',
      cwd: '/home/dev/my-codex-hud',
      model: 'gpt-5-codex',
      effort: 'high',
      provider: 'openai',
      cliVersion: '0.153.4',
      startedAt: NOW - 754_000,
      updatedAt: NOW - 10_000,
      status: 'working',
      source: 'cli',
      path: '/fixture/rollout.jsonl',
    },
    context: {
      usedTokens: 25_000,
      windowTokens: 100_000,
      percent: 25,
      updatedAt: NOW,
    },
    tokens: {
      input: 850_000,
      cached: 400_000,
      output: 50_000,
      reasoning: 10_000,
      total: 900_000,
    },
    rateLimits: {
      primary: { usedPercent: 12.5, windowMinutes: 90, resetsAt: NOW / 1000 + 5400 },
      secondary: { usedPercent: 0, windowMinutes: 2880, resetsAt: NOW / 1000 + 30 },
      planType: 'pro',
      updatedAt: NOW,
    },
    tools: [
      { id: 't1', name: 'read_file', target: 'README.md', status: 'completed', startedAt: NOW - 5000, endedAt: NOW - 4000 },
      { id: 't2', name: 'exec_command', target: 'src/render.js', status: 'running', startedAt: NOW - 3000, endedAt: null },
      { id: 't3', name: 'apply_patch', target: 'src/terminal.js', status: 'error', startedAt: NOW - 2000, endedAt: NOW - 1000 },
    ],
    agents: [
      { id: 'a1', name: 'scout', role: 'reviewer', model: 'gpt-5-codex', status: 'running', startedAt: NOW - 1000, endedAt: null },
      { id: 'a2', name: 'builder', role: 'worker', model: 'gpt-5-codex', status: 'completed', startedAt: NOW - 5000, endedAt: NOW - 3000 },
    ],
    plan: [
      { step: 'Read contract', status: 'completed' },
      { step: 'Render terminal HUD', status: 'in_progress' },
      { step: 'Run tests', status: 'pending' },
    ],
    compactions: 2,
    diagnostics: { malformedLines: 0, oversizedLines: 0 },
    git: { branch: 'feature/hud', dirty: true, ahead: 2, behind: 1, changed: 3, untracked: 1 },
  };
}

test('sanitization removes terminal commands while retaining visible hyperlink text', () => {
  const unsafe = 'a\x1b[31mred\x1b[0m\x1b[2J'
    + '\x1b]0;hidden-title\x07'
    + '\x1b]8;;https://example.invalid\x1b\\link\x1b]8;;\x1b\\'
    + '\x1bPprivate-dcs\x1b\\'
    + '\x1b_private-apc\x1b\\'
    + '\x1b^private-pm\x1b\\'
    + '\x1bXprivate-sos\x1b\\'
    + '\x9b2J\x9d52;c;private-clipboard\x9c'
    + '\x90private-c1-dcs\x9c'
    + '\x1b(0b';
  assert.equal(sanitizeText(unsafe), 'aredlinkb');
});

test('sanitization handles unterminated controls, bidi overrides, and one-line fields', () => {
  assert.equal(sanitizeText('safe\x1b]52;c;hidden'), 'safe');
  assert.equal(sanitizeText('safe\x1b[31'), 'safe');
  assert.equal(sanitizeText('safe\x1bPprivate'), 'safe');
  assert.equal(sanitizeText('a\r\nb\tc\u2028d\u2029e'), 'a b c d e');
  assert.equal(sanitizeText('a\x00\x07\x08\x7f\u061c\u200e\u200f\u202e\u202c\u2066\u2069b'), 'ab');
  assert.equal(sanitizeText(null), '');
  assert.equal(sanitizeText(0), '0');
  assert.equal(sanitizeText('한글 e\u0301 👩🏽‍💻'), '한글 e\u0301 👩🏽‍💻');
});

test('display width measures terminal cells instead of code units', () => {
  const cases = [
    ['', 0],
    ['hello', 5],
    ['한글', 4],
    ['漢字Ａ', 6],
    ['e\u0301', 1],
    ['\u0301', 0],
    ['한', 2],
    ['🙂', 2],
    ['👩🏽‍💻', 2],
    ['👨‍👩‍👧‍👦', 2],
    ['🇰🇷', 2],
    ['1️⃣', 2],
    ['☀️', 2],
    ['☀︎', 1],
    ['©', 1],
    ['©️', 2],
    ['·…', 2],
    ['\x1b[36m한글\x1b[0m', 4],
    ['\x1b]0;title\x07a', 1],
  ];
  for (const [text, expected] of cases) {
    assert.equal(displayWidth(text), expected, JSON.stringify(text));
  }
});

test('text presentation preserves the width of inherently wide emoji', () => {
  assert.equal(displayWidth('⌚︎'), 2);
  assert.equal(displayWidth('⌛︎'), 2);
  assert.equal(displayWidth('☀︎'), 1);
  assert.equal(truncateText('⌚︎x', 2), '…');
  assert.equal(truncateText('⌛︎x', 2, ''), '⌛︎');
});

test('truncation budgets its suffix and never splits CJK or emoji graphemes', () => {
  const cases = [
    ['hello', 5, undefined, 'hello'],
    ['hello', 4, undefined, 'hel…'],
    ['hello', 1, undefined, '…'],
    ['hello', 0, undefined, ''],
    ['hello', -1, undefined, ''],
    ['한글abc', 4, undefined, '한…'],
    ['한글', 3, '', '한'],
    ['한글', 1, '', ''],
    ['e\u0301abc', 2, undefined, 'e\u0301…'],
    ['👩🏽‍💻xy', 3, undefined, '👩🏽‍💻…'],
    ['👩🏽‍💻xy', 2, undefined, '…'],
    ['🇰🇷ab', 3, undefined, '🇰🇷…'],
    ['1️⃣ab', 3, undefined, '1️⃣…'],
    ['abcdef', 4, '..', 'ab..'],
    ['abcdef', 1, '..', '.'],
    ['abcdef', 1, '界', ''],
    ['\x1b[31mhello\x1b[0m', 4, undefined, 'hel…'],
  ];
  for (const [text, width, suffix, expected] of cases) {
    assert.equal(truncateText(text, width, suffix), expected, JSON.stringify({ text, width, suffix }));
  }
  assert.equal(truncateText('abcdef', 4, '\x1b[31m..'), 'ab..');
});

test('full HUD separates context from cumulative totals and shows activity', () => {
  const output = renderHud(sessionState(), plainOptions);
  assert.equal(lines(output).length, 8);
  assert.match(lines(output)[0], /gpt-5-codex.*high.*my-codex-hud.*feature\/hud.*working/);
  assert.match(lines(output)[0], /\*.*↑2.*↓1/);
  assert.match(output, /Context [^\n]*25%[^\n]*25k[^\n]*100k/);
  assert.match(output, /Tokens [^\n]*900k/);
  assert.match(output, /in 850k/);
  assert.match(output, /cache 400k/);
  assert.match(output, /out 50k/);
  assert.match(output, /reason 10k/);
  assert.match(output, /12m 34s/);
  assert.match(output, /compactions 2/);
  assert.match(output, /Tools [^\n]*1 running[^\n]*1 done[^\n]*1 error/);
  assert.match(output, /exec_command[^\n]*src\/render\.js/);
  assert.match(output, /^Agents 1 running$/m);
  assert.match(output, /running[^\n]*scout \(reviewer\)/);
  assert.doesNotMatch(output, /builder/);
  assert.match(output, /Plan 1\/3[^\n]*Render terminal HUD/);
  assert.doesNotMatch(output, /\x1b|undefined|null|NaN|Infinity/);
});

test('every preset shows reported approval mode without confusing never with auto-review', () => {
  const state = sessionState();
  for (const preset of ['full', 'essential', 'minimal']) {
    for (const language of ['en', 'ko']) {
      const options = { ...plainOptions, preset, language, width: 220 };
      state.session.approvalPolicy = 'on-request';
      state.session.approvalsReviewer = 'auto_review';
      assert.match(lines(renderHud(state, options))[0], /auto-review \(on-request\)/);
      state.session.approvalsReviewer = 'user';
      assert.match(lines(renderHud(state, options))[0], /user \(on-request\)/);
      state.session.approvalsReviewer = 'guardian_subagent';
      assert.match(lines(renderHud(state, options))[0], /auto-review \(on-request\)/);
      state.session.approvalPolicy = 'never';
      const never = lines(renderHud(state, options))[0];
      assert.match(never, /never/);
      assert.doesNotMatch(never, /auto-review/);
      state.session.approvalsReviewer = null;
      state.session.approvalPolicy = 'untrusted';
      assert.match(lines(renderHud(state, options))[0], /untrusted/);
      state.session.approvalPolicy = null;
      assert.match(lines(renderHud(state, options))[0], /(?:Approval|승인) —/);
    }
  }
});

test('approval mode remains visible before project details at typical terminal widths', () => {
  const state = sessionState();
  state.session.approvalPolicy = 'on-request';
  state.session.approvalsReviewer = 'auto_review';
  for (const language of ['en', 'ko']) {
    const line = lines(renderHud(state, { ...plainOptions, language, width: 80 }))[0];
    assert.match(line, /auto-review \(on-request\)/);
    assert.ok(displayWidth(line) <= 80);
  }
});

test('full lists loaded skills on one row directly below tools while compact presets keep their line budgets', () => {
  const state = sessionState();
  state.skills = [{ name: 'brainstorming' }, { name: 'test-driven-development' }];
  for (const language of ['en', 'ko']) {
    const output = renderHud(state, { ...plainOptions, language });
    const rows = lines(output);
    const toolRow = rows.findIndex(line => /^(?:Tools|도구) /.test(line));
    assert.match(rows[toolRow + 1], /^(?:Loaded skills|로드한 스킬) 2[^\n]*test-driven-development, brainstorming$/);
    assert.equal(rows.length, 9);
    const essential = renderHud(state, { ...plainOptions, language, preset: 'essential' });
    assert.ok(lines(essential).length <= 5);
    assert.match(essential, /(?:Skills|스킬) 2/);
    const minimal = renderHud(state, { ...plainOptions, language, preset: 'minimal' });
    assert.ok(lines(minimal).length <= 2);
    assert.doesNotMatch(minimal, /brainstorming|test-driven-development/);
  }
});

test('full lists used plugin versions and marketplaces while compact presets keep their line budgets', () => {
  const state = sessionState();
  state.skills = [{ name: 'review-code' }];
  state.plugins = [
    { name: 'review-kit', version: '1.0.0', marketplace: 'team' },
    { name: 'review-kit', version: '2.0.0', marketplace: 'personal' },
  ];
  for (const language of ['en', 'ko']) {
    for (const ascii of [false, true]) {
      const options = { ...plainOptions, language, ascii, width: 220 };
      const output = renderHud(state, options);
      assert.match(output, /(?:Used plugins|사용한 플러그인) 2/);
      assert.match(output, /review-kit v1\.0\.0[^\n]*team/);
      assert.match(output, /review-kit v2\.0\.0[^\n]*personal/);
      assert.ok(output.indexOf('v2.0.0') < output.indexOf('v1.0.0'));
      const rows = lines(output);
      const skillRow = rows.findIndex(line => /^(?:Loaded skills|로드한 스킬) /.test(line));
      assert.match(rows[skillRow + 1], /^(?:Used plugins|사용한 플러그인) 2/);
      assert.ok(output.lastIndexOf('review-kit') < output.indexOf(language === 'ko' ? '에이전트 ' : 'Agents '));
      const essential = renderHud(state, { ...options, preset: 'essential' });
      assert.ok(lines(essential).length <= 5);
      assert.match(essential, /(?:Plugins|플러그인) 2/);
      assert.doesNotMatch(essential, /review-kit/);
      const minimal = renderHud(state, { ...options, preset: 'minimal' });
      assert.ok(lines(minimal).length <= 2);
      assert.doesNotMatch(minimal, /review-kit|Plugins|플러그인/);
    }
  }
  state.plugins = [];
  assert.doesNotMatch(renderHud(state, plainOptions), /Used plugins/);
});

test('usage windows use reported lengths, percentages, and Unix-second reset times', () => {
  const output = renderHud(sessionState(), plainOptions);
  const usage = lines(output).find((line) => line.startsWith('Usage '));
  assert.match(usage, /90m 12\.5%[^\n]*reset 1h 30m/);
  assert.match(usage, /2d 0%[^\n]*reset 30s/);
  assert.doesNotMatch(usage, /5h|7d/);

  const state = sessionState();
  state.rateLimits.primary = { usedPercent: 100, windowMinutes: 300, resetsAt: NOW / 1000 - 1 };
  state.rateLimits.secondary = null;
  const expired = renderHud(state, plainOptions);
  assert.match(expired, /5h 100%[^\n]*reset now/);
  assert.doesNotMatch(expired, /2d|7d|reset -/);
});

test('unknown usage stays unavailable instead of becoming zero or an invented window', () => {
  const state = sessionState();
  state.context = { usedTokens: null, windowTokens: null, percent: null, updatedAt: null };
  state.tokens = { input: null, cached: null, output: null, reasoning: null, total: null };
  state.rateLimits = { primary: null, secondary: null, planType: null, updatedAt: null };
  state.compactions = null;
  const output = renderHud(state, plainOptions);
  assert.match(output, /Context [^\n]*—/);
  assert.match(output, /Tokens —/);
  assert.match(output, /Usage unavailable/);
  assert.doesNotMatch(output, /0%|5h|7d|compactions 0|in 0|out 0|cache 0|reason 0/);

  state.rateLimits.primary = { usedPercent: null, windowMinutes: null, resetsAt: null };
  const partial = renderHud(state, plainOptions);
  assert.match(partial, /primary —[^\n]*reset —/);
  assert.doesNotMatch(partial, /0%|5h|7d/);
});

test('zero context, token counters, and compactions remain visible as zero', () => {
  const state = sessionState();
  state.context = { usedTokens: 0, windowTokens: 100_000, percent: 0, updatedAt: NOW };
  state.tokens = { input: 0, cached: 0, output: 0, reasoning: 0, total: 0 };
  state.compactions = 0;
  const output = renderHud(state, plainOptions);
  assert.match(output, /Context [^\n]*0%[^\n]*0[^\n]*100k/);
  assert.match(output, /Tokens 0/);
  assert.match(output, /in 0/);
  assert.match(output, /out 0/);
  assert.match(output, /cache 0/);
  assert.match(output, /reason 0/);
  assert.match(output, /compactions 0/);
});

test('context bar reflects current percentage and caps its fill without hiding overage', () => {
  const state = sessionState();
  state.context.percent = 0;
  assert.match(renderHud(state, plainOptions), /\[░{10}\] 0%/);
  state.context.percent = 100;
  assert.match(renderHud(state, plainOptions), /\[█{10}\] 100%/);
  state.context.percent = 125;
  assert.match(renderHud(state, plainOptions), /\[█{10}\] 125%/);
});

test('duration uses the supplied clock and stops at a terminal session status', () => {
  const state = sessionState();
  assert.match(renderHud(state, { ...plainOptions, now: NOW + 1000 }), /Session 12m 35s/);
  state.session.status = 'complete';
  assert.match(renderHud(state, { ...plainOptions, now: NOW + 100_000 }), /Session 12m 24s/);
  state.session.status = 'interrupted';
  assert.match(renderHud(state, { ...plainOptions, now: NOW + 100_000 }), /Session 12m 24s/);

  state.session.status = 'working';
  state.session.startedAt = 0;
  assert.match(renderHud(state, { ...plainOptions, now: 0 }), /Session 0s/);
  state.session.startedAt = NOW + 1000;
  assert.doesNotMatch(renderHud(state, plainOptions), /-\d+[smhd]/);
  state.session.startedAt = null;
  assert.match(renderHud(state, plainOptions), /Session —/);
});

test('Git details distinguish changes, a clean tree, missing data and an explicit opt-out', () => {
  const state = sessionState();
  for (const preset of ['full', 'essential', 'minimal']) {
    const options = { ...plainOptions, preset, width: 240 };
    state.git = { branch: 'feature/hud', dirty: true, changed: 3, untracked: 1, ahead: 2, behind: 1 };
    const changed = lines(renderHud(state, options))[0];
    assert.match(changed, /my-codex-hud \[Git feature\/hud\* changed 3 untracked 1 ↑2 ↓1\]/);
    assert.doesNotMatch(changed, /clean/);

    state.git = { branch: 'main', dirty: false, changed: 0, untracked: 0, ahead: 0, behind: 0 };
    const clean = lines(renderHud(state, options))[0];
    assert.match(clean, /my-codex-hud \[Git main clean\]/);
    assert.doesNotMatch(clean, /changed 0|untracked 0|\*/);
    assert.doesNotMatch(renderHud(state, { ...options, git: false }), /\[Git /);

    state.git = null;
    assert.match(lines(renderHud(state, options))[0], /my-codex-hud \[Git —\]/);
    assert.doesNotMatch(renderHud(state, { ...options, git: false }), /\[Git /);
  }
});

test('compact presets stay bounded while full includes individual agents', () => {
  for (const [preset, maximum] of [['full', 8], ['essential', 5], ['minimal', 2]]) {
    const output = renderHud(sessionState(), { ...plainOptions, preset });
    assert.ok(lines(output).length <= maximum, preset);
    assert.match(output, /gpt-5-codex/);
    assert.match(output, /25%/);
    assert.match(output, /12\.5%/);
    assert.match(output, /900k/);
    assert.match(output, /12m 34s/);
    if (preset === 'essential') {
      assert.match(output, /Tools/);
      assert.match(output, /Agents/);
      assert.match(output, /Plan 1\/3/);
      assert.match(output, /src\/render\.js/);
    }
  }
});

test('full lists only running agents with localized status while preserving retained history', () => {
  const state = sessionState();
  const statuses = ['completed', 'running', 'error', 'interrupted', 'closed'];
  state.agents = Array.from({ length: 40 }, (_, index) => ({
    id: `id-${index}`, name: `Agent-${String(index).padStart(2, '0')}`,
    role: 'worker', status: statuses[index % statuses.length],
  }));
  const original = structuredClone(state);
  for (const [language, label] of [['en', 'running'], ['ko', '실행 중']]) {
    for (const ascii of [false, true]) {
      const output = renderHud(state, { ...plainOptions, language, ascii });
      const detail = lines(output).filter(line => /Agent-\d{2}/.test(line));
      assert.equal(detail.length, 8);
      for (const agent of state.agents) {
        const matches = detail.filter(line => line.includes(agent.name));
        assert.equal(matches.length, agent.status === 'running' ? 1 : 0, agent.name);
        if (matches.length) {
          assert.ok(matches[0].includes(label), matches[0]);
          assert.ok(matches[0].includes('(worker)'), matches[0]);
        }
      }
      assert.match(detail[0], /Agent-01/);
      assert.match(detail[7], /Agent-36/);
      const summary = lines(output).find(line => /^(?:Agents|에이전트) /.test(line));
      assert.equal(summary, `${language === 'ko' ? '에이전트' : 'Agents'} 8 ${label}`);
      if (language === 'en' && ascii) assert.doesNotMatch(output, /[^\x20-\x7e\n]/);
    }
  }
  assert.deepEqual(state, original);
});

test('agent sections disappear when nobody is running and return when an agent resumes', () => {
  const state = sessionState();
  state.agents = ['completed', 'error', 'interrupted', 'closed', 'unknown'].map(status => ({
    id: `agent-${status}`, name: `Agent-${status}`, status,
  }));
  for (const preset of ['full', 'essential']) {
    for (const language of ['en', 'ko']) {
      const options = { ...plainOptions, preset, language, width: 240 };
      assert.doesNotMatch(renderHud(state, options), /Agents|에이전트|Agent-/);
      state.agents[0].status = 'running';
      const active = renderHud(state, options);
      assert.match(active, /(?:Agents|에이전트) (?:1 (?:running|실행 중)|▶1)/);
      if (preset === 'full') assert.match(active, /Agent-completed/);
      state.agents[0].status = 'closed';
      assert.doesNotMatch(renderHud(state, options), /Agents|에이전트|Agent-/);
    }
  }
});

test('individual agents fall back to role or ID when no nickname is recorded', () => {
  const state = sessionState();
  state.agents = [
    { id: 'first-id', role: 'explorer', status: 'running' },
    { id: 'second-id', status: 'running' },
  ];
  const output = renderHud(state, plainOptions);
  assert.match(output, /running[^\n]*explorer/);
  assert.match(output, /running[^\n]*second-id/);
  assert.doesNotMatch(output, /explorer \(explorer\)/);
});

test('essential keeps the running target and plan visible at a typical 80 columns', () => {
  for (const language of ['en', 'ko']) {
    const output = renderHud(sessionState(), { ...plainOptions, width: 80, preset: 'essential', language });
    assert.match(output, /exec_command src\/render\.js/);
    assert.match(output, /1\/3/);
    assert.ok(lines(output).length <= 5);
  }
});

test('minimal includes live reset countdowns when there is room for its summary', () => {
  const state = sessionState();
  const first = renderHud(state, { ...plainOptions, preset: 'minimal' });
  const later = renderHud(state, { ...plainOptions, preset: 'minimal', now: NOW + 1000 });
  assert.match(first, /1h\s?30m/);
  assert.match(first, /30s/);
  assert.match(later, /29s/);
});

test('empty optional activity rows disappear, completed plans remain meaningful', () => {
  const state = sessionState();
  state.tools = [];
  state.agents = [];
  state.plan = [];
  const output = renderHud(state, plainOptions);
  assert.ok(lines(output).length <= 4);
  assert.doesNotMatch(output, /Tools|Agents|Plan/);
  state.plan = [{ step: 'Ship', status: 'completed' }];
  assert.match(renderHud(state, plainOptions), /Plan 1\/1[^\n]*done/);
});

test('tools retain lifecycle counts while agents show only running work', () => {
  const state = sessionState();
  state.tools.push(
    { id: 't4', name: 'exec_command', target: 'previous', status: 'interrupted' },
    { id: 't5', name: 'exec_command', target: 'closed-target', status: 'closed' },
  );
  state.agents.push(
    { id: 'a3', name: 'failed-agent', status: 'error' },
    { id: 'a4', name: 'stopped-agent', status: 'interrupted' },
    { id: 'a5', name: 'closed-agent', status: 'closed' },
  );
  const output = renderHud(state, { ...plainOptions, width: 220 });
  const tools = lines(output).find(value => value.startsWith('Tools'));
  assert.match(tools, /1 running.*1 done.*1 error.*1 interrupted.*1 closed/);
  assert.equal(lines(output).find(value => value.startsWith('Agents')), 'Agents 1 running');
  assert.doesNotMatch(output, /builder|failed-agent|stopped-agent|closed-agent/);
  assert.doesNotMatch(output, /previous|closed-target/);
});

test('project path depth is bounded and supports POSIX and Windows paths', () => {
  const state = sessionState();
  assert.match(lines(renderHud(state, { ...plainOptions, pathLevels: 1 }))[0], /my-codex-hud/);
  assert.doesNotMatch(lines(renderHud(state, { ...plainOptions, pathLevels: 1 }))[0], /dev\//);
  assert.match(lines(renderHud(state, { ...plainOptions, pathLevels: 2 }))[0], /dev\/my-codex-hud/);
  assert.match(lines(renderHud(state, { ...plainOptions, pathLevels: 3 }))[0], /home\/dev\/my-codex-hud/);
  state.session.cwd = 'C:\\work\\my-codex-hud\\';
  assert.match(lines(renderHud(state, { ...plainOptions, pathLevels: 2 }))[0], /work\/my-codex-hud/);
});

test('Korean labels cover usage, activity, session status, and waiting', () => {
  const output = renderHud(sessionState(), { ...plainOptions, language: 'ko', width: 200 });
  for (const label of ['컨텍스트', '사용량', '토큰', '도구', '에이전트', '계획', '압축', '작업 중']) {
    assert.ok(output.includes(label), label);
  }
  assert.match(output, /gpt-5-codex/);
  assert.doesNotMatch(output, /Context|Tokens|Tools|Agents|working|running|reset/);
  assert.match(renderWaiting({ ...plainOptions, language: 'ko' }), /대기/);
});

test('color uses cyan model, muted labels, and threshold colors without changing text', () => {
  const state = sessionState();
  for (const [percent, code] of [[25, 32], [75, 33], [95, 31]]) {
    state.context.percent = percent;
    state.rateLimits.primary.usedPercent = percent;
    const colored = renderHud(state, { ...plainOptions, color: true });
    assert.match(colored, /\x1b\[36mgpt-5-codex\x1b\[0m/);
    assert.match(colored, /\x1b\[2mContext /);
    const context = lines(colored).find((line) => stripSgr(line).startsWith('Context '));
    const usage = lines(colored).find((line) => stripSgr(line).startsWith('Usage '));
    assert.ok(context.includes(`\x1b[${code}m${percent}%`), context);
    assert.ok(usage.includes(`\x1b[${code}m${percent}%`), usage);
    assert.equal(stripSgr(colored), renderHud(state, plainOptions));
    assert.doesNotMatch(stripSgr(colored), /\x1b/);
  }
});

test('ASCII option replaces decorative glyphs without destroying user Unicode', () => {
  const state = sessionState();
  const output = renderHud(state, { ...plainOptions, ascii: true });
  assert.match(output, /\[#+-+\]/);
  assert.doesNotMatch(output, /[^\x20-\x7e\n]/);
  state.session.cwd = '/work/한글';
  assert.match(renderHud(state, { ...plainOptions, ascii: true }), /한글/);
});

test('untrusted values cannot inject rows, ANSI styles, OSC payloads, or bidi controls', () => {
  const attack = '\x1b[35mSAFE\x1b[0m\x1b]52;c;SECRET_PAYLOAD\x07\nnext\u202e';
  const state = sessionState();
  state.session.model = attack;
  state.session.effort = attack;
  state.session.cwd = `/work/${attack}`;
  state.session.status = attack;
  state.session.approvalPolicy = attack;
  state.session.approvalsReviewer = attack;
  state.git.branch = attack;
  state.tools[1].name = attack;
  state.tools[1].target = attack;
  state.agents[0].name = attack;
  state.agents[0].role = attack;
  state.agents[0].model = attack;
  state.skills = [{ name: attack }];
  state.plugins = [{ name: attack, version: attack, marketplace: attack }];
  state.plan[1].step = attack;
  state.rateLimits.planType = attack;
  for (const color of [false, true]) {
    const output = renderHud(state, { ...plainOptions, color, width: 500 });
    assert.equal(lines(output).length, 11);
    assert.doesNotMatch(output, /SECRET_PAYLOAD|\u202e|\x1b\[35m/);
    assert.doesNotMatch(stripSgr(output), /[\x00-\x09\x0b-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/);
  }
});

test('renderer only uses compact activity metadata, never raw commands or tool payloads', () => {
  const state = sessionState();
  Object.assign(state.tools[1], {
    arguments: '{"command":"PRIVATE_RAW_COMMAND"}',
    command: 'PRIVATE_RAW_COMMAND',
    output: 'PRIVATE_TOOL_OUTPUT',
  });
  state.session.path = 'PRIVATE_ROLLOUT_PATH';
  const output = renderHud(state, plainOptions);
  assert.match(output, /src\/render\.js/);
  assert.doesNotMatch(output, /PRIVATE_/);
});

test('every preset and waiting view obey cell widths down to one in both languages', () => {
  const state = sessionState();
  state.session.model = '👩🏽‍💻모델e\u0301';
  state.session.cwd = '/work/漢字🇰🇷';
  state.git.branch = '기능/👨‍👩‍👧‍👦';
  state.tools[1].target = '한글/1️⃣.js';
  state.agents[0].name = '검토👩🏽‍💻';
  state.session.approvalPolicy = 'on-request';
  state.session.approvalsReviewer = 'auto_review';
  state.skills = [{ name: '스킬👩🏽‍💻' }];
  state.plugins = [{ name: '플러그인👩🏽‍💻', version: '1.2.0', marketplace: '한글' }];
  state.plan[1].step = '한글과 e\u0301 검증';
  for (const language of ['en', 'ko']) {
    for (const preset of ['full', 'essential', 'minimal']) {
      for (const width of [1, 2, 3, 4, 5, 8, 12, 20, 40, 60, 80]) {
        for (const color of [false, true]) {
          const options = { ...plainOptions, language, preset, width, color };
          for (const output of [renderHud(state, options), renderWaiting(options)]) {
            assert.ok(output.length > 0);
            for (const line of lines(output)) {
              assert.ok(displayWidth(line) <= width, JSON.stringify({ width, language, preset, line }));
              assert.doesNotMatch(stripSgr(line), /\ud83c$|\ud83d$|\u200d$/u);
            }
          }
        }
      }
    }
  }
  assert.equal(renderHud(state, { ...plainOptions, width: 0 }), '');
  assert.equal(renderWaiting({ ...plainOptions, width: 0 }), '');
});

test('clipped colored lines reset their own styles and do not emit incomplete escapes', () => {
  for (const width of [1, 5, 15, 30, 79]) {
    const output = renderHud(sessionState(), { ...plainOptions, color: true, width });
    for (const line of lines(output)) {
      assert.doesNotMatch(stripSgr(line), /\x1b/);
      const codes = [...line.matchAll(/\x1b\[([\d;]*)m/g)].map((match) => match[1]);
      if (codes.length) assert.equal(codes.at(-1), '0', 'the last SGR restores default styling');
    }
    assert.equal(stripSgr(output), renderHud(sessionState(), { ...plainOptions, width }));
  }
});

test('waiting rendering is compact, localized, color optional, and unavailable-safe', () => {
  const output = renderWaiting(plainOptions);
  assert.match(output, /Codex/);
  assert.match(output, /waiting/i);
  assert.ok(lines(output).length <= 2);
  assert.doesNotMatch(output, /0%|undefined|null|\x1b/);
  const ascii = renderWaiting({ ...plainOptions, ascii: true });
  assert.doesNotMatch(ascii, /[^\x20-\x7e\n]/);
});

test('rendering leaves the supplied state and options unchanged', () => {
  const state = sessionState();
  const options = { ...plainOptions };
  const originalState = structuredClone(state);
  const originalOptions = structuredClone(options);
  const first = renderHud(state, options);
  assert.equal(renderHud(state, options), first);
  assert.deepEqual(state, originalState);
  assert.deepEqual(options, originalOptions);
});
