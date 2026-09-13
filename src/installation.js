import { execFile } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const owner = '# Managed by codex-hud-install.';
const autostartMarker = '# codex-hud autostart enabled';
const maxMetadataBytes = 65536;

function semver(value) {
  if (typeof value !== 'string') return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!match) return null;
  const pre = match[4]?.split('.') ?? [];
  if (pre.some(part => /^\d+$/.test(part) && part.length > 1 && part[0] === '0')) return null;
  return { core: match.slice(1, 4).map(BigInt), pre };
}

function compareSemver(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  }
  if (!a.pre.length || !b.pre.length) {
    return a.pre.length ? -1 : b.pre.length ? 1 : 0;
  }
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (a.pre[i] === b.pre[i]) continue;
    if (a.pre[i] === undefined) return -1;
    if (b.pre[i] === undefined) return 1;
    const an = /^\d+$/.test(a.pre[i]);
    const bn = /^\d+$/.test(b.pre[i]);
    if (an && bn) return BigInt(a.pre[i]) > BigInt(b.pre[i]) ? 1 : -1;
    if (an !== bn) return an ? -1 : 1;
    return a.pre[i] > b.pre[i] ? 1 : -1;
  }
  return 0;
}

/** Describe applying the bundle to the running HUD, ignoring SemVer build metadata. */
export function versionComparison(installed, bundled) {
  const from = semver(installed);
  const to = semver(bundled);
  if (!from || !to) return 'unknown';
  const result = compareSemver(to, from);
  return result > 0 ? 'upgrade' : result < 0 ? 'downgrade' : 'same';
}

async function smallFile(path) {
  let info;
  try { info = await lstat(path); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Cannot read ${path}: ${error.code ?? 'filesystem error'}`);
  }
  if (!info.isFile()) throw new Error(`Expected a regular metadata file: ${path}`);
  if (info.size > maxMetadataBytes) throw new Error(`Metadata is larger than 64 KiB: ${path}`);
  return readFile(path, 'utf8');
}

async function jsonFile(path) {
  const text = await smallFile(path);
  if (text === null) return null;
  let value;
  try { value = JSON.parse(text); }
  catch { throw new Error(`Invalid JSON in ${path}`); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected a JSON object in ${path}`);
  }
  return value;
}

function childPath(parent, child) {
  const path = relative(parent, child);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function shellLiteral(value) {
  // Match the generated shlex.quote fragments only. No expansion or shell execution.
  if (!/^(?:[a-zA-Z0-9_@%+=:,./-]|'[^']*'|"[^"$`\\]*")+$/u.test(value)) return null;
  let text = '';
  for (let index = 0; index < value.length;) {
    const quote = value[index] === "'" || value[index] === '"' ? value[index++] : null;
    if (quote) {
      const end = value.indexOf(quote, index);
      text += value.slice(index, end);
      index = end + 1;
    } else {
      const start = index;
      while (index < value.length && value[index] !== "'" && value[index] !== '"') index++;
      text += value.slice(start, index);
    }
  }
  return text;
}

function validState(value, prefix) {
  return value?.schemaVersion === 1 && value.owner === 'codex-hud-install'
    && ['user', 'project'].includes(value.scope)
    && value.prefix === prefix && value.command === join(prefix, 'bin', 'codex-hud')
    && value.shellFile === join(prefix, 'shell.sh')
    && (value.scope === 'user' ? value.project === null
      : typeof value.project === 'string' && isAbsolute(value.project) && childPath(value.project, prefix))
    && ['ko', 'en'].includes(value.language) && typeof value.autostart === 'boolean'
    && ['bash', 'zsh', 'none'].includes(value.shell)
    && Array.isArray(value.startupFiles) && value.startupFiles.length <= 100
    && value.startupFiles.every(path => typeof path === 'string' && isAbsolute(path))
    && semver(value.version) !== null;
}

async function installPrefix(packageRoot, commandPath) {
  const modules = dirname(packageRoot);
  if (basename(modules) === 'node_modules') {
    const parent = dirname(modules);
    return basename(parent) === 'lib' ? dirname(parent) : parent;
  }
  if (basename(commandPath) === 'codex-hud' && basename(dirname(commandPath)) === 'bin') {
    const target = await realpath(commandPath).catch(() => null);
    if (target === await realpath(join(packageRoot, 'bin', 'codex-hud.js')).catch(() => null)) {
      return realpath(dirname(dirname(commandPath))).catch(() => resolve(dirname(dirname(commandPath))));
    }
  }
  return null;
}

async function inspectHud(packageRoot, commandPath) {
  packageRoot = await realpath(packageRoot).catch(() => resolve(packageRoot));
  commandPath = resolve(commandPath);
  const pkg = await jsonFile(join(packageRoot, 'package.json'));
  const prefix = await installPrefix(packageRoot, commandPath);
  const hud = {
    version: pkg?.name === 'my-codex-hud' ? pkg.version ?? null : null,
    command: commandPath, packageRoot, prefix, managed: false, scope: null, project: null,
    shellFile: prefix ? join(prefix, 'shell.sh') : null,
    stateFile: prefix ? join(prefix, 'install-state.json') : null,
    language: null, startupFiles: null, autostart: { configured: null, active: null },
    warnings: [],
  };
  if (!prefix) return hud;
  let saved = null;
  try {
    saved = await jsonFile(hud.stateFile);
    if (saved && !validState(saved, prefix)) {
      throw new Error(`Invalid or mismatched installation state: ${hud.stateFile}`);
    }
    if (saved) {
      hud.managed = true;
      hud.scope = saved.scope;
      hud.project = saved.project;
      hud.startupFiles = saved.startupFiles;
      hud.command = saved.command;
    }
  } catch (error) {
    saved = null;
    hud.warnings.push(error.message);
  }
  try {
    const text = await smallFile(hud.shellFile);
    if (text === null) {
      if (saved) hud.warnings.push(`Managed shell configuration is missing: ${hud.shellFile}`);
      return hud;
    }
    const lines = text.split(/\r?\n/);
    if (lines[0] !== owner) {
      hud.warnings.push(`Shell configuration is not managed by codex-hud-install: ${hud.shellFile}`);
      return hud;
    }
    const scopes = [...text.matchAll(/^# scope: (.*)$/gm)].map(match => match[1]);
    const assignments = [...text.matchAll(/^_CODEX_HUD_PROJECT_ROOT=(.*)$/gm)].map(match => match[1]);
    const scope = scopes.length > 1 || (scopes.length && !['user', 'project'].includes(scopes[0]))
      ? null : scopes[0] ?? (assignments.length ? 'project' : saved?.scope ?? 'user');
    if (scope === null || (saved && scope !== saved.scope)
      || (scope === 'user' && assignments.length)) {
      hud.warnings.push('Saved install scope and shell configuration disagree.');
      hud.scope = null;
      hud.project = null;
    } else hud.scope = scope;
    if (hud.scope === 'project' && assignments.length) {
      const literal = assignments.length === 1 ? shellLiteral(assignments[0]) : null;
      const project = literal && isAbsolute(literal)
        ? await realpath(literal).catch(() => resolve(literal)) : null;
      if (!project || !childPath(project, prefix) || (saved && saved.project !== project)) {
        hud.project = null;
        hud.warnings.push('Cannot confirm the managed project root: its literal value is invalid or conflicts with saved state.');
      } else hud.project = project;
    } else if (hud.scope === 'project' && !saved) {
      hud.project = null;
      hud.warnings.push('The legacy project root is not recorded; supply the verified project directory to the installer.');
    }
    hud.managed = true;
    hud.language = /^# language: (ko|en)$/m.exec(text)?.[1] ?? null;
    hud.autostart.configured = lines.includes(autostartMarker);
  } catch (error) {
    hud.warnings.push(error.message);
  }
  return hud;
}

function cacheComponent(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
    && value !== '.' && value !== '..' && !/[\\/\0]/.test(value);
}

async function inspectPlugin(codexHome) {
  try {
    const { stdout } = await exec('codex', ['plugin', 'list', '--json'], {
      env: { ...process.env, CODEX_HOME: codexHome },
      timeout: 3000, maxBuffer: 1024 * 1024, windowsHide: true,
    });
    const result = JSON.parse(stdout);
    if (!Array.isArray(result.installed)) throw new Error('Unsupported plugin listing.');
    const installed = result.installed.filter(item => item?.name === 'codex-hud'
      && item.installed === true && item.enabled !== false);
    const candidates = installed.map(item => {
      if (!cacheComponent(item.marketplaceName) || !cacheComponent(item.version)) {
        throw new Error('Invalid plugin cache identity.');
      }
      return {
        id: `codex-hud@${item.marketplaceName}`, version: item.version,
        marketplace: item.marketplaceName,
        metadataPath: join(codexHome, 'plugins', 'cache', item.marketplaceName, 'codex-hud', item.version,
          'skills', 'codex-hud-install', 'assets', 'package.json'),
      };
    });
    return {
      status: candidates.length > 1 ? 'ambiguous' : candidates.length ? 'registered' : 'not-registered',
      candidates,
    };
  } catch {
    // A missing/older CLI or unreadable profile must not disable the other doctor checks.
    return { status: 'unknown', candidates: [], error: 'Cannot read Codex plugin registrations.' };
  }
}

async function inspectBundle(metadataPath, installedVersion, source) {
  const result = { status: 'invalid', metadataPath, version: null, comparison: 'unknown', source };
  try {
    const value = await jsonFile(metadataPath);
    if (!value) throw new Error(`Bundle metadata is missing: ${metadataPath}`);
    if (value.name !== 'my-codex-hud' || !semver(value.version)
      || typeof value.file !== 'string' || basename(value.file) !== value.file
      || /[\\\0]/.test(value.file) || !value.file.endsWith('.tgz')
      || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(value.sha256)) {
      throw new Error(`Invalid HUD bundle metadata: ${metadataPath}`);
    }
    return {
      ...result, status: 'available', version: value.version,
      comparison: versionComparison(installedVersion, value.version),
    };
  } catch (error) {
    return { ...result, error: error.message };
  }
}

/** Read configuration and installed plugin metadata without evaluating shell files or changing them. */
export async function installationDiagnostics({ packageRoot, commandPath, codexHome, bundlePath }) {
  const [hud, plugin] = await Promise.all([
    inspectHud(packageRoot, commandPath),
    inspectPlugin(codexHome),
  ]);
  let bundle = { status: 'not-found', metadataPath: null, version: null, comparison: 'unknown', source: null };
  if (bundlePath) bundle = await inspectBundle(resolve(bundlePath), hud.version, 'explicit');
  else if (plugin.status === 'registered') {
    bundle = await inspectBundle(plugin.candidates[0].metadataPath, hud.version, 'plugin');
  } else if (plugin.status === 'ambiguous' || plugin.status === 'unknown') {
    bundle.status = plugin.status;
  }
  return {
    hud, plugin, bundle,
    stages: {
      plugin: plugin.status,
      hud: hud.prefix ? 'installed' : 'source',
      autostart: hud.autostart.configured === null ? 'unknown'
        : hud.autostart.configured ? 'configured' : 'disabled',
    },
  };
}
