const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
const marksOrIgnorable = /[\p{Mark}\p{Default_Ignorable_Code_Point}]/u;
const emojiPresentation = /\p{Emoji_Presentation}/u;
const pictograph = /\p{Extended_Pictographic}/u;
const emoji = /\p{Emoji}/u;
const plainAscii = /^[\x20-\x7e]*$/;

function skipCsi(text, index) {
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) return index + 1;
    // A new escape cancels an incomplete CSI; handle it in the outer scanner.
    if (code === 0x1b || code > 0x7e) return index;
    index += 1;
  }
  return index;
}

function skipString(text, index, osc) {
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === 0x9c || (osc && code === 0x07)) return index + 1;
    if (code === 0x1b && text[index + 1] === '\\') return index + 2;
    index += 1;
  }
  // Discard unterminated strings too: their payload is not visible text.
  return index;
}

/**
 * sanitizeText(value) -> plain, single-line string.
 * Null/undefined become ''; other values are stringified. Removes all incoming
 * terminal escapes (including OSC/DCS/APC/PM/SOS), controls and bidi formatting.
 * Line breaks/tabs become spaces. Combining marks, emoji joiners and variation
 * selectors are retained. No incoming SGR styling is trusted.
 */
export function sanitizeText(value) {
  if (value == null) return '';
  const text = String(value);
  if (plainAscii.test(text)) return text;

  let result = '';
  for (let index = 0; index < text.length;) {
    const code = text.charCodeAt(index);
    if (code === 0x1b) {
      index += 1;
      const next = text[index];
      if (next === '[') {
        index = skipCsi(text, index + 1);
      } else if (next && ']PX^_'.includes(next)) {
        index = skipString(text, index + 1, next === ']');
      } else {
        // ECMA-48 escape sequences: optional intermediate bytes, then a final.
        while (text.charCodeAt(index) >= 0x20 && text.charCodeAt(index) <= 0x2f) index += 1;
        if (text.charCodeAt(index) >= 0x30 && text.charCodeAt(index) <= 0x7e) index += 1;
      }
    } else if (code === 0x9b) {
      index = skipCsi(text, index + 1);
    } else if ([0x90, 0x98, 0x9d, 0x9e, 0x9f].includes(code)) {
      index = skipString(text, index + 1, code === 0x9d);
    } else {
      result += text[index];
      index += 1;
    }
  }

  return result
    .replace(/[\t-\r\u0085\u2028\u2029]+/gu, ' ')
    .replace(/[\x00-\x1f\x7f-\x9f]|\p{Bidi_Control}/gu, '')
    .replace(/\p{Cf}/gu, (character) => {
      const code = character.codePointAt(0);
      // Joiners and emoji tag sequences are needed for intact graphemes.
      return code === 0x200c || code === 0x200d || (code >= 0xe0020 && code <= 0xe007f)
        ? character : '';
    })
    .replace(/[\ud800-\udfff]/gu, '\ufffd');
}

function isWide(code) {
  return code >= 0x1100 && (
    code <= 0x115f
    || code === 0x2329 || code === 0x232a
    || (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f && !(code >= 0x3248 && code <= 0x324f))
    || (code >= 0xa960 && code <= 0xa97c)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe10 && code <= 0xfe19)
    || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff01 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x16fe0 && code <= 0x16fe4)
    || (code >= 0x16ff0 && code <= 0x16ff1)
    || (code >= 0x17000 && code <= 0x18dff)
    || (code >= 0x1aff0 && code <= 0x1afff)
    || (code >= 0x1b000 && code <= 0x1b2ff)
    || (code >= 0x1f200 && code <= 0x1f251)
    || (code >= 0x20000 && code <= 0x3fffd)
  );
}

function graphemeWidth(text) {
  if (text.includes('\u20e3') && /^[#*0-9]/u.test(text)) return 2;
  if (!text.includes('\ufe0e') && (
    emojiPresentation.test(text)
    || (text.includes('\ufe0f') && emoji.test(text))
    || (text.includes('\u200d') && pictograph.test(text))
  )) return 2;

  let width = 0;
  // NFC measurement makes decomposed Hangul behave like the same syllable in
  // NFC, without changing the caller's text or its grapheme boundaries.
  for (const character of text.normalize('NFC')) {
    const code = character.codePointAt(0);
    if (marksOrIgnorable.test(character)
      || (code >= 0x1160 && code <= 0x11ff)
      || (code >= 0xd7b0 && code <= 0xd7ff)) continue;
    // VS15 requests text presentation, but does not make a wide pictograph
    // (such as a watch or hourglass) occupy a single terminal cell.
    const wide = isWide(code) || (emojiPresentation.test(character) && pictograph.test(character));
    width += wide ? 2 : 1;
  }
  return width;
}

function plainWidth(text) {
  if (plainAscii.test(text)) return text.length;
  let width = 0;
  for (const { segment } of graphemes.segment(text)) width += graphemeWidth(segment);
  return width;
}

/**
 * displayWidth(value) -> terminal cell count of sanitizeText(value).
 * Uses grapheme boundaries: CJK/fullwidth and emoji occupy two cells; combining
 * marks occupy zero. Ambiguous-width symbols use the common narrow (one-cell)
 * terminal convention. ANSI styling never contributes to the count.
 */
export function displayWidth(value) {
  return plainWidth(sanitizeText(value));
}

function prefixWithin(text, width) {
  let result = '';
  let cells = 0;
  for (const { segment } of graphemes.segment(text)) {
    const size = graphemeWidth(segment);
    if (cells + size > width) break;
    result += segment;
    cells += size;
  }
  return result;
}

/**
 * truncateText(value, maxWidth, suffix = '…') -> sanitized plain string.
 * Limits terminal cells, retaining whole graphemes and reserving space for the
 * suffix only when clipping. The suffix is sanitized and clipped too. Use ''
 * for hard clipping or '.' for ASCII. Nonpositive/invalid widths return '';
 * Infinity leaves the sanitized text intact. Finite widths are floored.
 */
export function truncateText(value, maxWidth, suffix = '…') {
  const text = sanitizeText(value);
  if (maxWidth === Infinity) return text;
  if (!Number.isFinite(maxWidth) || maxWidth < 1) return '';
  const width = Math.floor(maxWidth);
  if (plainWidth(text) <= width) return text;
  const safeSuffix = sanitizeText(suffix);
  if (plainWidth(safeSuffix) >= width) return prefixWithin(safeSuffix, width);
  const ending = safeSuffix;
  return prefixWithin(text, width - plainWidth(ending)) + ending;
}
