import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

function worktreeGit(cwd, args) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };
  // Resolve the requested directory, not a repository selected by the parent shell.
  for (const key of ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[key];
  return exec('git', ['--no-optional-locks', '-C', cwd, ...args], {
    timeout: 1500, maxBuffer: 1024 * 1024, windowsHide: true, env,
  });
}

/** Confirm repository identity independently of a possibly stale worktree registry. */
export async function getGitCommonDirectory(cwd) {
  try {
    const { stdout } = await worktreeGit(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    return await realpath(stdout.replace(/\n$/, ''));
  } catch {
    return null;
  }
}

/** Read registered sibling worktree roots without widening to arbitrary directories. */
export async function getLinkedWorktrees(cwd) {
  try {
    const { stdout } = await worktreeGit(cwd, ['worktree', 'list', '--porcelain', '-z']);
    const roots = await Promise.all(stdout.split('\0')
      .filter(field => field.startsWith('worktree '))
      .map(field => realpath(field.slice(9)).catch(() => null)));
    const current = await realpath(cwd);
    return roots.filter(root => {
      if (!root) return false;
      const path = relative(root, current);
      // The current checkout remains subject to exact-cwd matching.
      return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path);
    });
  } catch {
    return [];
  }
}

export async function getGitStatus(cwd) {
  if (!cwd) return null;
  try {
    const { stdout } = await exec('git', [
      '--no-optional-locks', '-C', cwd, 'status', '--porcelain=v2', '--branch', '--untracked-files=all',
    ], {
      timeout: 1500, maxBuffer: 1024 * 1024, windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
    });
    let branch = null;
    let oid = null;
    let ahead = 0;
    let behind = 0;
    let changed = 0;
    let untracked = 0;
    for (const line of stdout.split('\n')) {
      if (line.startsWith('# branch.head ')) branch = line.slice(14);
      else if (line.startsWith('# branch.oid ')) oid = line.slice(13);
      else if (line.startsWith('# branch.ab ')) {
        const match = line.match(/^# branch\.ab \+(\d+) -(\d+)$/);
        if (match) [ahead, behind] = [Number(match[1]), Number(match[2])];
      } else if (/^[12u] /.test(line)) changed++;
      else if (line.startsWith('? ')) untracked++;
    }
    if (branch === '(detached)') branch = oid?.slice(0, 7) ?? 'HEAD';
    return branch ? { branch, dirty: changed + untracked > 0, ahead, behind, changed, untracked } : null;
  } catch {
    // A missing executable, non-repository directory, or slow repo is optional.
    return null;
  }
}
