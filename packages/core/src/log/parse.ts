/**
 * Build-log parser: turns a TeX log into errors, warnings and facts about the run.
 *
 * Single pass, linear time. The parser tracks the stack of open files from the
 * `(./file.tex … )` notation TeX prints, skipping text that is known not to
 * contain file notation (messages, box dumps, error context), so stray
 * parentheses in user text cannot corrupt it.
 */

import { LineReader, type LogicalLine } from './lines.js';
import { isFileToken, normalizePath } from './paths.js';
import type { LogError, LogWarning, LogWarningKind, ParsedLog } from './types.js';

export interface ParseOptions {
  /** Absolute project directory; paths below it become project-relative. */
  root?: string;
}

const ERROR_START = /^! (.*)$/;
const FILE_LINE_ERROR = /^((?:[A-Za-z]:)?[^\s:()]*\.[A-Za-z0-9]+):(\d+): (.*)$/;
const RUNAWAY = /^Runaway (?:argument|definition|preamble|text)\?$/;
const CONTEXT_BEFORE = /^(?:<[^>]*>|\\\S|\s?\.\.\.)/;
const SOURCE_LINE = /^l\.(\d+)(?: (.*))?$/;
const TERMINAL_CONTEXT = /^<(?:\*|read [^>]*|insert)>/;
const ERROR_BOILERPLATE = /^(?:See the .* for explanation\.|Type {1,2}H <return> {1,2}for immediate help\.)$/;
const BANNER = /^This is (\S+), Version (\S+)\s*\(([^)]*)\)(?:\s+\((?:preloaded )?format=([^\s)]+)[^)]*\))?/;
const OUTPUT = /^Output written on (.+?) \((\d+) pages?(?:, (\d+) bytes)?\)\.?$/;
const BOX = /^(Overfull|Underfull) \\([hv]box) \((?:(-?[\d.]+)pt too (?:wide|high)|badness (\d+))\)(.*)$/;
const MISSING_CHAR = /^Missing character: There is no (.+?) (?:\((U\+[0-9A-Fa-f]+)\) )?in font (.*?)!?$/;
const NO_FILE = /^No file (.+?)\.$/;
const MAX_ERROR_LINES = 60;

interface Header {
  source: string;
  body: string;
  info: boolean;
  continuation: RegExp;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Recognises the first line of a LaTeX/package warning or info message. */
function messageHeader(text: string): Header | undefined {
  let m = /^LaTeX(?:3)? (Font )?(Warning|Info): ?(.*)$/.exec(text);
  if (m) {
    const font = Boolean(m[1]);
    return {
      source: font ? 'Font' : 'LaTeX',
      body: m[3] ?? '',
      info: m[2] === 'Info',
      continuation: font ? /^\(Font\)\s+(.*)$/ : /^ {8,}(\S.*)$/,
    };
  }
  m = /^(?:Package|Class|Module) (\S+) (Warning|Info): ?(.*)$/.exec(text);
  if (m) {
    const name = m[1] ?? '';
    return {
      source: name,
      body: m[3] ?? '',
      info: m[2] === 'Info',
      continuation: new RegExp(`^\\(${escapeRegExp(name)}\\)\\s*(.*)$`),
    };
  }
  return undefined;
}

/** Lines written with `\write`/`\wlog` that never carry file-stack notation. */
const PLAIN_MESSAGE =
  /^(?:Package: |File: |Document Class: |Language: |Dictionary: |\\[A-Za-z@]+=\\|\\openout\d+ = |\([\w@.-]+\) {2,})/;

function joinParts(parts: string[]): string {
  return parts
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The stack of files TeX has open, as printed with `(` and `)`. */
class FileStack {
  /** `null` marks a parenthesis that did not open a file. */
  private readonly entries: (string | null)[] = [];
  lastClosed: string | undefined;
  readonly opened: string[] = [];
  /** Last page number shipped out (`[12]`). */
  page = 0;

  private readonly root: string | undefined;

  constructor(root: string | undefined) {
    this.root = root;
  }

  current(): string | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry) return entry;
    }
    return this.lastClosed;
  }

  scan(text: string): void {
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '(') i = this.open(text, i + 1) - 1;
      else if (c === ')') this.close();
      else if (c === '[') this.maybePage(text, i);
    }
  }

  private open(text: string, start: number): number {
    let end = start;
    if (text[start] === '"') {
      const close = text.indexOf('"', start + 1);
      end = close === -1 ? text.length : close + 1;
    } else {
      while (end < text.length && !/[\s()[\]{}<>"]/.test(text[end] ?? '')) end++;
    }
    const token = text.slice(start, end);
    const unquoted = token.startsWith('"') ? token.slice(1, -1) : token;
    if (isFileToken(unquoted)) {
      const path = normalizePath(unquoted, this.root);
      this.entries.push(path);
      this.opened.push(path);
      return end;
    }
    this.entries.push(null);
    return start;
  }

  private close(): void {
    const entry = this.entries.pop();
    if (entry) this.lastClosed = entry;
  }

  private maybePage(text: string, i: number): void {
    const before = i === 0 ? ' ' : (text[i - 1] ?? ' ');
    if (!/[\s\]})]/.test(before)) return;
    const m = /^\[(\d+)/.exec(text.slice(i, i + 12));
    if (m) this.page = Number(m[1]);
  }
}

class Parser {
  private readonly reader: LineReader;
  private readonly stack: FileStack;
  private runaway: string | undefined;
  readonly result: ParsedLog = {
    errors: [],
    warnings: [],
    noPages: false,
    fatal: false,
    rerunNeeded: { latex: false, biber: false, bibtex: false },
    files: [],
  };

  private readonly root: string | undefined;

  constructor(text: string, root: string | undefined) {
    this.root = root;
    this.reader = new LineReader(text);
    this.stack = new FileStack(root);
  }

  run(): ParsedLog {
    while (!this.reader.done) this.handle(this.reader.next());
    this.result.files = [...new Set(this.stack.opened)];
    return this.result;
  }

  private handle(line: LogicalLine): void {
    const text = line.text;
    if (line.start === 0 && this.banner(text)) return;
    if (ERROR_START.test(text) || this.fileLineError(text)) return this.error(line);
    if (RUNAWAY.test(text)) {
      this.runaway = this.reader.done ? '' : this.reader.next().text;
      return;
    }
    const header = messageHeader(text);
    if (header) return this.message(line, header);
    if (BOX.test(text)) return this.box(line);
    if (MISSING_CHAR.test(text)) return this.missingChar(line);
    if (this.output(text)) return;
    const noFile = NO_FILE.exec(text);
    if (noFile) {
      this.warn(line, 'no-file', 'TeX', text, { file: normalizePath(noFile[1] ?? '', this.root) });
      return;
    }
    if (PLAIN_MESSAGE.test(text)) return;
    this.stack.scan(text);
  }

  private banner(text: string): boolean {
    const m = BANNER.exec(text);
    if (!m) return false;
    this.result.engine = `${m[1]} ${m[2]} (${m[3]})`;
    if (m[4]) this.result.format = m[4];
    return true;
  }

  private fileLineError(text: string): RegExpExecArray | null {
    const m = FILE_LINE_ERROR.exec(text);
    if (!m) return null;
    // Avoid lines such as `Package: foo.sty 2024:1: …`; a real prefix is a path TeX opened.
    return isFileToken(m[1] ?? '') || /^[\w./-]+$/.test(m[1] ?? '') ? m : null;
  }

  private output(text: string): boolean {
    const m = OUTPUT.exec(text);
    if (m) {
      this.result.outputFile = { name: m[1] ?? '', pages: Number(m[2]) };
      if (m[3]) this.result.outputFile.bytes = Number(m[3]);
      return true;
    }
    if (text.startsWith('No pages of output')) {
      this.result.noPages = true;
      return true;
    }
    return false;
  }

  /** Reads continuation lines matching `pattern`; returns their captured text. */
  private continuation(pattern: RegExp, raw: string[]): string[] {
    const parts: string[] = [];
    while (!this.reader.done) {
      const peek = this.reader.peek() ?? '';
      if (!pattern.test(peek)) break;
      const next = this.reader.next().text;
      raw.push(next);
      parts.push(pattern.exec(next)?.[1] ?? next);
    }
    return parts;
  }

  private error(first: LogicalLine): void {
    const raw = [first.text];
    const fle = this.fileLineError(first.text);
    let message = fle ? (fle[3] ?? '') : (ERROR_START.exec(first.text)?.[1] ?? '').trim();
    const pkg = /^(?:Package|Class|Module) (\S+) Error:/.exec(message);
    if (pkg) {
      const pattern = new RegExp(`^\\(${escapeRegExp(pkg[1] ?? '')}\\)\\s*(.*)$`);
      message = joinParts([message, ...this.continuation(pattern, raw)]);
    } else if (/^LaTeX Error:/.test(message)) {
      message = joinParts([message, ...this.continuation(/^ {4,}(\S.*)$/, raw)]);
    }

    const error: LogError = {
      message,
      context: [],
      help: [],
      raw: '',
      logLine: first.start + 1,
    };
    if (this.runaway !== undefined) {
      error.runaway = this.runaway;
      this.runaway = undefined;
    }
    this.errorBody(error, raw);
    error.raw = raw.join('\n');

    if (fle) {
      error.file = normalizePath(fle[1] ?? '', this.root);
      error.line = Number(fle[2]);
    } else {
      const file = this.stack.current();
      if (file) error.file = file;
    }
    if (/^(?:Emergency stop|==> Fatal error occurred|TeX capacity exceeded|Interruption)/.test(message)) {
      this.result.fatal = true;
    }
    this.result.errors.push(error);
  }

  /** Reads the context and help text that follow an error message. */
  private errorBody(error: LogError, raw: string[]): void {
    let blanks = 0;
    let contextDone = false;
    let sawSourceLine = false;
    while (!this.reader.done && raw.length < MAX_ERROR_LINES) {
      const peek = this.reader.peek() ?? '';
      if (ERROR_START.test(peek) || this.fileLineError(peek)) return;
      if (peek === '') {
        raw.push(this.reader.nextRaw());
        if (contextDone || ++blanks >= 2) return;
        continue;
      }
      const source = SOURCE_LINE.exec(peek);
      if (source && !sawSourceLine) {
        raw.push(this.reader.nextRaw());
        const after = this.reader.done ? '' : this.reader.nextRaw();
        raw.push(after);
        const before = source[2] ?? '';
        error.context.push(peek, after);
        error.source = { before, after: after.slice(Math.min(peek.length, after.length)) };
        error.line = Number(source[1]);
        sawSourceLine = true;
        contextDone = true;
        continue;
      }
      if (!contextDone && CONTEXT_BEFORE.test(peek)) {
        raw.push(this.reader.nextRaw());
        const after = this.reader.done ? '' : this.reader.nextRaw();
        raw.push(after);
        error.context.push(peek, after);
        if (TERMINAL_CONTEXT.test(peek)) contextDone = true;
        continue;
      }
      raw.push(this.reader.nextRaw());
      if (!ERROR_BOILERPLATE.test(peek)) error.help.push(peek);
    }
  }

  private message(line: LogicalLine, header: Header): void {
    const raw = [line.text];
    const parts = [header.body, ...this.continuation(header.continuation, raw)];
    if (header.info) return;
    const message = joinParts(parts);
    const { kind, data } = classifyWarning(header.source, message);
    this.warn(line, kind, header.source, message, data, raw);
  }

  private warn(
    line: LogicalLine,
    kind: LogWarningKind,
    source: string,
    message: string,
    data: Record<string, unknown>,
    raw: string[] = [line.text],
  ): LogWarning {
    const warning: LogWarning = {
      kind,
      message,
      source,
      data,
      raw: raw.join('\n'),
      logLine: line.start + 1,
    };
    const file = this.stack.current();
    if (file) warning.file = file;
    const inputLine = /on input line (\d+)/.exec(message);
    if (inputLine) warning.line = Number(inputLine[1]);
    const page = /on page (\d+)/.exec(message);
    if (page) warning.page = Number(page[1]);
    this.result.warnings.push(warning);
    this.noteRerun(kind);
    return warning;
  }

  private noteRerun(kind: LogWarningKind): void {
    const rerun = this.result.rerunNeeded;
    if (kind === 'labels-changed' || kind === 'rerun-latex') rerun.latex = true;
    if (kind === 'rerun-biber') rerun.biber = true;
    if (kind === 'rerun-bibtex') rerun.bibtex = true;
  }

  private box(line: LogicalLine): void {
    const m = BOX.exec(line.text);
    if (!m) return;
    const raw = [line.text];
    // The box content follows until an empty line; it is a dump of typeset material,
    // so it must not be scanned for file notation.
    while (!this.reader.done && raw.length < 40) {
      const next = this.reader.nextRaw();
      if (next === '') break;
      raw.push(next);
    }
    const where = m[5] ?? '';
    const lines = /lines? (\d+)(?:--(\d+))?/.exec(where);
    const data: Record<string, unknown> = { box: m[2], where: where.trim() };
    if (m[3] !== undefined) data.amountPt = Number(m[3]);
    if (m[4] !== undefined) data.badness = Number(m[4]);
    if (lines) data.lines = [Number(lines[1]), Number(lines[2] ?? lines[1])];
    const kind = m[1] === 'Overfull' ? 'overfull' : 'underfull';
    const warning = this.warn(line, kind, 'TeX', line.text, data, raw);
    if (lines) warning.line = Number(lines[1]);
    warning.page = this.stack.page + 1;
  }

  private missingChar(line: LogicalLine): void {
    const m = MISSING_CHAR.exec(line.text);
    if (!m) return;
    const data: Record<string, unknown> = { char: m[1], font: (m[3] ?? '').trim() };
    if (m[2]) data.code = m[2].toUpperCase();
    this.warn(line, 'missing-glyph', 'TeX', line.text, data);
  }
}

/** Assigns a kind and extracts facts from a warning message. */
export function classifyWarning(
  source: string,
  message: string,
): { kind: LogWarningKind; data: Record<string, unknown> } {
  let m = /^(Citation|Reference) [`'](.+?)' on page (\d+) undefined/.exec(message);
  if (m) {
    return m[1] === 'Citation'
      ? { kind: 'undefined-citation', data: { key: m[2] } }
      : { kind: 'undefined-reference', data: { label: m[2] } };
  }
  if (/^There were undefined (?:references|citations)/.test(message)) {
    return { kind: 'undefined-references-summary', data: {} };
  }
  m = /^Label [`'](.+?)' multiply defined/.exec(message);
  if (m) return { kind: 'duplicate-label', data: { label: m[1] } };
  if (/^Label\(s\) may have changed/.test(message)) return { kind: 'labels-changed', data: {} };
  if (/Please \(re\)run Biber/i.test(message)) return { kind: 'rerun-biber', data: {} };
  if (/Please \(re\)run BibTeX/i.test(message)) return { kind: 'rerun-bibtex', data: {} };
  m = /^The following entry could not be found in the database: (\S+)/.exec(message);
  if (m) return { kind: 'bib-entry-not-found', data: { key: m[1] } };
  if (/^Empty bibliography/.test(message)) return { kind: 'empty-bibliography', data: {} };
  if (/Rerun to get|Please rerun LaTeX|Rerun LaTeX|Temporary extra page added/i.test(message)) {
    return { kind: 'rerun-latex', data: {} };
  }
  m = /^Font shape [`'](.+?)' undefined using [`'](.+?)' instead/.exec(message);
  if (m) return { kind: 'font-substitution', data: { from: m[1], to: m[2] } };
  m = /^Token not allowed in a PDF string.*?removing [`'](.+?)'/.exec(message);
  if (m) return { kind: 'pdf-string-token', data: { token: m[1] } };
  if (source === 'fontspec' && /does not contain requested|not available|cannot be found/.test(message)) {
    return { kind: 'font-feature', data: {} };
  }
  m = /^Float too large for page by ([\d.]+)pt/.exec(message);
  if (m) return { kind: 'float-too-large', data: { amountPt: Number(m[1]) } };
  return { kind: 'other', data: {} };
}

export function parseLog(text: string, options: ParseOptions = {}): ParsedLog {
  return new Parser(text, options.root).run();
}
