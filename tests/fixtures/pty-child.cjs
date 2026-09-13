const { appendFileSync } = require('node:fs');

if (process.env.CODEX_HUD_PTY_STARTED) {
  appendFileSync(process.env.CODEX_HUD_PTY_STARTED, 'started\n');
}

function emit(type, values = {}, done) {
  process.stdout.write(`PTY_TEST:${JSON.stringify({ type, ...values })}\n`, done);
}

function size() {
  return { cols: process.stdout.columns, rows: process.stdout.rows };
}

const mode = process.env.CODEX_HUD_PTY_MODE || 'report';
if (mode === 'raw') process.stdin.setRawMode(true);
if (mode === 'raw' || mode === 'signal') process.stdin.resume();
process.stdout.on('resize', () => emit('resize', size()));
process.stdin.on('data', data => {
  emit('input', { data: data.toString('base64') });
  if (data.includes(4)) {
    emit('exit', { message: 'finished 한글 🌱' }, () => process.exit(23));
  }
});
emit('ready', {
  ...size(),
  tty: [process.stdin.isTTY, process.stdout.isTTY, process.stderr.isTTY],
  cwd: process.cwd(),
  argv: process.argv.slice(2),
  env: Object.fromEntries([
    'CODEX_HOME', 'CODEX_THREAD_ID', 'PATH', 'TERM', 'COLUMNS', 'LINES',
    'CODEX_HUD_PTY_VALUE',
  ].map(key => [key, process.env[key] ?? null])),
});
if (mode === 'report') {
  emit('exit', { message: 'finished 한글 🌱' }, () => process.exit(23));
}
