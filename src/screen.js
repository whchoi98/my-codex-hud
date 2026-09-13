import xterm from '@xterm/headless';
import unicode from '@xterm/addon-unicode11';
import { HudViewport } from './viewport.js';
import { renderSelectionHint } from './render.js';
import { NativeScrollback, resizedHostHistory } from './scrollback.js';

const heights = { full: 7, essential: 5, minimal: 2 };
const csi = '\x1b[';
const mouseModes = { none: 0, x10: 9, vt200: 1000, drag: 1002, any: 1003 };

export function screenLayout(columns, rows, preset = 'full', contentRows = 0, nativeScrollback = false) {
  if (!Object.hasOwn(heights, preset)) throw new Error('Unknown HUD preset.');
  columns = Math.max(1, Math.min(1000, Math.floor(columns) || 80));
  rows = Math.max(1, Math.min(1000, Math.floor(rows) || 24));
  const wantedRows = preset === 'full' ? Math.max(heights[preset], contentRows) : heights[preset];
  const hudRows = Math.min(wantedRows, Math.max(0, rows - 5));
  const separatorRows = hudRows > 0 ? 1 : 0;
  // Keep the physical cursor above the bottom row even when the HUD is hidden.
  // Growing a normal terminal can otherwise pull old history into the viewport.
  const paddingRows = nativeScrollback && hudRows === 0 && rows > 1 ? 1 : 0;
  // xterm requires at least two columns for wide characters. Keep the physical
  // width separate so neither child cells nor the HUD paint outside the host.
  return {
    columns, ptyColumns: Math.max(2, columns), rows,
    codexRows: rows - hudRows - separatorRows - paddingRows, hudRows, separatorRows,
    ...(paddingRows ? { paddingRows } : {}),
  };
}

function color(cell, foreground) {
  const prefix = foreground ? 'Fg' : 'Bg';
  const value = cell[`get${prefix}Color`]();
  const code = foreground ? 38 : 48;
  if (cell[`is${prefix}RGB`]()) return `${code};2;${value >>> 16};${(value >>> 8) & 255};${value & 255}`;
  if (cell[`is${prefix}Palette`]()) return `${code};5;${value}`;
  return foreground ? '39' : '49';
}

function attributes(cell) {
  if (cell.isAttributeDefault()) return '';
  const codes = [0];
  for (const [method, code] of [
    ['isBold', 1], ['isDim', 2], ['isItalic', 3], ['isUnderline', 4],
    ['isBlink', 5], ['isInverse', 7], ['isInvisible', 8],
    ['isStrikethrough', 9], ['isOverline', 53],
  ]) {
    if (cell[method]()) codes.push(code);
  }
  codes.push(color(cell, true), color(cell, false));
  return `${csi}${codes.join(';')}m`;
}

function lineText(line, columns, cell) {
  if (!line) return '';
  let output = '';
  let lastPainted = 0;
  let previousStyle = '';
  for (let column = 0; column < columns; column += 1) {
    line.getCell(column, cell);
    if (cell.getWidth() === 0) continue;
    if (column + cell.getWidth() > columns) break;
    const style = attributes(cell);
    if (style !== previousStyle) output += style || `${csi}0m`;
    previousStyle = style;
    output += cell.getChars() || ' ';
    if (style || (cell.getChars() && cell.getChars() !== ' ')) lastPainted = output.length;
  }
  return output.slice(0, lastPainted);
}

/**
 * Owns the virtual Codex screen, never the physical terminal. Child output is
 * parsed before painting, so CUP/ED/scroll/alternate-screen escapes cannot
 * address HUD rows. setHud accepts only our already-sanitized renderer output.
 */
export class InlineScreen {
  constructor({ columns, rows, preset = 'full', ascii = false, color: useColor = true, mouse = false,
    language = 'en', nativeScrollback = false, onLanguageChange = () => {},
    onResponse = () => {}, onHostWrite = () => {} } = {}) {
    this.preset = preset;
    this.ascii = ascii;
    this.color = useColor;
    this.mouse = mouse;
    this.nativeScrollback = nativeScrollback;
    this.language = language === 'ko' ? 'ko' : 'en';
    this.onLanguageChange = onLanguageChange;
    this.layout = screenLayout(columns, rows, preset, 0, nativeScrollback);
    this.terminal = new xterm.Terminal({
      cols: this.layout.ptyColumns, rows: this.layout.codexRows,
      allowProposedApi: true, scrollback: 5000,
      windowOptions: { getWinSizeChars: true },
      // The physical terminal already delivers CR/LF according to the PTY.
      convertEol: false, logLevel: 'off',
    });
    this.terminal.loadAddon(new unicode.Unicode11Addon());
    this.terminal.unicode.activeVersion = '11';
    const historyCell = this.terminal.buffer.normal.getNullCell();
    this.scrollback = nativeScrollback ? new NativeScrollback(this.terminal,
      line => lineText(line, this.layout.columns, historyCell)) : null;
    this.cursorVisible = true;
    this.cursorStyle = 0;
    this.sgrMouse = false;
    this.hud = new HudViewport();
    this.hud.resize(this.layout.hudRows);
    this.previousRows = [];
    this.previousState = '';
    this.previousModes = '';
    this.previousMouse = '';
    this.hostCursorRow = 1;
    this.hostCursorColumn = 1;
    this.hostLayout = this.layout;
    this.hostResizeSequence = 0;
    this.resizingHost = false;
    this.selecting = false;
    this.selectionPainted = false;
    this.pendingInput = '';
    this.pasting = false;
    this.disposed = false;
    const parser = this.terminal.parser;
    this.terminal.onData(onResponse);
    this.terminal.onBinary(data => onResponse(Buffer.from(data, 'binary')));
    for (const [final, enabled] of [['h', true], ['l', false]]) {
      parser.registerCsiHandler({ prefix: '?', final }, params => {
        if (params.includes(25)) this.cursorVisible = enabled;
        if (params.includes(1006)) this.sgrMouse = enabled;
        return false;
      });
    }
    parser.registerCsiHandler({ intermediates: ' ', final: 'q' }, params => {
      this.cursorStyle = Number.isInteger(params[0]) && params[0] <= 6 ? params[0] : 0;
      return false;
    });
    parser.registerEscHandler({ final: 'c' }, () => {
      this.scrollback?.capture();
      this.scrollback?.reset();
      this.cursorVisible = true;
      this.cursorStyle = 0;
      this.sgrMouse = false;
      return false;
    });
    parser.registerCsiHandler({ intermediates: '!', final: 'p' }, () => {
      this.cursorVisible = true;
      this.cursorStyle = 0;
      return false;
    });
    parser.registerCsiHandler({ final: 't' }, params => {
      if (params[0] === 18) {
        onResponse(`${csi}8;${this.layout.codexRows};${this.layout.ptyColumns}t`);
        return true;
      }
      // A child cannot resize, minimize, or move the user's terminal window.
      return true;
    });
    // Resolve theme queries in the real terminal. Its replies arrive on stdin
    // and are forwarded to Codex, preserving light/dark theme detection.
    for (const id of [10, 11, 12]) {
      parser.registerOscHandler(id, data => {
        if (data === '?') onHostWrite(`\x1b]${id};?\x1b\\`);
        return true;
      });
    }
    // Preserve Codex's explicit clipboard writes, without interpreting any
    // arbitrary child escape sequences in the physical display.
    parser.registerOscHandler(52, data => {
      if (data.length <= 1024 * 1024 && /^[cps0-7]*;[A-Za-z0-9+/=]*$/.test(data)) {
        onHostWrite(`\x1b]52;${data}\x1b\\`);
      }
      return true;
    });
  }

  write(data) {
    if (this.disposed) return Promise.resolve();
    return new Promise((resolve, reject) => this.terminal.write(data, () => {
      try {
        this.scrollback?.capture();
        resolve();
      } catch (error) { reject(error); }
    }));
  }

  setHud(text) {
    this.hud.setText(text);
    return this.resize(this.layout.columns, this.layout.rows);
  }

  resize(columns, rows) {
    const next = screenLayout(columns, rows, this.preset, this.hud.lines.length, this.nativeScrollback);
    this.hud.resize(next.hudRows);
    if (next.columns === this.layout.columns && next.rows === this.layout.rows
      && next.codexRows === this.layout.codexRows) return false;
    this.layout = next;
    this.terminal.resize(next.ptyColumns, next.codexRows);
    this.scrollback?.capture({ resized: true });
    this.previousRows = [];
    this.previousState = '';
    return true;
  }

  async resizeHost(columns, rows) {
    const next = screenLayout(columns, rows, this.preset, this.hud.lines.length, this.nativeScrollback);
    const sequence = ++this.hostResizeSequence;
    if (!this.scrollback || !this.previousRows.length
      || (next.columns === this.hostLayout.columns && next.rows === this.hostLayout.rows)) {
      this.resizingHost = false;
      return this.resize(columns, rows);
    }
    this.resizingHost = true;
    try {
      const archived = await resizedHostHistory({
        columns: this.hostLayout.columns, rows: this.hostLayout.rows,
        nextColumns: next.columns, nextRows: next.rows, lines: this.previousRows,
        cursorRow: this.hostCursorRow, cursorColumn: this.hostCursorColumn,
        renderLine: lineText,
      });
      if (this.disposed || sequence !== this.hostResizeSequence) return false;
      this.scrollback.accountHostScroll(archived);
      this.resize(columns, rows);
      return true;
    } finally {
      if (sequence === this.hostResizeSequence) this.resizingHost = false;
    }
  }

  setSelectionMode(enabled) {
    if (this.selecting === enabled) return;
    this.selecting = enabled;
    this.selectionPainted = false;
    this.previousRows = [];
    this.previousState = '';
  }

  /** Return only changed rows, followed by the child's actual cursor/modes. */
  frame({ force = false } = {}) {
    if (this.resizingHost) return '';
    if (this.selecting && this.selectionPainted) return '';
    const { columns, codexRows, hudRows, separatorRows } = this.layout;
    const history = this.scrollback?.take() ?? [];
    const buffer = this.terminal.buffer.active;
    const cell = buffer.getNullCell();
    const rows = Array.from({ length: codexRows }, (_, row) =>
      lineText(buffer.getLine(buffer.viewportY + row), columns, cell));
    if (separatorRows) {
      const separator = (this.ascii ? '-' : '─').repeat(columns);
      rows.push(this.color ? `${csi}90m${separator}${csi}0m` : separator);
      const hud = this.hud.view(columns, { color: this.color, ascii: this.ascii });
      if (this.selecting) hud[0] = renderSelectionHint({
        width: columns, language: this.language, color: this.color, ascii: this.ascii,
      });
      for (let row = 0; row < hudRows; row += 1) rows.push(hud[row] ?? '');
    }
    while (rows.length < this.layout.rows) rows.push('');
    const modes = this.terminal.modes;
    // Mouse reporting consumes the press that starts native text selection.
    // Capture (including child requests) requires opt-in; keyboard history
    // navigation remains available without it.
    const mouse = this.mouse && !this.selecting ? mouseModes[modes.mouseTrackingMode] || 1000 : 0;
    const cursorRow = buffer.cursorY + buffer.baseY - buffer.viewportY;
    const visible = !this.selecting && this.cursorVisible && cursorRow >= 0 && cursorRow < codexRows;
    const cursor = `${csi}${Math.min(codexRows, cursorRow + 1)};${Math.min(columns, buffer.cursorX + 1)}H`;
    const modeState = [
      `${csi}?1${modes.applicationCursorKeysMode ? 'h' : 'l'}`,
      modes.applicationKeypadMode ? '\x1b=' : '\x1b>',
      `${csi}?2004${modes.bracketedPasteMode ? 'h' : 'l'}`,
      `${csi}?1004${modes.sendFocusMode ? 'h' : 'l'}`,
    ].join('');
    const mouseState = [
      `${csi}?9l${csi}?1000l${csi}?1002l${csi}?1003l`,
      `${csi}?1006${mouse ? 'h' : 'l'}`,
      mouse ? `${csi}?${mouse}h` : '',
    ].join('');
    const state = `${csi}${this.cursorStyle} q${cursor}${csi}?25${visible ? 'h' : 'l'}`;
    let changes = '';
    for (let row = 0; row < rows.length; row += 1) {
      if (force || history.length || rows[row] !== this.previousRows[row]) {
        changes += `${csi}${row + 1};1H${csi}0m${csi}2K${rows[row]}`;
      }
    }
    const changedModes = (modeState !== this.previousModes ? modeState : '')
      + (mouseState !== this.previousMouse ? mouseState : '');
    if (!changes && !force && !changedModes && state === this.previousState) return '';
    this.previousRows = rows;
    this.previousState = state;
    this.previousModes = modeState;
    this.previousMouse = mouseState;
    this.hostCursorRow = Math.max(1, Math.min(codexRows, cursorRow + 1));
    this.hostCursorColumn = Math.min(columns, buffer.cursorX + 1);
    this.hostLayout = this.layout;
    this.selectionPainted = this.selecting;
    // Autowrap is disabled only in the outer screen; the emulator retains the
    // child's wrap mode. In particular, painting its last cell cannot scroll.
    // LF at the host's bottom row creates real scrollback. Replace its top row
    // first so only completed Codex output, never a HUD frame, enters history.
    const historyOutput = history.length
      ? `${csi}r` + history.map(line =>
        `${csi}1;1H${csi}0m${csi}2K${line}${csi}${this.layout.rows};1H\r\n`).join('')
      : '';
    return `${csi}?2026h${csi}?25l${csi}?7l${historyOutput}${changes}${csi}0m${changedModes}${state}${csi}?2026l`;
  }

  /**
   * Consume decoded UTF-8 host input. Returns a string, or a Buffer when legacy
   * mouse reports need raw bytes; pass either directly to the child's write().
   * Filtered or incomplete input returns ''. Paste contents remain UTF-8 text.
   */
  input(data) {
    this.pendingInput += data;
    let output = '';
    const binary = [];
    while (this.pendingInput) {
      if (this.pasting) {
        const end = this.pendingInput.indexOf('\x1b[201~');
        if (end !== -1) {
          output += this.pendingInput.slice(0, end + 6);
          this.pendingInput = this.pendingInput.slice(end + 6);
          this.pasting = false;
          continue;
        }
        let keep = 0;
        for (let length = 1; length < 6; length += 1) {
          if (this.pendingInput.endsWith('\x1b[201~'.slice(0, length))) keep = length;
        }
        output += this.pendingInput.slice(0, this.pendingInput.length - keep);
        this.pendingInput = this.pendingInput.slice(this.pendingInput.length - keep);
        break;
      }
      const textEnd = this.pendingInput.indexOf('\x1b');
      if (textEnd !== 0) {
        const count = textEnd === -1 ? this.pendingInput.length : textEnd;
        this.setSelectionMode(false);
        output += this.pendingInput.slice(0, count);
        this.pendingInput = this.pendingInput.slice(count);
        continue;
      }
      if (this.pendingInput.length === 1) break;
      // Theme replies are terminal protocol, not Alt-key shortcuts or typing.
      if (this.pendingInput[1] === ']') {
        const end = /\x07|\x1b\\/.exec(this.pendingInput.slice(2));
        const cancel = this.pendingInput.search(/[\x03\x04]/);
        if (cancel >= 0 && (!end || cancel < end.index + 2)) {
          this.pendingInput = this.pendingInput.slice(cancel);
          continue;
        }
        const escape = this.pendingInput.indexOf('\x1b', 2);
        if (escape >= 0 && this.pendingInput[escape + 1] && this.pendingInput[escape + 1] !== '\\'
          && (!end || escape < end.index + 2)) {
          this.pendingInput = this.pendingInput.slice(escape);
          continue;
        }
        if (!end && this.pendingInput.length < 4096) break;
        const length = end ? end.index + end[0].length + 2 : this.pendingInput.length;
        output += this.pendingInput.slice(0, length);
        this.pendingInput = this.pendingInput.slice(length);
        continue;
      }
      let sequence;
      if (this.pendingInput[1] === '[') {
        sequence = /^\x1b\[[0-?]*[ -/]*[@-~]/.exec(this.pendingInput)?.[0];
        if (!sequence && /^\x1b\[[0-?]*[ -/]*$/.test(this.pendingInput) && this.pendingInput.length < 256) break;
      } else if (this.pendingInput[1] === 'O' && this.pendingInput.length < 3) break;
      sequence ??= this.pendingInput.slice(0, this.pendingInput[1] === 'O' ? 3 : 2);
      this.pendingInput = this.pendingInput.slice(sequence.length);
      if (sequence === '\x1b[I' || sequence === '\x1b[O') {
        output += sequence;
        continue;
      }
      if (sequence === '\x1bl' || sequence === '\x1bL') {
        this.setSelectionMode(false);
        this.language = this.language === 'ko' ? 'en' : 'ko';
        this.onLanguageChange(this.language);
        continue;
      }
      if (sequence === '\x1bm' || sequence === '\x1bM') {
        this.setSelectionMode(!this.selecting);
        continue;
      }
      // With capture released, alternate-screen terminals may translate the
      // wheel into cursor keys. Selection browsing must never edit Codex's prompt.
      if (this.selecting && ['\x1b[A', '\x1b[B', '\x1bOA', '\x1bOB'].includes(sequence)) {
        this.terminal.scrollLines(sequence.endsWith('A') ? -1 : 1);
        this.selectionPainted = false;
        continue;
      }
      const mouse = /^\x1b\[<(\d+);(\d+);(\d+)[Mm]$/.exec(sequence);
      if (mouse && (this.selecting || !this.mouse)) continue;
      if (!mouse) this.setSelectionMode(false);
      if (sequence === '\x1b[200~') this.pasting = true;
      if (['\x1b[5;3~', '\x1b[6;3~'].includes(sequence)) {
        this.hud.page(sequence === '\x1b[5;3~' ? -1 : 1);
        continue;
      }
      if (['\x1b[5;2~', '\x1b[6;2~'].includes(sequence)
        && this.terminal.buffer.active.type === 'normal') {
        this.terminal.scrollLines(sequence === '\x1b[5;2~' ? -this.layout.codexRows : this.layout.codexRows);
        continue;
      }
      if (mouse) {
        const [, button, x, y] = mouse.map(Number);
        if (x < 1 || x > this.layout.columns || y < 1 || y > this.layout.rows) continue;
        if (y > this.layout.codexRows) {
          const wheel = button & ~28;
          if (y > this.layout.codexRows + this.layout.separatorRows && sequence.endsWith('M')
            && (wheel === 64 || wheel === 65)) {
            this.hud.scroll(wheel === 65 ? 3 : -3);
          }
          continue;
        }
        if (this.terminal.modes.mouseTrackingMode === 'none') {
          if (button & 64) {
            const direction = button & 1 ? 1 : -1;
            if (this.terminal.buffer.active.type === 'normal') this.terminal.scrollLines(direction * 3);
          }
          // Alt+M releases capture for native text selection.
          continue;
        }
        if (!this.sgrMouse) {
          // Legacy release reports encode button 3 instead of the SGR button.
          // Coordinates and event codes must fit single bytes, without UTF-8
          // re-encoding values above 0x7f or wrapping unrepresentable positions.
          if (button > 223 || x > 223 || y > 223) continue;
          const code = sequence.endsWith('m') ? button | 3 : button;
          if (output) {
            binary.push(Buffer.from(output, 'utf8'));
            output = '';
          }
          binary.push(Buffer.from([27, 91, 77, code + 32, x + 32, y + 32]));
          continue;
        }
      }
      output += sequence;
    }
    if (!this.selecting && (output || binary.length)) this.terminal.scrollToBottom();
    return binary.length ? Buffer.concat([...binary, Buffer.from(output, 'utf8')]) : output;
  }

  /** An isolated Escape key must not wait indefinitely for another byte. */
  flushInput() {
    if (this.pasting) return '';
    let data = this.pendingInput;
    this.pendingInput = '';
    if (data.startsWith('\x1b]') && data.endsWith('\x1b')) data = '\x1b';
    if (data === '\x1b' && this.selecting) {
      this.setSelectionMode(false);
      return '';
    }
    return data;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scrollback?.dispose();
    this.terminal.dispose();
  }
}
