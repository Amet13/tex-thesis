/**
 * Reading log lines, undoing TeX's hard line wrapping.
 *
 * TeX breaks every log line after `max_print_line` (79 in TeX Live) characters,
 * even in the middle of a file name. pdfTeX and LuaTeX count bytes (LuaTeX never
 * splits a UTF-8 sequence, so a line can end a few bytes early), XeTeX counts
 * characters, and output written from Lua (luaotfload) wraps at 80.
 */

export const MAX_PRINT_LINE = 79;

export type EngineFamily = 'pdftex' | 'luatex' | 'xetex' | 'unknown';

/** Lines that always start on a fresh line in TeX output, so they never continue a wrapped line. */
const STARTS_FRESH =
  /^(?:! |[^\s:()]+\.[A-Za-z0-9]+:\d+: |(?:LaTeX|LaTeX3|Package|Class|Module) .*?(?:Warning|Error|Info)|LaTeX Font |Package: |File: |Document Class: |Overfull \\|Underfull \\|Missing character: |Runaway |\([\w@.-]+\) {2,}|l\.\d+ |No file |Output written on |No pages of output|\\[A-Za-z@]+=\\)/;

export function engineFamily(firstLine: string): EngineFamily {
  if (/^This is (?:Lua(?:HB|HBJIT|JIT)?TeX)/.test(firstLine)) return 'luatex';
  if (/^This is XeTeX/.test(firstLine)) return 'xetex';
  if (/^This is (?:pdf|e-|)TeX/.test(firstLine)) return 'pdftex';
  return 'unknown';
}

function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

function isAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) >= 0x80) return false;
  return true;
}

/** True when a physical line filled the whole print width, so TeX continued it on the next line. */
export function isFullWidth(line: string, engine: EngineFamily): boolean {
  if (line.length < MAX_PRINT_LINE - 4 * 4) return false;
  if (isAscii(line)) {
    if (line.length === MAX_PRINT_LINE) return true;
    return line.length === MAX_PRINT_LINE + 1 && (engine === 'luatex' || engine === 'unknown');
  }
  const chars = [...line].length;
  if (engine === 'xetex') return chars === MAX_PRINT_LINE;
  if (chars === MAX_PRINT_LINE) return true;
  const bytes = utf8Bytes(line);
  // A multi-byte character that did not fit, or one split by pdfTeX (decoded as U+FFFD).
  return (bytes >= MAX_PRINT_LINE - 3 && bytes <= MAX_PRINT_LINE + 2) || line.endsWith('\uFFFD');
}

export interface LogicalLine {
  text: string;
  /** 0-based index of the first physical line. */
  start: number;
}

/** Sequential reader over physical lines that can join wrapped lines on demand. */
export class LineReader {
  readonly lines: string[];
  readonly engine: EngineFamily;
  index = 0;

  constructor(text: string) {
    this.lines = text.split(/\r?\n/);
    if (this.lines.length > 0 && this.lines[this.lines.length - 1] === '') this.lines.pop();
    this.engine = engineFamily(this.lines[0] ?? '');
  }

  get done(): boolean {
    return this.index >= this.lines.length;
  }

  peek(offset = 0): string | undefined {
    return this.lines[this.index + offset];
  }

  /** Next physical line, without joining. */
  nextRaw(): string {
    return this.lines[this.index++] ?? '';
  }

  /** Next logical line: physical lines joined while TeX wrapped them. */
  next(): LogicalLine {
    const start = this.index;
    let segment = this.nextRaw();
    let text = segment;
    while (isFullWidth(segment, this.engine) && this.index < this.lines.length) {
      const following = this.lines[this.index] ?? '';
      if (following === '') {
        // A line of exactly max_print_line characters is followed by an empty line: the
        // wrap and the line's own newline. The empty line is an artifact; drop it.
        this.index++;
        break;
      }
      if (STARTS_FRESH.test(following)) break;
      text += following;
      segment = following;
      this.index++;
    }
    return { text, start };
  }
}
