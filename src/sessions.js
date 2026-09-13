import { open, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { isObject, timestamp } from './state.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const metadataCache = new Map();
const MAX_METADATA_BYTES = 2 * 1024 * 1024;

async function collect(dir, result, depth = 0) {
  if (depth > 5) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) return;
    throw error;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await collect(path, result, depth + 1);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) result.push(path);
  }
}

async function metadata(path, info) {
  const key = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`;
  const cached = metadataCache.get(path);
  if (cached?.key === key) return cached.value;
  const file = await open(path, 'r');
  try {
    const parts = [];
    let length = 0;
    while (length < Math.min(info.size, MAX_METADATA_BYTES)) {
      const buffer = Buffer.alloc(Math.min(8192, info.size - length, MAX_METADATA_BYTES - length));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, length);
      if (!bytesRead) return null;
      const chunk = buffer.subarray(0, bytesRead);
      const newline = chunk.indexOf(10);
      parts.push(newline === -1 ? chunk : chunk.subarray(0, newline));
      length += bytesRead;
      if (newline !== -1) {
        let record;
        try { record = JSON.parse(Buffer.concat(parts).toString('utf8')); }
        catch { return null; }
        if (record?.type !== 'session_meta' || !isObject(record.payload)) return null;
        // Retain only selection metadata; the first line includes private instructions.
        const payload = record.payload;
        const source = payload.source;
        const child = Boolean(payload.parent_thread_id)
          || (isObject(source) && ('subagent' in source || 'internal' in source))
          || (typeof source === 'string' && /^(subagent|internal)/i.test(source))
          || ['subagent', 'guardian_review', 'memory_consolidation'].includes(payload.thread_source);
        const value = {
          id: payload.id ?? payload.session_id,
          cwd: typeof payload.cwd === 'string' ? payload.cwd : null,
          startedAt: timestamp(payload.timestamp ?? record.timestamp),
          child,
        };
        metadataCache.set(path, { key, value });
        if (metadataCache.size > 512) metadataCache.delete(metadataCache.keys().next().value);
        return value;
      }
    }
    return null;
  } finally {
    await file.close();
  }
}

async function canonical(path) {
  return realpath(path).catch(() => resolve(path));
}

/**
 * Root-session auto-selection is intentionally scoped to the exact cwd.
 * Explicit paths/UUIDs never silently fall back to an unrelated session.
 */
export async function findSession({ codexHome, cwd, session, since }) {
  if (session && !UUID.test(session)) {
    const path = resolve(cwd, session);
    const info = await stat(path).catch(error => {
      if (error.code === 'ENOENT') throw new Error(`Session not found: ${session}`);
      throw error;
    });
    if (!info.isFile()) throw new Error(`Not a session file: ${session}`);
    return path;
  }
  const paths = [];
  await collect(join(codexHome, 'sessions'), paths);
  if (session) await collect(join(codexHome, 'archived_sessions'), paths);
  const candidates = [];
  // Bounded concurrency avoids exhausting descriptors in large Codex histories.
  for (let offset = 0; offset < paths.length; offset += 32) {
    const results = await Promise.all(paths.slice(offset, offset + 32).map(async path => {
      try { return { path, info: await stat(path) }; }
      catch (error) {
        if (['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) return null;
        throw error;
      }
    }));
    candidates.push(...results.filter(Boolean));
  }
  candidates.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs || b.path.localeCompare(a.path));
  const wantedCwd = await canonical(cwd);
  for (const { path, info } of candidates) {
    let meta;
    try { meta = await metadata(path, info); }
    catch (error) {
      if (['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) continue;
      throw error;
    }
    if (!meta) continue;
    if (session) {
      if (typeof meta.id === 'string' && meta.id.toLowerCase() === session.toLowerCase()) return path;
      continue;
    }
    if (meta.child || !meta.cwd || !isAbsolute(meta.cwd)) continue;
    if (since !== undefined && (meta.startedAt === null || meta.startedAt < since)) continue;
    if (await canonical(meta.cwd) === wantedCwd) return path;
  }
  if (session) throw new Error(`Session not found: ${session}`);
  return null;
}
