import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';
import { codexLaunchContext } from './codex-args.js';

const execFileAsync = promisify(execFile);
const paneHeights = { full: 7, essential: 5, minimal: 2 };
const createdFormat = '#{session_id}\t#{window_id}\t#{pane_id}';

function stringArgument(value, name) {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string.`);
  if (value.includes('\0')) throw new TypeError(`${name} must not contain a NUL byte.`);
}

function integerOption(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer between ${min} and ${max}.`);
  }
}

/** Quote one literal argument for a POSIX shell, including empty strings. */
export function shellQuote(value) {
  stringArgument(value, 'Shell argument');
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function checkPaths({ cwd, codexHome, cliPath }) {
  for (const [name, path] of Object.entries({ cwd, codexHome, cliPath })) {
    stringArgument(path, name);
    if (!isAbsolute(path)) throw new TypeError(`${name} must be an absolute path.`);
  }
  try {
    if (!(await stat(cwd)).isDirectory()) throw new Error('not a directory');
  } catch (cause) {
    throw new Error(`Cannot use cwd directory: ${cwd}`, { cause });
  }
  try {
    if (!(await stat(cliPath)).isFile()) throw new Error('not a file');
    await access(cliPath, constants.R_OK);
  } catch (cause) {
    throw new Error(`Cannot read HUD cliPath: ${cliPath}`, { cause });
  }
}

async function findExecutable(name, env, cwd) {
  for (const directory of (env.PATH ?? '/usr/bin:/bin').split(delimiter)) {
    const candidate = resolve(cwd, directory || '.', name);
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Continue to the next PATH entry, including after an inaccessible one.
    }
  }
  throw new Error(`${name} executable was not found on PATH; codex-hud start requires it.`);
}

function failureDetail(error) {
  if (error.stderr?.trim()) return error.stderr.trim();
  if (error.killed) return 'command timed out';
  if (error.signal) return `terminated by ${error.signal}`;
  if (error.code !== undefined) return `exit code ${error.code}`;
  return error.message;
}

async function execute(file, args, options, label) {
  try {
    const { stdout } = await execFileAsync(file, args, {
      ...options, encoding: 'utf8', timeout: 10_000, maxBuffer: 256 * 1024,
    });
    return stdout;
  } catch (cause) {
    throw new Error(`${label} failed: ${failureDetail(cause)}`, { cause });
  }
}

function paneCommand(file, args, cwd, env) {
  // Multiple tmux shell-command arguments execute /bin/sh directly. This does
  // not depend on the user's default-shell, aliases, or shell startup files.
  // cd lives inside the quoted command: tmux -c would expand path format tokens.
  const statements = [
    `cd ${shellQuote(cwd)} || exit`,
    `export CODEX_HOME=${shellQuote(env.CODEX_HOME)}`,
    `export PATH=${shellQuote(env.PATH)}`,
    env.CODEX_THREAD_ID === undefined
      ? 'unset CODEX_THREAD_ID'
      : `export CODEX_THREAD_ID=${shellQuote(env.CODEX_THREAD_ID)}`,
    `exec ${[file, ...args].map(shellQuote).join(' ')}`,
  ];
  return ['/bin/sh', '-c', statements.join('\n')];
}

function disappeared(error) {
  return /no server running|no sessions|can't find (session|window|pane)|no such file or directory/i
    .test(error.cause?.stderr ?? '');
}

async function cleanUp(tmux, { inside, name, sessionId, created }) {
  let target = inside ? created?.windowId : created?.sessionId;
  if (!target) {
    // A hook or lost client reply can fail after tmux allocates the resource.
    // Recover by our unpredictable, exact name, never by a current/default target.
    const args = inside
      ? ['list-windows', '-t', sessionId, '-F', '#{window_id}\t#{window_name}']
      : ['list-sessions', '-F', '#{session_id}\t#{session_name}'];
    let output;
    try {
      output = await tmux(args);
    } catch (error) {
      if (disappeared(error)) return;
      throw error;
    }
    const idPattern = inside ? /^@\d+$/ : /^\$\d+$/;
    const matches = output.split('\n').map((line) => line.split('\t'))
      .filter(([id, foundName]) => idPattern.test(id) && foundName === name);
    if (matches.length > 1) throw new Error(`Cannot uniquely identify new tmux resource ${name}.`);
    target = matches[0]?.[0];
  }
  if (!target) return;
  try {
    await tmux([inside ? 'kill-window' : 'kill-session', '-t', target]);
  } catch (error) {
    if (!disappeared(error)) throw error;
  }
}

function attach(file, sessionId, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, ['attach-session', '-t', sessionId], {
      ...options, stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`tmux attach-session exited with ${signal ? `signal ${signal}` : `code ${code}`}.`));
    });
  });
}

/**
 * Launch Codex and a HUD in tmux without changing user configuration.
 *
 * cwd, codexHome and cliPath must be absolute. codexArgs is passed unchanged.
 * The HUD follows the last Codex -C/--cd before --, resolved against cwd.
 * The main pane stays at the original cwd so Codex applies relative paths once.
 * session pins only the HUD; callers supply Codex resume/fork arguments.
 * New launches use --since (epoch milliseconds). Resume/fork cannot use a
 * creation cutoff, so same-cwd selection is not guaranteed without session.
 * Use an explicit session for resume/fork with --cd: metadata may retain its old cwd.
 * Resolved HUD preferences and an explicit configPath are forwarded to watch.
 * The HUD pins the first match by default; follow opts into following matches.
 * A hook on the new window closes only its HUD when the original Codex pane exits.
 *
 * Resolves to { sessionId, windowId, mainPaneId, hudPaneId }. Inside tmux this
 * happens after selecting the new window; outside it happens after detaching.
 * Creation failures clean up only our resource. Attach failures leave the
 * running session intact and include a reattach command in the error.
 */
export async function launch({
  cwd,
  codexHome,
  cliPath,
  codexArgs = [],
  preset = 'full',
  language = 'en',
  interval = 1000,
  width = null,
  pathLevels = 1,
  color = true,
  ascii = false,
  git = true,
  mouse = false,
  follow = false,
  configPath,
  session,
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  if (!process.stdin.isTTY || !stdout?.isTTY) {
    throw new Error('codex-hud start requires an interactive TTY on stdin and stdout. Run it in a terminal.');
  }
  if (!Array.isArray(codexArgs)) throw new TypeError('codexArgs must be an array of strings.');
  for (const arg of codexArgs) stringArgument(arg, 'codexArgs entry');
  if (!Object.hasOwn(paneHeights, preset)) throw new TypeError('preset must be full, essential, or minimal.');
  if (!['en', 'ko'].includes(language)) throw new TypeError('language must be en or ko.');
  integerOption(interval, 'interval', 200, 60_000);
  if (width !== null) integerOption(width, 'width', 1, 1000);
  integerOption(pathLevels, 'pathLevels', 1, 3);
  for (const [name, value] of Object.entries({ color, ascii, git, follow, mouse })) {
    if (typeof value !== 'boolean') throw new TypeError(`${name} must be true or false.`);
  }
  if (configPath != null) {
    stringArgument(configPath, 'configPath');
    if (!configPath) throw new TypeError('configPath must be a nonempty path.');
  }
  if (session != null) {
    stringArgument(session, 'session');
    if (!session) throw new TypeError('session must be a nonempty rollout path or UUID.');
  }
  await checkPaths({ cwd, codexHome, cliPath });
  const { hudCwd, continuing } = codexLaunchContext(cwd, codexArgs);

  const childEnv = { ...env, CODEX_HOME: codexHome, PATH: env.PATH ?? '/usr/bin:/bin' };
  if (session == null) delete childEnv.CODEX_THREAD_ID;
  const childOptions = { cwd, env: childEnv };
  const [tmuxPath, codexPath] = await Promise.all([
    findExecutable('tmux', childEnv, cwd),
    findExecutable('codex', childEnv, cwd),
  ]);
  const tmux = (args) => execute(tmuxPath, args, childOptions, `tmux ${args[0]}`);
  await tmux(['-V']);
  await execute(codexPath, ['--version'], childOptions, 'codex --version');

  const inside = Boolean(env.TMUX);
  let sessionId;
  if (inside) {
    const args = ['display-message', '-p'];
    if (env.TMUX_PANE) args.push('-t', env.TMUX_PANE);
    sessionId = (await tmux([...args, '#{session_id}'])).trim();
    if (!/^\$\d+$/.test(sessionId)) {
      throw new Error('Could not identify the current tmux session.');
    }
  }

  const hudArgs = [
    cliPath, 'watch', '--cwd', hudCwd, '--codex-home', codexHome,
    '--preset', preset, '--language', language,
    '--interval', String(interval), '--path-levels', String(pathLevels),
    mouse ? '--mouse' : '--no-mouse',
  ];
  if (width !== null) hudArgs.push('--width', String(width));
  if (!color) hudArgs.push('--no-color');
  if (ascii) hudArgs.push('--ascii');
  if (!git) hudArgs.push('--no-git');
  if (follow) hudArgs.push('--follow');
  if (configPath != null) hudArgs.push('--config', configPath);
  if (session != null) hudArgs.push('--session', session);
  else if (!continuing) hudArgs.push('--since', String(Date.now()));
  else {
    stderr.write('codex-hud: resume/fork selection is not guaranteed when multiple sessions share '
      + 'the same cwd. Use --session <UUID or rollout path> to pin the HUD.\n');
  }
  const mainCommand = paneCommand(codexPath, codexArgs, cwd, childEnv);
  const hudCommand = paneCommand(process.execPath, hudArgs, cwd, childEnv);
  const name = `codex-hud-${randomUUID()}`;
  let created;

  try {
    const args = inside
      ? ['new-window', '-d', '-t', `${sessionId}:`, '-n', name]
      : ['new-session', '-d', '-s', name, '-n', name];
    if (!inside) {
      for (const [flag, size] of [['-x', stdout.columns], ['-y', stdout.rows]]) {
        if (Number.isInteger(size) && size > 0) args.push(flag, String(size));
      }
    }
    const output = await tmux([...args, '-P', '-F', createdFormat, '--', ...mainCommand]);
    const match = /^(\$\d+)\t(@\d+)\t(%\d+)$/.exec(output.trim());
    if (!match || (inside && match[1] !== sessionId)) {
      throw new Error('tmux returned invalid session/window/pane identifiers in creation output.');
    }
    created = { sessionId: match[1], windowId: match[2], mainPaneId: match[3] };
    const hudPaneId = (await tmux([
      'split-window', '-d', '-v', '-l', String(paneHeights[preset]),
      '-t', created.mainPaneId, '-P', '-F', '#{pane_id}', '--', ...hudCommand,
    ])).trim();
    if (!/^%\d+$/.test(hudPaneId)) {
      throw new Error('tmux returned an invalid HUD pane identifier in split output.');
    }
    created.hudPaneId = hudPaneId;
    // The hook must belong to the window because the exiting pane is removed.
    // Only validated pane IDs enter this command; other pane exits do nothing.
    await tmux([
      'set-hook', '-w', '-t', created.windowId, 'pane-exited',
      `if-shell -F "#{==:#{hook_pane},${created.mainPaneId}}" "kill-pane -t ${created.hudPaneId}"`,
    ]);
    await tmux(['select-pane', '-t', created.mainPaneId]);
    if (inside) await tmux(['select-window', '-t', `${sessionId}:${created.windowId}`]);
  } catch (error) {
    try {
      await cleanUp(tmux, { inside, name, sessionId, created });
    } catch (cleanupError) {
      const target = (inside ? created?.windowId : created?.sessionId) ?? name;
      throw new Error(`${error.message} Cleanup of new tmux ${inside ? 'window' : 'session'} `
        + `${target} also failed: ${cleanupError.message}`, { cause: error });
    }
    throw error;
  }

  if (!inside) {
    try {
      await attach(tmuxPath, created.sessionId, childOptions);
    } catch (cause) {
      throw new Error(`${cause.message} The Codex/HUD session ${created.sessionId} was left running. `
        + `Reattach with: ${shellQuote(tmuxPath)} attach-session -t ${shellQuote(created.sessionId)}`,
      { cause });
    }
  }
  return created;
}
