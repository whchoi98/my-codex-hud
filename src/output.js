import { createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';

/**
 * Node's POSIX process.stdout is a synchronous TTY stream. Its write() can
 * block before returning false, preventing even signal handlers from running.
 * Async filesystem writes use the same fd and preserve ordering/backpressure
 * without blocking the JS event loop. The caller still owns the descriptor.
 */
export function terminalOutput(stdout) {
  if (!Number.isInteger(stdout.fd) || stdout.fd < 0) {
    return { stream: stdout, finish: async () => {} };
  }
  const stream = createWriteStream(null, {
    fd: stdout.fd, autoClose: false, emitClose: false, highWaterMark: 16 * 1024,
  });
  return {
    stream,
    async finish() {
      const done = finished(stream, { cleanup: true });
      stream.end();
      await done;
    },
  };
}
