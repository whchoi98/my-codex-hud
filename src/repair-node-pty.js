import {
  closeSync, constants, fchmodSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync,
} from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/**
 * Read-only inspection of the helper UnixTerminal will actually use. Matching
 * node-pty's successful native load matters: an existing Release addon can fail
 * to load, in which case Debug or the platform prebuild supplies the helper.
 */
export async function inspectNodePtyHelper() {
  if (process.platform !== 'darwin') return null;
  let path;
  try {
    const library = dirname(require.resolve('node-pty/lib/unixTerminal.js'));
    const { dir } = require('node-pty/lib/utils.js').loadNativeModule('pty');
    path = resolve(library, dir, 'spawn-helper')
      .replace('app.asar', 'app.asar.unpacked')
      .replace('node_modules.asar', 'node_modules.asar.unpacked');
  } catch (error) {
    return { path: null, status: 'unresolved', error: error.message };
  }
  try {
    const info = await stat(path);
    const mode = (info.mode & 0o7777).toString(8).padStart(4, '0');
    if (!info.isFile()) return { path, status: 'not-file', mode };
    try {
      if (!(info.mode & 0o111)) throw new Error('No execute bits');
      await access(path, constants.X_OK);
      return { path, status: 'executable', mode };
    } catch {
      return {
        path, status: 'not-executable', mode,
        repairCommand: [process.execPath, fileURLToPath(import.meta.url)],
      };
    }
  } catch (error) {
    return { path, status: error.code === 'ENOENT' ? 'missing' : 'inaccessible', error: error.message };
  }
}

function unsafePath(path) {
  return Object.assign(new Error(`Refusing linked, nonregular, or changed node-pty helper path: ${path}`),
    { code: 'UNSAFE_PATH', path });
}

function checkDirectory(path) {
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isDirectory()) throw unsafePath(path);
}

function dependencyRoot() {
  // require.resolve canonicalizes symlinks. Recover its logical lookup path so
  // npm links and a symlinked node_modules cannot turn this into an external chmod.
  const manifest = realpathSync(require.resolve('node-pty/package.json'));
  for (const lookup of require.resolve.paths('node-pty') ?? []) {
    const root = join(lookup, 'node-pty');
    const candidate = join(root, 'package.json');
    let resolved;
    try {
      resolved = realpathSync(candidate);
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) continue;
      throw error;
    }
    if (resolved !== manifest) continue;
    checkDirectory(lookup);
    checkDirectory(root);
    if (lstatSync(candidate).isSymbolicLink()) throw unsafePath(candidate);
    if (JSON.parse(readFileSync(candidate, 'utf8')).name !== 'node-pty') {
      throw new Error(`Expected node-pty package metadata at ${candidate}`);
    }
    return root;
  }
  throw new Error('Cannot locate the installed node-pty package directory.');
}

function repairHelper(root, canonicalRoot, relativePath) {
  let path = root;
  let info;
  const parts = relativePath.split('/');
  for (let i = 0; i < parts.length; i++) {
    path = join(path, parts[i]);
    info = lstatSync(path);
    if (info.isSymbolicLink()) throw unsafePath(path);
    if (i < parts.length - 1 ? !info.isDirectory() : !info.isFile() || info.nlink !== 1) {
      throw unsafePath(path);
    }
  }
  // Add x only for classes that can already read the shipped binary. Preserve
  // every existing permission (including special bits), and leave repeats alone.
  const mode = info.mode & 0o7777;
  const desired = mode | ((mode & 0o444) >> 2);
  if (!(desired & 0o111)) {
    throw Object.assign(new Error(`node-pty helper has no readable permissions: ${path}`),
      { code: 'EACCES', path });
  }
  if (desired === mode) return false;

  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== info.dev || opened.ino !== info.ino
      || realpathSync(path) !== resolve(canonicalRoot, relativePath)) {
      throw unsafePath(path);
    }
    const current = opened.mode & 0o7777;
    fchmodSync(fd, current | ((current & 0o444) >> 2));
  } finally {
    closeSync(fd);
  }
  return true;
}

/**
 * Installation-time repair, also runnable as `node src/repair-node-pty.js`.
 * It never loads the native addon, spawns a child, or walks arbitrary files.
 * doctor imports only the read-only inspector above; --ignore-scripts users
 * can run this entry point explicitly in the installed HUD package.
 */
export function repairNodePtyHelpers() {
  const { platform, arch } = process;
  const result = { platform, arch, status: 'skipped', repaired: [], unchanged: [], errors: [] };
  if (platform !== 'darwin' || !['arm64', 'x64'].includes(arch)) return result;
  let root;
  try {
    root = dependencyRoot();
    const canonicalRoot = realpathSync(root);
    // These are the same unbundled/bundled Release, Debug and current-arch
    // prebuild layouts used by node-pty 1.1.0's native loader.
    const directories = ['build/Release', 'build/Debug', `prebuilds/darwin-${arch}`];
    for (const directory of directories) {
      for (const prefix of ['', 'lib/']) {
        const relativePath = `${prefix}${directory}/spawn-helper`;
        const path = join(root, relativePath);
        try {
          const changed = repairHelper(root, canonicalRoot, relativePath);
          result[changed ? 'repaired' : 'unchanged'].push(path);
        } catch (error) {
          if (error.code === 'ENOENT') continue; // Most layouts are absent in a normal installation.
          result.errors.push({ path: error.path ?? path, code: error.code ?? 'REPAIR_FAILED', error: error.message });
        }
      }
    }
    if (!result.repaired.length && !result.unchanged.length && !result.errors.length) {
      result.errors.push({ path: root, code: 'ENOENT',
        error: 'No macOS node-pty spawn-helper found. Reinstall codex-hud or rebuild node-pty.' });
    }
  } catch (error) {
    result.errors.push({ path: error.path ?? root ?? null, code: error.code ?? 'REPAIR_FAILED', error: error.message });
  }
  result.status = result.errors.length ? 'failed' : result.repaired.length ? 'repaired' : 'ok';
  return result;
}

let isEntryPoint = false;
try {
  isEntryPoint = Boolean(process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url));
} catch { /* Imported by a host whose argv[1] is not a local script. */ }
if (isEntryPoint) {
  const result = repairNodePtyHelpers();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status === 'failed') process.exitCode = 1;
}
