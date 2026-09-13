import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applyRecord, createState } from './state.js';

/**
 * A bounded, incremental JSONL reader. Buffers bytes until a newline so both
 * UTF-8 characters and JSON records may safely span reads.
 */
export class TranscriptReader {
  constructor({ maxLineBytes = 2 * 1024 * 1024, chunkSize = 64 * 1024, maxReadBytes = 16 * 1024 * 1024 } = {}) {
    for (const value of [maxLineBytes, chunkSize, maxReadBytes]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Reader limits must be positive integers');
    }
    this.maxLineBytes = maxLineBytes;
    this.chunkSize = Math.min(chunkSize, 1024 * 1024);
    this.maxReadBytes = maxReadBytes;
    this.reset(null, null);
  }

  reset(path, identity) {
    this.path = path;
    this.identity = identity;
    this.offset = 0;
    this.lastSize = null;
    this.lastMtime = null;
    this.lastCtime = null;
    this.head = Buffer.alloc(0);
    this.anchor = Buffer.alloc(0);
    this.parts = [];
    this.pendingBytes = 0;
    this.dropping = false;
    this.state = createState();
    this.state.session.path = path;
    this.caughtUp = false;
  }

  consume(chunk) {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline === -1 ? chunk.length : newline;
      const part = chunk.subarray(start, end);
      if (!this.dropping) {
        if (this.pendingBytes + part.length > this.maxLineBytes) {
          this.dropping = true;
          this.parts = [];
          this.pendingBytes = 0;
          this.state.diagnostics.oversizedLines++;
        } else if (part.length) {
          this.parts.push(part);
          this.pendingBytes += part.length;
        }
      }
      if (newline !== -1) {
        if (!this.dropping && this.pendingBytes) {
          const line = Buffer.concat(this.parts, this.pendingBytes).toString('utf8');
          if (line.trim()) {
            try {
              applyRecord(this.state, JSON.parse(line));
            } catch (error) {
              if (!(error instanceof SyntaxError)) throw error;
              this.state.diagnostics.malformedLines++;
            }
          }
        }
        this.parts = [];
        this.pendingBytes = 0;
        this.dropping = false;
      }
      start = end + (newline === -1 ? 0 : 1);
    }
  }

  async read(path) {
    path = resolve(path);
    const file = await open(path, 'r');
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new Error(`Not a regular rollout file: ${path}`);
      const identity = `${stat.dev}:${stat.ino}`;
      let changed = this.path !== path || this.identity !== identity || stat.size < this.offset
        || (stat.size === this.lastSize && (stat.mtimeMs !== this.lastMtime || stat.ctimeMs !== this.lastCtime));
      // Filesystems can give two rapid rewrites identical timestamps. Check the
      // prefix too, so a new session/model cannot hide behind an unchanged tail.
      if (!changed && this.head.length) {
        const current = Buffer.alloc(this.head.length);
        const { bytesRead } = await file.read(current, 0, current.length, 0);
        changed = bytesRead !== current.length || !current.equals(this.head);
      }
      // Catch truncate-and-regrow between polls, including same-length writes.
      if (!changed && this.anchor.length) {
        const current = Buffer.alloc(this.anchor.length);
        const { bytesRead } = await file.read(current, 0, current.length, this.offset - current.length);
        changed = bytesRead !== current.length || !current.equals(this.anchor);
      }
      if (changed) this.reset(path, identity);
      let budget = this.maxReadBytes;
      while (this.offset < stat.size && budget > 0) {
        const length = Math.min(this.chunkSize, stat.size - this.offset, budget);
        const chunk = Buffer.allocUnsafe(length);
        const { bytesRead } = await file.read(chunk, 0, length, this.offset);
        if (!bytesRead) break; // Concurrent truncation is handled on the next read.
        if (this.offset === this.head.length && this.head.length < 4096) {
          this.head = Buffer.concat([this.head, chunk.subarray(0, Math.min(bytesRead, 4096 - this.head.length))]);
        }
        this.consume(chunk.subarray(0, bytesRead));
        this.offset += bytesRead;
        budget -= bytesRead;
      }
      const anchorLength = Math.min(128, this.offset);
      this.anchor = Buffer.alloc(anchorLength);
      await file.read(this.anchor, 0, anchorLength, this.offset - anchorLength);
      this.lastSize = stat.size;
      this.lastMtime = stat.mtimeMs;
      this.lastCtime = stat.ctimeMs;
      this.caughtUp = this.offset >= stat.size;
      return this.state;
    } finally {
      await file.close();
    }
  }
}
