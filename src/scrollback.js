import xterm from '@xterm/headless';
import unicode from '@xterm/addon-unicode11';

/** Determine which rendered rows a normal host terminal archives on resize. */
export async function resizedHostHistory({ columns, rows, nextColumns, nextRows, lines,
  cursorRow, cursorColumn, renderLine }) {
  const terminal = new xterm.Terminal({
    cols: columns, rows, allowProposedApi: true, scrollback: 5000, logLevel: 'off',
  });
  terminal.loadAddon(new unicode.Unicode11Addon());
  terminal.unicode.activeVersion = '11';
  try {
    // One history row gives us an anchor before the owned viewport. Earlier
    // user history does not affect which viewport rows a resize moves above it.
    const frame = '\x1b[?7l' + '\r\n'.repeat(rows)
      + lines.map((line, row) => `\x1b[${row + 1};1H\x1b[0m\x1b[2K${line}`).join('')
      + `\x1b[${cursorRow};${cursorColumn}H`;
    await new Promise(resolve => terminal.write(frame, resolve));
    const marker = terminal.registerMarker(-terminal.buffer.normal.cursorY - 1);
    terminal.resize(nextColumns, nextRows);
    const buffer = terminal.buffer.normal;
    const start = marker && !marker.isDisposed ? marker.line + 1 : 0;
    const cell = buffer.getNullCell();
    const archived = [];
    for (let row = start; row < buffer.baseY; row += 1) {
      const line = buffer.getLine(row);
      if (line) archived.push(renderLine(line, nextColumns, cell));
    }
    return archived;
  } finally {
    terminal.dispose();
  }
}

/** Transfer completed normal-buffer rows without retaining repeated HUD frames. */
export class NativeScrollback {
  constructor(terminal, renderLine, maxLines = 5000) {
    this.terminal = terminal;
    this.renderLine = renderLine;
    this.maxLines = maxLines;
    this.pending = [];
    this.marker = null;
    this.nextMarker = null;
    this.offset = 0;
    this.nextOffset = 0;
    this.nextLine = 0;
    this.alreadyScrolled = [];
    this.checkpoint(terminal.buffer.normal.baseY);
    this.subscriptions = [
      terminal.buffer.onBufferChange(() => this.capture()),
      terminal.onScroll(() => this.capture()),
    ];
  }

  checkpoint(nextLine) {
    const buffer = this.terminal.buffer.normal;
    if (this.terminal.buffer.active.type === 'normal') {
      this.marker?.dispose();
      this.nextMarker?.dispose();
      // Anchor in completed history: ED/EL may erase markers on visible rows.
      const anchor = Math.min(nextLine - 1, buffer.baseY - 1);
      this.marker = anchor >= 0
        ? this.terminal.registerMarker(anchor - buffer.baseY - buffer.cursorY) ?? null
        : null;
      this.offset = this.marker ? nextLine - anchor - 1 : 0;
      this.nextMarker = this.terminal.registerMarker(nextLine - buffer.baseY - buffer.cursorY) ?? null;
      this.nextOffset = 0;
    } else if (this.marker && !this.marker.isDisposed) {
      this.offset = nextLine - this.marker.line - 1;
    } else {
      this.marker = null;
      this.offset = 0;
    }
    if (this.terminal.buffer.active.type !== 'normal' && this.nextMarker && !this.nextMarker.isDisposed) {
      this.nextOffset = nextLine - this.nextMarker.line;
    }
    this.nextLine = nextLine;
  }

  reset() {
    this.marker?.dispose();
    this.nextMarker?.dispose();
    this.marker = null;
    this.nextMarker = null;
    this.offset = 0;
    this.nextOffset = 0;
    this.nextLine = 0;
    this.alreadyScrolled = [];
  }

  skipAlreadyScrolled(line) {
    if (!this.alreadyScrolled.length) return false;
    if (this.alreadyScrolled.shift() === line) return true;
    this.alreadyScrolled = [];
    return false;
  }

  accountHostScroll(lines) {
    this.alreadyScrolled = [...lines];
    this.pending = this.pending.filter(line => !this.skipAlreadyScrolled(line));
  }

  capture({ resized = false } = {}) {
    const buffer = this.terminal.buffer.normal;
    // Markers follow history trimming. Reflow can remove one entirely; the host
    // already reflows its history, so don't replay that history after a resize.
    const nextLost = this.nextMarker?.isDisposed;
    const lost = this.marker?.isDisposed;
    let start = this.nextLine;
    if (this.nextMarker && !nextLost) {
      start = this.nextMarker.line + this.nextOffset;
    } else if (lost) {
      start = resized ? buffer.baseY : 0;
    } else if (this.marker) {
      start = this.marker.line + 1 + (nextLost && !resized ? 0 : this.offset);
    } else if (nextLost && !resized) {
      start = 0;
    }
    start = Math.max(0, start);
    for (let row = start; row < buffer.baseY; row += 1) {
      const line = buffer.getLine(row);
      if (line) {
        const rendered = this.renderLine(line);
        if (!this.skipAlreadyScrolled(rendered)) this.pending.push(rendered);
      }
    }
    if (this.pending.length > this.maxLines) {
      this.pending.splice(0, this.pending.length - this.maxLines);
    }
    // Growing the viewport can reveal rows that have already been transferred.
    this.checkpoint(Math.max(start, buffer.baseY));
  }

  take() {
    const lines = this.pending;
    this.pending = [];
    this.alreadyScrolled = [];
    return lines;
  }

  dispose() {
    for (const subscription of this.subscriptions) subscription.dispose();
    this.marker?.dispose();
    this.nextMarker?.dispose();
    this.pending = [];
  }
}
