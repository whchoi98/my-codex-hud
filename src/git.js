import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

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
