import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const events = process.env.HUD_TEST_EVENTS;
const record = value => appendFileSync(events, `${JSON.stringify(value)}\n`);
const meta = { id: '11111111-1111-7111-8111-111111111111', cwd: process.cwd(), timestamp: new Date().toISOString() };
const sessions = join(process.env.CODEX_HOME, 'sessions');
mkdirSync(sessions, { recursive: true });
const records = [
  { type: 'session_meta', payload: meta },
  { type: 'turn_context', payload: { model: 'gpt-inline-test', effort: 'high' } },
  { type: 'event_msg', payload: { type: 'task_started' } },
  { type: 'event_msg', payload: { type: 'token_count', info: {
    model_context_window: 1000,
    last_token_usage: { total_tokens: 100 },
    total_token_usage: { total_tokens: 3000, input_tokens: 2000, output_tokens: 1000 },
  } } },
  { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'test-command', arguments: '{"cmd":"verify inline HUD"}' } },
  { type: 'response_item', payload: { type: 'function_call', name: 'update_plan', call_id: 'test-plan',
    arguments: '{"plan":[{"step":"terminal integration","status":"in_progress"},{"step":"finish","status":"pending"}]}' } },
];
writeFileSync(join(sessions, 'rollout-inline-test.jsonl'), records.map(value =>
  JSON.stringify({ timestamp: new Date().toISOString(), ...value })).join('\n') + '\n');

process.stdin.setRawMode(true);
process.stdin.resume();
function draw(label = 'READY') {
  process.stdout.write(`\x1b[2J\x1b[H${label} ${process.stdout.columns}x${process.stdout.rows}\r\n`);
  process.stdout.write('\x1b[32mCodex test input: 한글🙂\x1b[0m');
  process.stdout.write('\x1b[?2004h\x1b[?25h');
}
draw();
record({ type: 'ready', columns: process.stdout.columns, rows: process.stdout.rows,
  pid: process.pid, args: process.argv.slice(2) });
process.stdout.on('resize', () => {
  draw('RESIZED');
  record({ type: 'resize', columns: process.stdout.columns, rows: process.stdout.rows });
});
process.stdin.on('data', buffer => {
  const data = buffer.toString();
  record({ type: 'input', data });
  if (data.includes('\x03')) process.exit(7);
  if (data === 'q') process.exit(0);
  if (data === 'e') process.exit(3);
  if (data === 'c') {
    process.stdout.write('\x1b[H\x1b[J\x1b[999;1HCHILD BOTTOM');
  }
  if (data === 'h') {
    process.stdout.write('\x1b[H\x1b[J');
    process.stdout.write(Array.from({ length: 50 }, (_, i) => `HISTORY-${i}\r\n`).join(''));
  }
});
if (process.env.HUD_TEST_IGNORE_TERM === '1') {
  process.on('SIGTERM', () => record({ type: 'ignored-term' }));
}
if (process.env.HUD_TEST_DESCENDANT === '1') {
  spawn(process.execPath, ['-e', `
    const fs = require('node:fs');
    process.on('SIGTERM', () => {});
    process.on('SIGHUP', () => {});
    fs.writeFileSync(${JSON.stringify(join(process.cwd(), 'descendant-pid'))}, String(process.pid));
    setInterval(() => {}, 100);
  `], { stdio: 'inherit' });
}
if (process.env.HUD_TEST_FLOOD === '1') {
  let counter = 0;
  setInterval(() => {
    process.stdout.write('\x1b[H' + Array.from({ length: 16 }, () =>
      `${String(counter).padStart(8, '0')}${'x'.repeat(70)}\r\n`).join(''));
    counter += 1;
  }, 10);
}
