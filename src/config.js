import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const defaults = Object.freeze({
  preset: 'full',
  language: 'en',
  interval: 1000,
  width: null,
  pathLevels: 1,
  color: true,
  ascii: false,
  git: true,
  mouse: false,
});

function validate(config) {
  for (const key of Object.keys(config)) {
    if (!Object.hasOwn(defaults, key)) throw new Error(`Unknown HUD preference: ${key}`);
  }
  if (!['full', 'essential', 'minimal'].includes(config.preset)) throw new Error('preset must be full, essential, or minimal');
  if (!['en', 'ko'].includes(config.language)) throw new Error('language must be en or ko');
  if (!Number.isInteger(config.interval) || config.interval < 200 || config.interval > 60_000) {
    throw new Error('interval must be an integer between 200 and 60000 milliseconds');
  }
  if (config.width !== null && (!Number.isInteger(config.width) || config.width < 1 || config.width > 1000)) {
    throw new Error('width must be an integer between 1 and 1000');
  }
  if (![1, 2, 3].includes(config.pathLevels)) throw new Error('pathLevels must be 1, 2, or 3');
  for (const key of ['color', 'ascii', 'git', 'mouse']) {
    if (typeof config[key] !== 'boolean') throw new Error(`${key} must be true or false`);
  }
  return config;
}

export async function loadConfig({ codexHome, configPath, overrides = {} }) {
  const path = configPath ?? join(codexHome, 'codex-hud.json');
  let stored = {};
  try {
    if ((await stat(path)).size > 65536) throw new Error(`HUD config is too large: ${path}`);
    try { stored = JSON.parse(await readFile(path, 'utf8')); }
    catch (error) {
      if (error instanceof SyntaxError) throw new Error(`Invalid JSON in HUD config: ${path}`);
      throw error;
    }
    if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) {
      throw new Error('HUD config must be a JSON object');
    }
  } catch (error) {
    if (error.code !== 'ENOENT' || configPath) throw error;
  }
  const explicit = Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined));
  return validate({ ...defaults, ...stored, ...explicit });
}

export function nativeStatusLine(preset = 'full') {
  const items = preset === 'minimal'
    ? ['model-with-reasoning', 'context-remaining']
    : ['model-with-reasoning', 'current-dir', 'git-branch', 'context-remaining', 'five-hour-limit', 'weekly-limit'];
  if (preset === 'full') items.push('used-tokens');
  return `[tui]\nstatus_line = ${JSON.stringify(items)}\n`;
}
