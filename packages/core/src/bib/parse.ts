/**
 * BibTeX / biblatex parser.
 *
 * Follows BibTeX's own reading rules: anything outside an `@entry` is a
 * comment, `@string` macros expand (with `#` concatenation), `@preamble` and
 * `@comment` are skipped. A malformed entry is skipped and reported, and
 * parsing resumes at the next `@` that starts a line.
 */

export interface BibEntry {
  /** Citation key, as written. */
  key: string;
  /** Entry type, lowercased (`article`, `inproceedings`, …). */
  type: string;
  /** Field names lowercased; values without outer braces/quotes, inner TeX kept. */
  fields: Record<string, string>;
  /** 1-based line of the `@`. */
  line: number;
  /** The entry exactly as written. */
  raw: string;
  /** Source file, when the caller knows it (relative to the project root). */
  file?: string;
}

export interface BibParseIssue {
  line: number;
  message: string;
  key?: string;
}

export interface BibParseResult {
  entries: BibEntry[];
  issues: BibParseIssue[];
}

const MONTHS: Record<string, string> = {
  jan: 'January',
  feb: 'February',
  mar: 'March',
  apr: 'April',
  may: 'May',
  jun: 'June',
  jul: 'July',
  aug: 'August',
  sep: 'September',
  oct: 'October',
  nov: 'November',
  dec: 'December',
};

class ParseError extends Error {
  readonly pos: number;
  constructor(message: string, pos: number) {
    super(message);
    this.pos = pos;
  }
}

class Parser {
  private pos = 0;
  private entryStart = 0;
  private readonly lineStarts: number[] = [0];
  readonly macros: Record<string, string> = { ...MONTHS };
  readonly entries: BibEntry[] = [];
  readonly issues: BibParseIssue[] = [];
  private readonly seenKeys = new Map<string, number>();
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') this.lineStarts.push(i + 1);
  }

  lineOf(pos: number): number {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.lineStarts[mid] as number) <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  run(): void {
    while (this.skipToAt()) {
      const start = this.pos;
      try {
        this.parseItem(start);
      } catch (err) {
        const message = err instanceof ParseError ? err.message : String(err);
        const at = err instanceof ParseError ? err.pos : start;
        this.issues.push({ line: this.lineOf(at), message, ...this.keyHint(start) });
        this.pos = this.resyncFrom(start + 1);
      }
    }
  }

  /** Outside entries everything is a comment; `%` lines are skipped so `% @article{…` stays inert. */
  private skipToAt(): boolean {
    const t = this.text;
    while (this.pos < t.length) {
      const c = t[this.pos];
      if (c === '@') return true;
      if (c === '%') {
        const nl = t.indexOf('\n', this.pos);
        this.pos = nl < 0 ? t.length : nl + 1;
      } else this.pos++;
    }
    return false;
  }

  /** Next `@` at the start of a line (after optional indentation). */
  private resyncFrom(from: number): number {
    const re = /(^|\n)[ \t]*@/g;
    re.lastIndex = from;
    let m = re.exec(this.text);
    while (m && m.index + m[0].length - 1 < from) m = re.exec(this.text);
    return m ? m.index + m[0].length - 1 : this.text.length;
  }

  private keyHint(start: number): { key?: string } {
    const m = /^@\s*[A-Za-z]+\s*[{(]\s*([^\s,{}()=]+)\s*,/.exec(this.text.slice(start, start + 300));
    return m?.[1] ? { key: m[1] } : {};
  }

  private parseItem(start: number): void {
    this.entryStart = start;
    this.pos++; // '@'
    this.skipWs();
    const type = this.readWhile(/[A-Za-z_-]/).toLowerCase();
    if (!type) throw new ParseError('expected an entry type after `@`', this.pos);
    this.skipWs();
    if (type === 'comment') {
      this.skipComment();
      return;
    }
    const open = this.text[this.pos];
    if (open !== '{' && open !== '(') {
      throw new ParseError(`expected \`{\` after \`@${type}\``, this.pos);
    }
    const close = open === '{' ? '}' : ')';
    this.pos++;
    if (type === 'preamble') {
      this.parseValue(close);
      this.expectClose(close, start);
    } else if (type === 'string') {
      this.parseString(close, start);
    } else {
      this.parseEntry(type, close, start);
    }
  }

  private skipComment(): void {
    const open = this.text[this.pos];
    if (open === '{' || open === '(') {
      const close = open === '{' ? '}' : ')';
      let depth = 0;
      for (; this.pos < this.text.length; this.pos++) {
        const c = this.text[this.pos];
        if (c === open) depth++;
        else if (c === close && --depth === 0) {
          this.pos++;
          return;
        }
      }
      return;
    }
    const nl = this.text.indexOf('\n', this.pos);
    this.pos = nl < 0 ? this.text.length : nl + 1;
  }

  private parseString(close: string, start: number): void {
    this.skipWsAndComments();
    const name = this.readWhile(/[^\s=#{}(),"]/).toLowerCase();
    if (!name) throw new ParseError('expected a macro name in `@string`', this.pos);
    this.skipWsAndComments();
    if (this.text[this.pos] !== '=') throw new ParseError('expected `=` in `@string`', this.pos);
    this.pos++;
    this.macros[name] = this.parseValue(close);
    this.expectClose(close, start);
  }

  private parseEntry(type: string, close: string, start: number): void {
    this.skipWs();
    const key = this.readWhile(close === '}' ? /[^\s,{}]/ : /[^\s,()]/);
    if (!key) throw new ParseError(`\`@${type}\` entry has no citation key`, this.pos);
    const fields: Record<string, string> = {};
    this.skipWsAndComments();
    while (this.text[this.pos] === ',') {
      this.pos++;
      this.skipWsAndComments();
      if (this.text[this.pos] === close) break;
      this.parseField(key, fields, close);
      this.skipWsAndComments();
    }
    this.expectClose(close, start, key);
    this.addEntry({
      key,
      type,
      fields,
      line: this.lineOf(start),
      raw: this.text.slice(start, this.pos),
    });
  }

  private parseField(key: string, fields: Record<string, string>, close: string): void {
    const at = this.pos;
    const name = this.readWhile(/[^\s=,{}()"#%@]/).toLowerCase();
    if (!name && this.text[this.pos] === '@') {
      throw new ParseError(`\`${key}\` is not closed (missing \`${close}\` before the next entry)`, this.entryStart);
    }
    if (!name) {
      throw new ParseError(`unexpected \`${this.text[this.pos] ?? 'end of file'}\` in \`${key}\``, at);
    }
    this.skipWsAndComments();
    if (this.text[this.pos] !== '=') {
      throw new ParseError(`field \`${name}\` in \`${key}\` has no \`=\` (missing comma?)`, at);
    }
    this.pos++;
    const value = this.parseValue(close).trim();
    if (name in fields) {
      this.issues.push({
        line: this.lineOf(at),
        key,
        message: `duplicate field \`${name}\` in \`${key}\`; the first one is used`,
      });
      return;
    }
    fields[name] = value;
  }

  private addEntry(entry: BibEntry): void {
    const folded = entry.key.toLowerCase();
    const previous = this.seenKeys.get(folded);
    if (previous !== undefined) {
      this.issues.push({
        line: entry.line,
        key: entry.key,
        message: `duplicate key \`${entry.key}\` (first defined on line ${previous}); this entry is ignored`,
      });
      return;
    }
    this.seenKeys.set(folded, entry.line);
    this.entries.push(entry);
  }

  /** value := part ('#' part)*, part := {…} | "…" | digits | macro */
  private parseValue(close: string): string {
    let out = '';
    for (;;) {
      this.skipWsAndComments();
      out += this.parsePart(close);
      this.skipWsAndComments();
      if (this.text[this.pos] !== '#') break;
      this.pos++;
    }
    // Whitespace collapses; only field values are trimmed, so `@string` pieces keep their spaces.
    return out.replace(/\s+/g, ' ');
  }

  private parsePart(close: string): string {
    const c = this.text[this.pos];
    if (c === '{') return this.readBraced();
    if (c === '"') return this.readQuoted();
    const word = this.readWhile(close === '}' ? /[^\s,#{}"%=]/ : /[^\s,#{}()"%=]/);
    if (!word) {
      throw new ParseError(`expected a value, found \`${c ?? 'end of file'}\``, this.pos);
    }
    if (/^\d+$/.test(word)) return word;
    const macro = this.macros[word.toLowerCase()];
    if (macro === undefined) {
      this.issues.push({
        line: this.lineOf(this.pos),
        message: `undefined macro \`${word}\` (kept as text)`,
      });
      return word;
    }
    return macro;
  }

  private readBraced(): string {
    const start = this.pos + 1;
    let depth = 0;
    for (; this.pos < this.text.length; this.pos++) {
      const c = this.text[this.pos];
      if (c === '\\') {
        this.pos++;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        this.pos++;
        return this.text.slice(start, this.pos - 1);
      }
    }
    throw new ParseError('unbalanced braces in field value', start - 1);
  }

  private readQuoted(): string {
    const start = this.pos + 1;
    let depth = 0;
    for (this.pos = start; this.pos < this.text.length; this.pos++) {
      const c = this.text[this.pos];
      if (c === '\\') {
        this.pos++;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '"' && depth === 0) {
        this.pos++;
        return this.text.slice(start, this.pos - 1);
      }
    }
    throw new ParseError('unterminated quoted field value', start - 1);
  }

  private expectClose(close: string, start: number, key?: string): void {
    this.skipWsAndComments();
    if (this.text[this.pos] === close) {
      this.pos++;
      return;
    }
    const what = key ? `\`${key}\`` : 'entry';
    if (this.pos >= this.text.length || this.text[this.pos] === '@') {
      throw new ParseError(`${what} is not closed (missing \`${close}\`)`, start);
    }
    throw new ParseError(
      `unexpected \`${this.text[this.pos]}\` in ${what} (missing comma or \`${close}\`?)`,
      this.pos,
    );
  }

  private readWhile(re: RegExp): string {
    const start = this.pos;
    while (this.pos < this.text.length && re.test(this.text[this.pos] as string)) this.pos++;
    return this.text.slice(start, this.pos);
  }

  private skipWs(): void {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos] as string)) this.pos++;
  }

  private skipWsAndComments(): void {
    for (;;) {
      this.skipWs();
      if (this.text[this.pos] !== '%') return;
      const nl = this.text.indexOf('\n', this.pos);
      this.pos = nl < 0 ? this.text.length : nl + 1;
    }
  }
}

/** Parses a .bib file and reports problems (malformed entries are skipped, not fatal). */
export function parseBibWithIssues(text: string): BibParseResult {
  const parser = new Parser(text);
  parser.run();
  return { entries: parser.entries, issues: parser.issues };
}

/** Parses a .bib file. Malformed entries are skipped; use `parseBibWithIssues` to see why. */
export function parseBib(text: string): BibEntry[] {
  return parseBibWithIssues(text).entries;
}
