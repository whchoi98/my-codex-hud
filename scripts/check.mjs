import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const files = [];
async function collect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (/\.[cm]?js$/.test(entry.name)) files.push(path);
  }
}
await Promise.all(['bin', 'src', 'scripts', 'tests'].map(collect));
const results = await Promise.allSettled(files.map(file => exec(process.execPath, ['--check', file])));
for (let i = 0; i < results.length; i++) {
  if (results[i].status === 'rejected') {
    console.error(files[i], results[i].reason.stderr || results[i].reason.message);
    process.exitCode = 1;
  }
}
if (!process.exitCode) console.log(`Syntax checked ${files.length} JavaScript files.`);
