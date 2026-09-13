import { displayWidth, sanitizeText, truncateText } from './terminal.js';

const LABELS = {
  en: {
    model: 'model', project: 'project', context: 'Context', contextCompact: 'Ctx', usage: 'Usage',
    tokens: 'Tokens', input: 'in', cached: 'cache', output: 'out', reasoning: 'reason',
    tools: 'Tools', agents: 'Agents', plan: 'Plan', compactions: 'compactions',
    approval: 'Approval', skills: 'Skills', loadedSkills: 'Loaded skills',
    plugins: 'Plugins', usedPlugins: 'Used plugins',
    session: 'Session', clean: 'clean', changed: 'changed', untracked: 'untracked',
    selection: 'Text selection', copyHint: 'drag, then copy', resume: 'resume',
    primary: 'primary', secondary: 'secondary', reset: 'reset', now: 'now',
    unavailable: 'unavailable', waiting: 'waiting for a Codex session',
    idle: 'idle', working: 'working', complete: 'complete', interrupted: 'interrupted',
    running: 'running', completed: 'done', error: 'error', closed: 'closed',
    pending: 'pending', day: 'd', hour: 'h', minute: 'm', second: 's',
  },
  ko: {
    model: '모델', project: '프로젝트', context: '컨텍스트', contextCompact: '문맥', usage: '사용량',
    tokens: '토큰', input: '입력', cached: '캐시', output: '출력', reasoning: '추론',
    tools: '도구', agents: '에이전트', plan: '계획', compactions: '압축',
    approval: '승인', skills: '스킬', loadedSkills: '로드한 스킬',
    plugins: '플러그인', usedPlugins: '사용한 플러그인',
    session: '세션', clean: '변경 없음', changed: '변경', untracked: '미추적',
    selection: '선택 모드', copyHint: '드래그 후 복사', resume: '돌아가기',
    primary: '기본', secondary: '보조', reset: '초기화', now: '지금',
    unavailable: '정보 없음', waiting: 'Codex 세션 대기 중',
    idle: '대기', working: '작업 중', complete: '완료', interrupted: '중단',
    running: '실행 중', completed: '완료', error: '오류', closed: '종료',
    pending: '예정', day: '일', hour: '시간', minute: '분', second: '초',
  },
};

// Only these renderer-owned SGR codes can reach the output.
const SGR = { muted: 2, cyan: 36, green: 32, yellow: 33, red: 31 };
const STATUSES = ['running', 'completed', 'error', 'interrupted', 'closed'];
const STATUS_TONE = {
  idle: 'muted', working: 'yellow', complete: 'green', interrupted: 'yellow',
  running: 'cyan', completed: 'green', error: 'red', closed: 'muted',
};
const STATUS_SYMBOL = {
  running: '▶', completed: '✓', error: '!', interrupted: '×', closed: '○',
};
const ASCII_STATUS_SYMBOL = {
  running: '>', completed: '+', error: '!', interrupted: '~', closed: 'o',
};

const knownNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const field = (value) => sanitizeText(value).replace(/\s+/gu, ' ').trim();
const span = (value, tone) => ({ text: sanitizeText(value), tone });
const label = (value) => span(`${value} `, 'muted');

function settings(options) {
  const input = options ?? {};
  return {
    preset: ['full', 'essential', 'minimal'].includes(input.preset) ? input.preset : 'full',
    width: Number.isFinite(input.width) ? Math.max(0, Math.floor(input.width)) : 80,
    color: input.color !== false,
    ascii: input.ascii === true,
    git: input.git !== false,
    labels: LABELS[input.language === 'ko' ? 'ko' : 'en'],
    pathLevels: [1, 2, 3].includes(input.pathLevels) ? input.pathLevels : 1,
    now: Number.isFinite(input.now) ? input.now : Date.now(),
    missing: input.ascii === true ? '--' : '—',
    separator: input.ascii === true ? ' | ' : ' · ',
    ellipsis: input.ascii === true ? '.' : '…',
  };
}

function join(groups, options) {
  const result = [];
  for (const group of groups.filter((value) => value?.length)) {
    if (result.length) result.push(span(options.separator, 'muted'));
    result.push(...group);
  }
  return result;
}

function paint(piece, color) {
  const code = SGR[piece.tone];
  return color && code && piece.text ? `\x1b[${code}m${piece.text}\x1b[0m` : piece.text;
}

function renderLine(pieces, options) {
  const text = pieces.map((piece) => piece.text).join('');
  const clipped = displayWidth(text) > options.width;
  const prefix = clipped
    ? truncateText(text, options.width - 1, '').trimEnd()
    : text.trimEnd();
  let remaining = prefix.length;
  let output = '';
  for (const piece of pieces) {
    if (remaining <= 0) break;
    const part = piece.text.slice(0, remaining);
    output += paint({ ...piece, text: part }, options.color);
    remaining -= part.length;
  }
  if (clipped) output += paint(span(options.ellipsis, 'muted'), options.color);
  return output;
}

function compactNumber(value, options) {
  if (!knownNumber(value)) return options.missing;
  // Round only the display, never the underlying reported count.
  for (const [size, suffix] of [[1e9, 'b'], [1e6, 'm'], [1e3, 'k']]) {
    if (value >= size) return `${Number((value / size).toFixed(1))}${suffix}`;
  }
  return String(Math.round(value));
}

function percent(value, options) {
  return knownNumber(value) ? `${Number(value.toFixed(1))}%` : options.missing;
}

function usageTone(value) {
  if (!knownNumber(value)) return 'muted';
  return value >= 90 ? 'red' : value >= 70 ? 'yellow' : 'green';
}

function duration(seconds, labels) {
  const safe = Math.max(0, Math.floor(seconds));
  if (safe >= 86400) return `${Math.floor(safe / 86400)}${labels.day} ${Math.floor(safe % 86400 / 3600)}${labels.hour}`;
  if (safe >= 3600) return `${Math.floor(safe / 3600)}${labels.hour} ${Math.floor(safe % 3600 / 60)}${labels.minute}`;
  if (safe >= 60) return `${Math.floor(safe / 60)}${labels.minute} ${safe % 60}${labels.second}`;
  return `${safe}${labels.second}`;
}

function elapsed(session, options) {
  if (!knownNumber(session.startedAt)) return options.missing;
  const finished = session.status === 'complete' || session.status === 'interrupted';
  const end = finished && knownNumber(session.updatedAt) ? session.updatedAt : options.now;
  return duration((end - session.startedAt) / 1000, options.labels);
}

function projectPath(cwd, options) {
  const path = field(cwd);
  if (!path) return `${options.labels.project} ${options.missing}`;
  const parts = path.split(/[/\\]+/u).filter(Boolean);
  return parts.length ? parts.slice(-options.pathLevels).join('/') : '/';
}

function approvalGroup(session, options) {
  const policy = field(session.approvalPolicy);
  const reviewer = ['auto_review', 'guardian_subagent'].includes(session.approvalsReviewer)
    ? 'auto-review' : session.approvalsReviewer === 'user' ? 'user' : '';
  const mode = policy === 'never' ? 'never'
    : reviewer && policy ? `${reviewer} (${policy})` : reviewer || policy || options.missing;
  return [label(options.labels.approval), span(mode, 'cyan')];
}

function projectGroup(state, options) {
  const group = [span(projectPath(state.session?.cwd, options))];
  if (!options.git) return group;
  group.push(span(' [Git ', 'muted'));
  const git = state.git;
  if (git) {
    const branch = field(git.branch) || options.missing;
    group.push(span(`${branch}${git.dirty === true ? '*' : ''}`, git.dirty ? 'yellow' : 'muted'));
    if (git.dirty === false) group.push(span(` ${options.labels.clean}`, 'green'));
    for (const key of ['changed', 'untracked']) {
      if (knownNumber(git[key]) && git[key] > 0) {
        group.push(span(` ${options.labels[key]} ${git[key]}`, 'yellow'));
      }
    }
    if (knownNumber(git.ahead) && git.ahead > 0) group.push(span(` ${options.ascii ? '+' : '↑'}${git.ahead}`, 'green'));
    if (knownNumber(git.behind) && git.behind > 0) group.push(span(` ${options.ascii ? '-' : '↓'}${git.behind}`, 'yellow'));
  } else {
    group.push(span(options.missing, 'muted'));
  }
  group.push(span(']', 'muted'));
  return group;
}

function header(state, options) {
  const session = state.session ?? {};
  const model = field(session.model) || `${options.labels.model} ${options.missing}`;
  const modelGroup = [span(model, 'cyan')];
  const effort = field(session.effort);
  if (effort) modelGroup.push(span(` ${effort}`, 'muted'));
  const groups = [modelGroup, approvalGroup(session, options), projectGroup(state, options)];
  const status = options.labels[session.status];
  groups.push([span(typeof status === 'string' ? status : options.missing, STATUS_TONE[session.status] ?? 'muted')]);
  return join(groups, options);
}

function contextRow(state, options, compact = false) {
  const context = state.context ?? {};
  const tone = usageTone(context.percent);
  const result = [label(compact ? options.labels.contextCompact : options.labels.context)];
  if (knownNumber(context.percent)) {
    const length = compact ? 4 : 10;
    const filled = Math.round(Math.min(100, context.percent) / 100 * length);
    result.push(
      span('[', 'muted'),
      span((options.ascii ? '#' : '█').repeat(filled), tone),
      span((options.ascii ? '-' : '░').repeat(length - filled), 'muted'),
      span('] ', 'muted'),
    );
  }
  result.push(span(percent(context.percent, options), tone));
  if (compact) return result;

  const groups = [
    result,
    [span(`${compactNumber(context.usedTokens, options)}/${compactNumber(context.windowTokens, options)}`, 'muted')],
  ];
  if (knownNumber(state.compactions)) {
    groups.push([label(options.labels.compactions), span(String(state.compactions), 'muted')]);
  }
  return join(groups, options);
}

function windowName(minutes, fallback, options) {
  if (!knownNumber(minutes)) return fallback;
  const labels = options.labels;
  if (minutes > 0 && minutes % 1440 === 0) return `${minutes / 1440}${labels.day}`;
  if (minutes > 0 && minutes % 60 === 0) return `${minutes / 60}${labels.hour}`;
  return `${minutes}${labels.minute}`;
}

function resetIn(resetsAt, options) {
  if (!knownNumber(resetsAt)) return options.missing;
  const seconds = Math.ceil(resetsAt - options.now / 1000);
  return seconds <= 0 ? options.labels.now : duration(seconds, options.labels);
}

function usageGroups(state, options, compact = false) {
  const limits = state.rateLimits ?? {};
  const groups = [];
  for (const key of ['primary', 'secondary']) {
    const window = limits[key];
    if (!window) continue;
    const group = [
      label(windowName(window.windowMinutes, options.labels[key], options)),
      span(percent(window.usedPercent, options), usageTone(window.usedPercent)),
    ];
    const reset = resetIn(window.resetsAt, options);
    group.push(span(compact
      ? ` ${options.ascii ? '~' : '↻'}${reset.replaceAll(' ', '')}`
      : ` (${options.labels.reset} ${reset})`, 'muted'));
    groups.push(group);
  }
  return groups.length ? groups : [[span(options.labels.unavailable, 'muted')]];
}

function usageRow(state, options) {
  const result = [label(options.labels.usage), ...join(usageGroups(state, options), options)];
  const planType = field(state.rateLimits?.planType);
  if (planType) result.push(span(` ${options.separator.trim()} ${planType}`, 'muted'));
  return result;
}

function tokenRow(state, options, compact = false) {
  const tokens = state.tokens ?? {};
  const groups = [
    [label(options.labels.tokens), span(compactNumber(tokens.total, options))],
    [label(options.labels.session), span(elapsed(state.session ?? {}, options), 'muted')],
  ];
  if (!compact) {
    for (const key of ['input', 'output', 'cached', 'reasoning']) {
      groups.push([label(options.labels[key]), span(compactNumber(tokens[key], options))]);
    }
  }
  return join(groups, options);
}

function items(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : [];
}

function counts(activity, options, compact = false) {
  const result = [];
  for (const status of STATUSES) {
    const count = activity.filter((item) => item.status === status).length;
    if (count || (!compact && (status === 'running' || status === 'completed'))) {
      const symbol = (options.ascii ? ASCII_STATUS_SYMBOL : STATUS_SYMBOL)[status];
      result.push([span(compact ? `${symbol}${count}` : `${count} ${options.labels[status]}`, STATUS_TONE[status])]);
    }
  }
  return join(result, compact ? { ...options, separator: ' ' } : options);
}

function activeTool(tools) {
  const tool = tools.findLast((item) => item.status === 'running');
  if (!tool) return [];
  const name = field(tool.name);
  const target = field(tool.target);
  return [span([name, target].filter(Boolean).join(' '), 'cyan')];
}

function toolRow(tools, options) {
  if (!tools.length) return null;
  return [label(options.labels.tools), ...join([counts(tools, options), activeTool(tools)], options)];
}

function agentRows(agents, options) {
  if (!agents.length) return [];
  const symbols = options.ascii ? ASCII_STATUS_SYMBOL : STATUS_SYMBOL;
  return [
    [label(options.labels.agents), span(`${agents.length} ${options.labels.running}`, STATUS_TONE.running)],
    ...agents.map(agent => {
      const name = field(agent.name) || field(agent.role) || field(agent.id) || options.missing;
      const role = field(agent.role);
      const status = STATUSES.includes(agent.status) ? agent.status : null;
      const detail = [span(name, 'cyan')];
      if (role && role !== name) detail.push(span(` (${role})`, 'muted'));
      return [
        span('  '),
        ...join([
          [span(`${symbols[status] ?? '?'} ${options.labels[status] ?? options.labels.unavailable}`, STATUS_TONE[status])],
          detail,
        ], options),
      ];
    }),
  ];
}

function skillRow(skills, options) {
  if (!skills.length) return null;
  return [
    label(options.labels.loadedSkills), span(String(skills.length), 'cyan'),
    span(options.separator, 'muted'),
    ...join([...skills].reverse().map(skill => [
      span(field(skill.name) || options.missing, 'cyan'),
    ]), { ...options, separator: ', ' }),
  ];
}

function pluginRows(plugins, options) {
  if (!plugins.length) return [];
  return [
    [label(options.labels.usedPlugins), span(String(plugins.length), 'cyan')],
    ...[...plugins].reverse().map(plugin => {
      const version = field(plugin.version);
      const marketplace = field(plugin.marketplace);
      return [
        span(`  ${options.ascii ? '-' : '·'} `, 'muted'), span(field(plugin.name) || options.missing, 'cyan'),
        span(version ? ` v${version}` : '', 'muted'),
        span(marketplace ? `${options.separator}${marketplace}` : '', 'muted'),
      ];
    }),
  ];
}

function planRow(plan, options, compact = false) {
  if (!plan.length) return null;
  const complete = plan.filter((item) => item.status === 'completed').length;
  const result = [label(options.labels.plan), span(`${complete}/${plan.length}`, complete === plan.length ? 'green' : 'cyan')];
  if (!compact) {
    const current = plan.find((item) => item.status === 'in_progress') ?? plan.find((item) => item.status === 'pending');
    result.push(span(options.separator, 'muted'));
    result.push(span(current ? field(current.step) || options.labels.pending : options.labels.completed, 'muted'));
  }
  return result;
}

function essentialActivity(tools, agents, skills, plugins, plan, options) {
  const groups = [];
  if (tools.length) groups.push([label(options.labels.tools), ...counts(tools, options, true)]);
  if (skills.length) groups.push([label(options.labels.skills), span(String(skills.length), 'cyan')]);
  if (plugins.length) groups.push([label(options.labels.plugins), span(String(plugins.length), 'cyan')]);
  if (agents.length) groups.push([label(options.labels.agents), ...counts(agents, options, true)]);
  groups.push(planRow(plan, options, true), activeTool(tools));
  return join(groups, options);
}

/**
 * renderHud(state, options = {}) -> string; never writes to the terminal.
 * Options: preset ('full' includes running agents/skills/plugins, 'essential' <=5, 'minimal' <=2), width
 * (maximum terminal cells, default 80), color (default true), ascii (false),
 * language ('en' or 'ko', default 'en'), pathLevels (1..3, default 1), and now
 * (epoch milliseconds, default Date.now()). Rate-limit resetsAt is Unix seconds.
 * git (default true) includes Git details or an unavailable marker next to the project.
 * Explicit width 0 returns ''. Missing measurements stay visibly unavailable.
 */
export function renderHud(state, options = {}) {
  const config = settings(options);
  if (!config.width) return '';
  if (!state) return renderWaiting(options);
  const tools = items(state.tools);
  const agents = items(state.agents).filter(agent => agent.status === 'running');
  const skills = items(state.skills);
  const plugins = items(state.plugins);
  const plan = items(state.plan);
  let rows;
  if (config.preset === 'minimal') {
    rows = [
      header(state, config),
      join([contextRow(state, config, true), ...usageGroups(state, config, true), tokenRow(state, config, true)], config),
    ];
  } else {
    rows = [header(state, config), contextRow(state, config), usageRow(state, config), tokenRow(state, config)];
    if (config.preset === 'essential') {
      rows.push(essentialActivity(tools, agents, skills, plugins, plan, config));
    } else {
      rows.push(
        toolRow(tools, config), skillRow(skills, config), ...pluginRows(plugins, config),
        ...agentRows(agents, config), planRow(plan, config),
      );
    }
  }
  return rows.filter((row) => row?.length).map((row) => renderLine(row, config)).join('\n');
}

/** renderWaiting(options = {}) -> one safe, width-bounded line; same options. */
export function renderWaiting(options = {}) {
  const config = settings(options);
  if (!config.width) return '';
  return renderLine(join([[span('Codex HUD', 'cyan')], [span(config.labels.waiting, 'muted')]], config), config);
}

/** A width-bounded hint shown while native terminal text selection is enabled. */
export function renderSelectionHint(options = {}) {
  const config = settings(options);
  if (!config.width) return '';
  return renderLine(join([
    [span(config.labels.selection, 'cyan')],
    [span(`Alt+M: ${config.labels.resume}`, 'muted')],
    [span(config.labels.copyHint, 'muted')],
  ], config), config);
}
