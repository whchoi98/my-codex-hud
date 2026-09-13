import { posix } from 'node:path';

const READ_TOOLS = new Set(['read_file', 'read_text_file', 'read_multiple_files', 'read_resource', 'read_mcp_resource']);
const SHELL_TOOLS = new Set(['exec_command', 'shell', 'shell_command']);
const READ_COMMANDS = new Set(['cat', 'sed', 'head', 'tail', 'get-content']);
const MAX_SKILLS = 40;
const MAX_PLUGINS = 40;
const NAME = /^[\p{L}\p{N}_][\p{L}\p{N}_.:-]{0,99}$/u;

const basename = value => typeof value === 'string' ? value.replaceAll('\\', '/').split('/').at(-1) : '';

function skillForPath(path, cwd) {
  if (typeof path !== 'string' || path.length > 4096) return null;
  path = path.replaceAll('\\', '/');
  if (!path.startsWith('/') && !/^[a-z]:\//i.test(path) && typeof cwd === 'string') path = posix.join(cwd.replaceAll('\\', '/'), path);
  path = posix.normalize(path);
  const name = /(?:^|\/)([^/]+)\/(?:\.\/)?SKILL\.md$/i.exec(path)?.[1];
  if (!name || !NAME.test(name)) return null;
  const cached = /(?:^|\/)plugins\/cache\/([^/]+)\/([^/]+)\/([^/]+)\/skills\/.+\/SKILL\.md$/i.exec(path);
  const plugin = cached && NAME.test(cached[1]) && NAME.test(cached[2])
    && /^[a-z0-9][a-z0-9_.+-]{0,99}$/i.test(cached[3])
    ? { name: cached[2], marketplace: cached[1], version: cached[3] } : null;
  return { name, plugin };
}

// Only inspect literal read commands. Never execute shell text or interpret
// substitutions, pipelines, redirections, or conditional &&/|| command chains.
function shellCommands(text) {
  const commands = [];
  let words = [];
  let word = '';
  let started = false;
  let quote = '';
  const finishWord = () => {
    if (started) words.push(word);
    word = '';
    started = false;
  };
  const finishCommand = () => {
    finishWord();
    if (words.length) commands.push(words);
    words = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = '';
      else if (quote === '"' && char === '\\' && /["\\$`\n]/.test(text[index + 1] ?? '')) word += text[++index];
      else {
        if (quote === '"' && (char === '`' || (char === '$' && text[index + 1] === '('))) return [];
        word += char;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (char === '\\') {
      if (index + 1 >= text.length) return [];
      const next = text[++index];
      if (next !== '\n') { word += next; started = true; }
    } else if (char === '#' && !started) {
      while (index + 1 < text.length && text[index + 1] !== '\n') index += 1;
    } else if (char === ';' || char === '\n') finishCommand();
    else if (/\s/u.test(char)) finishWord();
    else {
      if (/[|&<>(){}`]/.test(char)) return [];
      word += char;
      started = true;
    }
  }
  if (quote) return [];
  finishCommand();
  return commands;
}

function readOperands(words) {
  if (words[0] === 'command') words = words.slice(1);
  const program = basename(words[0]).toLowerCase();
  if (!READ_COMMANDS.has(program)) return [];
  const args = words.slice(1);
  if (args.some(arg => ['--help', '--version', '-?'].includes(arg))) return [];
  if (program !== 'sed') return args;
  if (args.some(arg => /^--in-place(?:=|$)|^-[^-]*i/.test(arg))) return [];
  let script = false;
  const files = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (['-e', '-f', '--expression', '--file'].includes(arg)) { script = true; index += 1; }
    else if (/^-[ef].|^--(?:expression|file)=/.test(arg)) script = true;
    else if (arg.startsWith('-')) continue;
    else if (!script) script = true;
    else files.push(arg);
  }
  return files;
}

function rememberLatest(entries, key, value, limit) {
  entries.delete(key);
  entries.set(key, value);
  if (entries.size > limit) entries.delete(entries.keys().next().value);
}

export function skillsForTool(name, args, cwd) {
  name = name.split(/__|[/.]/).at(-1);
  cwd = args.workdir ?? args.cwd ?? cwd;
  let paths = [];
  if (READ_TOOLS.has(name)) {
    paths = [args.file_path, args.path, args.filename, args.uri, ...(Array.isArray(args.paths) ? args.paths : [])];
  } else if (SHELL_TOOLS.has(name)) {
    let command = args.cmd ?? args.command;
    let commands;
    if (Array.isArray(command) && command.every(arg => typeof arg === 'string')) {
      const flag = command.findIndex(arg => ['-c', '-lc', '-ic'].includes(arg));
      if (['bash', 'zsh', 'sh'].includes(basename(command[0])) && flag >= 0) command = command[flag + 1];
      else commands = [command];
    }
    if (!commands && typeof command === 'string') commands = shellCommands(command);
    let depth = 0;
    let errexit = false;
    let cwdChanged = false;
    for (const [index, rawWords] of (commands ?? []).entries()) {
      const words = rawWords[0] === 'command' ? rawWords.slice(1) : rawWords;
      const first = words[0];
      const effect = [...words];
      while (['command', 'if', 'elif', 'while', 'until', 'then', 'else', 'do', '!'].includes(effect[0])) effect.shift();
      if (['cd', 'pushd', 'popd', 'source', '.', 'eval'].includes(effect[0])) cwdChanged = true;
      if (['source', '.', 'eval', 'trap'].includes(effect[0])) errexit = false;
      if (['exit', 'return', 'exec'].includes(first)) break;
      if (['if', 'for', 'while', 'until', 'case', 'select'].includes(first)) { depth += 1; errexit = false; continue; }
      if (['fi', 'done', 'esac'].includes(first)) { depth = Math.max(0, depth - 1); continue; }
      if (first === 'set') {
        errexit = !depth && ((words.length === 2 && words[1] === '-e')
          || (words.length === 3 && words[1] === '-o' && words[2] === 'errexit'));
        continue;
      }
      // A shell result proves only its last command succeeded, unless set -e
      // also makes failures in earlier unconditional reads terminate the call.
      if (!depth && (errexit || index === commands.length - 1)) {
        paths.push(...readOperands(words).filter(path => !cwdChanged || /^(?:\/|[a-z]:[\\/])/i.test(path)));
      }
    }
  }
  const names = new Map();
  const plugins = new Map();
  for (const path of paths) {
    const skill = skillForPath(path, cwd);
    if (!skill) continue;
    rememberLatest(names, skill.name, skill.name, MAX_SKILLS);
    if (skill.plugin) {
      const key = JSON.stringify([skill.plugin.marketplace, skill.plugin.name]);
      rememberLatest(plugins, key, skill.plugin, MAX_PLUGINS);
    }
  }
  return { names: [...names.values()], plugins: [...plugins.values()] };
}

export function recordLoadedSkills(state, { names, plugins }, now) {
  for (const name of names) {
    state.skills = state.skills.filter(skill => skill.name !== name);
    state.skills.push({ name, lastReadAt: now });
    if (state.skills.length > MAX_SKILLS) state.skills.shift();
  }
  for (const plugin of plugins) {
    state.plugins = state.plugins.filter(item => item.name !== plugin.name || item.marketplace !== plugin.marketplace);
    state.plugins.push({ ...plugin, lastReadAt: now });
    if (state.plugins.length > MAX_PLUGINS) state.plugins.shift();
  }
}
