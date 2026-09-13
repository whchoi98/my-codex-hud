import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, resolve } from 'node:path';
import { codexLaunchContext } from './codex-args.js';
import { defaults } from './config.js';

const terminalName = 'xterm-256color';
const defaultPath = '/usr/bin:/bin';

function requirePosix() {
  if (process.platform === 'win32') {
    throw new Error('Inline Codex HUD is not supported on native Windows. '
      + 'Run it in WSL, or use codex-hud watch as a standalone monitor.');
  }
}

function stringArgument(value, name, { nonempty = false } = {}) {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string.`);
  if (value.includes('\0')) throw new TypeError(`${name} must not contain a NUL byte.`);
  if (nonempty && !value) throw new TypeError(`${name} must be nonempty.`);
}

function argumentsArray(args, name) {
  if (!Array.isArray(args)) throw new TypeError(`${name} must be an array of strings.`);
  for (const arg of args) stringArgument(arg, `${name} entry`);
}

function integerOption(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer between ${min} and ${max}.`);
  }
}

function objectOption(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
}

function absolutePath(value, name) {
  stringArgument(value, name);
  if (!isAbsolute(value)) throw new TypeError(`${name} must be an absolute path.`);
}

async function checkDirectory(cwd) {
  absolutePath(cwd, 'cwd');
  try {
    if (!(await stat(cwd)).isDirectory()) throw new Error('not a directory');
    await access(cwd, constants.X_OK);
  } catch (cause) {
    throw new Error(`Cannot use cwd directory: ${cwd}`, { cause });
  }
}

function terminalEnvironment(env) {
  objectOption(env, 'env');
  for (const [key, value] of Object.entries(env)) {
    stringArgument(key, 'env variable name', { nonempty: true });
    if (key.includes('=')) throw new TypeError('env variable names must not contain "=".');
    if (value !== undefined) stringArgument(value, `env.${key}`);
  }
  const childEnv = { ...env, TERM: terminalName, PATH: env.PATH ?? defaultPath };
  // Geometry belongs to the new PTY, not the terminal that launched the HUD.
  delete childEnv.COLUMNS;
  delete childEnv.LINES;
  return childEnv;
}

async function findExecutable(file, env, cwd) {
  const explicitPath = file.includes('/');
  const candidates = explicitPath
    ? [resolve(cwd, file)]
    : env.PATH.split(delimiter).map(directory => resolve(cwd, directory || '.', file));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // An inaccessible, missing, or nonexecutable entry must not mask later ones.
    }
  }
  if (explicitPath) throw new Error(`Cannot execute PTY file: ${file}`);
  throw new Error(`${file} executable was not found on PATH; codex-hud start requires it.`);
}

function validateHudSettings(settings) {
  if (!['full', 'essential', 'minimal'].includes(settings.preset)) {
    throw new TypeError('preset must be full, essential, or minimal.');
  }
  if (!['en', 'ko'].includes(settings.language)) throw new TypeError('language must be en or ko.');
  integerOption(settings.interval, 'interval', 200, 60_000);
  if (settings.width !== null) integerOption(settings.width, 'width', 1, 1000);
  integerOption(settings.pathLevels, 'pathLevels', 1, 3);
  for (const name of ['color', 'ascii', 'git', 'follow', 'mouse']) {
    if (typeof settings[name] !== 'boolean') throw new TypeError(`${name} must be true or false.`);
  }
  for (const name of ['session', 'configPath']) {
    if (settings[name] != null) stringArgument(settings[name], name, { nonempty: true });
  }
}

/**
 * Prepare a literal Codex invocation without spawning or touching the terminal.
 *
 * cwd and codexHome must be absolute; codexHome need not exist yet. The child
 * keeps the initial cwd, while hudSettings follows the last -C/--cd before --.
 * HUD preferences are forwarded with the same defaults as the tmux launcher.
 * session pins only the HUD: callers supply any Codex resume/fork arguments.
 * Fresh launches get an epoch-ms since cutoff unless session is explicit.
 * Resume/fork without session returns a selection-ambiguity note and no cutoff.
 *
 * Resolves to { file, args, cwd, env, hudSettings, note? }.
 */
export async function prepareCodex(settings = {}) {
  requirePosix();
  objectOption(settings, 'settings');
  const { codexArgs = [], env = process.env, ...hudFields } = settings;
  argumentsArray(codexArgs, 'codexArgs');
  const args = [...codexArgs];
  const { cwd, codexHome, session } = hudFields;
  absolutePath(cwd, 'cwd');
  absolutePath(codexHome, 'codexHome');
  const hudSettings = {
    ...defaults, follow: false,
    ...Object.fromEntries(Object.entries(hudFields).filter(([, value]) => value !== undefined)),
  };
  validateHudSettings(hudSettings);
  const { hudCwd, continuing } = codexLaunchContext(cwd, args);
  const childEnv = { ...terminalEnvironment(env), CODEX_HOME: codexHome };
  if (session == null) delete childEnv.CODEX_THREAD_ID;
  await checkDirectory(cwd);
  const file = await findExecutable('codex', childEnv, cwd);
  hudSettings.cwd = hudCwd;
  delete hudSettings.since;
  let note;
  if (session == null) {
    if (!continuing) hudSettings.since = Date.now();
    else {
      note = 'Codex resume/fork selection is not guaranteed when multiple sessions share the same cwd. '
        + 'Use --session <UUID or rollout path> to pin the HUD; resumed metadata may retain its old cwd.';
    }
  }
  return { file, args, cwd, env: childEnv, hudSettings, ...(note ? { note } : {}) };
}

async function loadPty() {
  requirePosix();
  try {
    const module = await import('node-pty');
    const pty = module.default ?? module;
    if (typeof pty.spawn !== 'function') throw new Error('node-pty does not export spawn().');
    return pty;
  } catch (cause) {
    throw new Error(`Cannot load node-pty for inline Codex HUD (${process.platform}/${process.arch}, `
      + `Node ${process.versions.node}): ${cause.message}. `
      + 'Reinstall codex-hud for this platform and Node version, or run npm rebuild node-pty '
      + 'in its installation directory. You can also use codex-hud watch.', { cause });
  }
}

/**
 * Spawn an executable with literal argv and return node-pty's native IPty.
 * Dimensions are positive POSIX winsize integers (1–65535). args defaults to
 * [], env to process.env, and cwd must be absolute. The caller owns input,
 * resize, output draining, signal forwarding, termination, and terminal cleanup.
 */
export async function createPty({
  file, args = [], cwd, env = process.env, cols, rows,
} = {}) {
  requirePosix();
  stringArgument(file, 'file', { nonempty: true });
  argumentsArray(args, 'args');
  integerOption(cols, 'cols', 1, 65535);
  integerOption(rows, 'rows', 1, 65535);
  const childArgs = [...args];
  const childEnv = terminalEnvironment(env);
  await checkDirectory(cwd);
  const executable = await findExecutable(file, childEnv, cwd);
  const pty = await loadPty();
  return pty.spawn(executable, childArgs, {
    cwd, env: childEnv, cols, rows, name: terminalName, encoding: 'utf8',
  });
}

/** Check native dependency loadability for doctor, without spawning any child. */
export async function ptyAvailable() {
  try {
    await loadPty();
    return { available: true };
  } catch (error) {
    return { available: false, error: error.message };
  }
}
