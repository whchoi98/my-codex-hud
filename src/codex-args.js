import { resolve } from 'node:path';

// Codex 0.153.4 --help and upstream 9e868bd9: utils/cli's SharedCliOptions
// and CliConfigOverrides, cli's FeatureToggles/InteractiveRemoteOptions, and
// tui's approval_policy. These consume one value; --cd and image are below.
// Keep preparation free of subprocess probes; update this with CLI changes.
const singleValueCodexOptions = new Set([
  '-c', '--config', '--enable', '--disable', '--remote', '--remote-auth-token-env',
  '-m', '--model', '--local-provider', '-p', '--profile', '-s', '--sandbox',
  '--add-dir', '-a', '--ask-for-approval',
]);

/** Keep Codex output in its normal buffer for native or captured-wheel scrolling. */
export function inlineCodexArgs(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') break;
    if (arg === '--no-alt-screen') return [...args];
    if (singleValueCodexOptions.has(arg) || arg === '-C' || arg === '--cd') {
      index += 1;
    } else if (arg === '--image' || arg === '-i') {
      while (index + 1 < args.length
        && (args[index + 1] === '-' || !args[index + 1].startsWith('-'))) index += 1;
    }
  }
  return ['--no-alt-screen', ...args];
}

/** Derive HUD selection context from validated cwd/argv without modifying them. */
export function codexLaunchContext(cwd, args) {
  let hudCwd = cwd;
  let continuing = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') break;
    if (singleValueCodexOptions.has(arg)) {
      if (args[index + 1] === '--') break;
      index += 1;
      continue;
    }
    if (arg === '--image' || arg === '-i') {
      // SharedCliOptions::images has num_args = 1.., ending at the next flag.
      // Attached values (--image=x, -ix, -i=x) end the option immediately.
      while (index + 1 < args.length
        && (args[index + 1] === '-' || !args[index + 1].startsWith('-'))) index += 1;
      continue;
    }
    let directory;
    if (arg === '-C' || arg === '--cd') {
      directory = args[++index];
    } else if (arg.startsWith('--cd=')) {
      directory = arg.slice('--cd='.length);
    } else if (arg.startsWith('-C') && arg.length > 2) {
      directory = arg.slice(arg.startsWith('-C=') ? 3 : 2);
    } else {
      if (arg === 'resume' || arg === 'fork') continuing = true;
      continue;
    }
    if (!directory || directory === '--') {
      throw new TypeError(`Codex ${arg} requires a nonempty directory argument before --.`);
    }
    hudCwd = resolve(cwd, directory);
  }
  return { hudCwd, continuing };
}
