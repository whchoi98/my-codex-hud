#!/usr/bin/env node
import { main } from '../src/cli.js';
import { sanitizeText } from '../src/terminal.js';

process.stdout.on('error', error => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});
try {
  await main();
} catch (error) {
  process.stderr.write(`codex-hud: ${sanitizeText(error.message ?? error)}\n`);
  process.exitCode = 1;
}
