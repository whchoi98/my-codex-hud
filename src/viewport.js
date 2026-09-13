import { displayWidth, truncateText } from './terminal.js';

function clipLine(text, columns) {
  if (displayWidth(text) <= columns) return text;
  // Cached colored rows can outlive a terminal resize. Keep complete graphemes
  // and renderer-owned SGR, without painting beyond the new terminal width.
  let remaining = truncateText(text, columns, '').length;
  let output = '';
  for (const part of text.split(/(\x1b\[[0-9;]*m)/u)) {
    if (!remaining) break;
    if (part.startsWith('\x1b[')) output += part;
    else {
      output += part.slice(0, remaining);
      remaining -= Math.min(remaining, part.length);
    }
  }
  return `${output}\x1b[0m`;
}

/** Scroll an already-rendered HUD without discarding agents below the screen. */
export class HudViewport {
  constructor() {
    this.lines = [];
    this.height = 0;
    this.offset = 0;
  }

  get contentRows() {
    return this.height > 1 && this.lines.length > this.height ? this.height - 1 : this.height;
  }

  setText(text) {
    this.lines = text ? text.split('\n') : [];
    this.scroll(0);
  }

  resize(height) {
    this.height = Math.max(0, Math.floor(height));
    this.scroll(0);
  }

  scroll(delta) {
    const before = this.offset;
    this.offset = Math.max(0, Math.min(this.offset + delta, Math.max(0, this.lines.length - this.contentRows)));
    return before !== this.offset;
  }

  page(direction) {
    return this.scroll(direction * this.contentRows);
  }

  view(columns, { color = true, ascii = false } = {}) {
    if (!this.height) return [];
    const end = Math.min(this.lines.length, this.offset + this.contentRows);
    const rows = this.lines.slice(this.offset, end).map(line => clipLine(line, columns));
    if (this.contentRows < this.height) {
      const hint = `HUD ${this.offset + 1}-${end}/${this.lines.length}${ascii ? ' | ' : ' · '}Alt+PgUp/PgDn`;
      const clipped = truncateText(hint, columns, ascii ? '.' : '…');
      rows.push(color ? `\x1b[2m${clipped}\x1b[0m` : clipped);
    }
    return rows;
  }
}
