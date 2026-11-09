import type { TexFile } from './types.js';

/** Removes `%` comments (keeps `\%`), preserving line structure. */
export function stripComments(content: string): string {
  return content
    .split('\n')
    .map((line) => {
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '\\') {
          i++;
          continue;
        }
        if (line[i] === '%') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

/** Reads a balanced `{...}` group starting at `open` (index of `{`). */
export function readGroup(s: string, open: number): { value: string; end: number } | null {
  if (s[open] !== '{') return null;
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return { value: s.slice(open + 1, i), end: i + 1 };
    }
  }
  return null;
}

export interface CommandUse {
  file: string;
  line: number;
  /** The command name without backslash. */
  name: string;
  /** Optional `[...]` argument, if present. */
  optional?: string;
  /** First mandatory argument. */
  arg: string;
}

/** Line numbers for increasing offsets in one string, counted incrementally (linear overall). */
export function lineCounter(s: string): (index: number) => number {
  let pos = 0;
  let line = 1;
  return (index: number) => {
    if (index < pos) {
      pos = 0;
      line = 1;
    }
    for (; pos < index; pos++) if (s.charCodeAt(pos) === 10) line++;
    return line;
  };
}

/** Closing-brace index for every `{` (or -1), computed in one pass with the rules of `readGroup`. */
function braceMatches(s: string): Int32Array {
  const close = new Int32Array(s.length).fill(-1);
  const stack: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 92 /* \\ */) {
      i++;
    } else if (c === 123 /* { */) {
      stack.push(i);
    } else if (c === 125 /* } */) {
      const open = stack.pop();
      if (open !== undefined) close[open] = i;
    }
  }
  return close;
}

/** Longest optional `[...]` argument looked at, so unclosed brackets cannot make a scan quadratic. */
const MAX_OPTIONAL = 4096;

/**
 * Finds uses of `\name[opt]{arg}` (optionally starred) in comment-stripped source.
 */
export function findCommands(files: TexFile[], names: string[]): CommandUse[] {
  const out: CommandUse[] = [];
  const re = new RegExp(`\\\\(${names.join('|')})\\*?(?![A-Za-z@])`, 'g');
  for (const f of files) {
    const src = stripComments(f.content);
    const lineAt = lineCounter(src);
    let braces: Int32Array | undefined;
    re.lastIndex = 0;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      let i = m.index + m[0].length;
      while (src[i] === ' ' || src[i] === '\n') i++;
      let optional: string | undefined;
      if (src[i] === '[') {
        let close = src.slice(i, i + MAX_OPTIONAL).indexOf(']');
        if (close < 0) continue;
        close += i;
        optional = src.slice(i + 1, close);
        i = close + 1;
        while (src[i] === ' ' || src[i] === '\n') i++;
      }
      if (src[i] !== '{') continue;
      braces ??= braceMatches(src);
      const end = braces[i] ?? -1;
      if (end < 0) continue;
      const use: CommandUse = {
        file: f.path,
        line: lineAt(m.index),
        name: m[1] as string,
        arg: src.slice(i + 1, end),
      };
      if (optional !== undefined) use.optional = optional;
      out.push(use);
    }
  }
  return out;
}

/** Finds a regex in comment-stripped sources, returning file and line of each match. */
export function grepTex(
  files: TexFile[],
  re: RegExp,
): { file: string; line: number; match: string }[] {
  const out: { file: string; line: number; match: string }[] = [];
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const g = new RegExp(re.source, flags);
  for (const f of files) {
    const src = stripComments(f.content);
    const lineAt = lineCounter(src);
    g.lastIndex = 0;
    for (let m = g.exec(src); m; m = g.exec(src)) {
      out.push({ file: f.path, line: lineAt(m.index), match: m[0] });
      if (m[0].length === 0) g.lastIndex++;
    }
  }
  return out;
}

/** A `\cite`-like command (`\cite`, `\citep`, `\parencite`, `\textcite`, `\nocite`…). */
const CITE_COMMAND = /\\([A-Za-z]{0,12}cite[A-Za-z]{0,8})\*?(?![A-Za-z@])/g;

/**
 * First source location of each key cited in `files` (comments ignored), for keys in
 * `keys` (all keys when omitted). Handles up to two optional `[...]` arguments.
 */
export function citeLocations(
  files: TexFile[],
  keys?: Iterable<string>,
): Map<string, { file: string; line: number }> {
  const wanted = keys ? new Set(keys) : undefined;
  const out = new Map<string, { file: string; line: number }>();
  for (const f of files) {
    const src = stripComments(f.content);
    const lineAt = lineCounter(src);
    CITE_COMMAND.lastIndex = 0;
    for (let m = CITE_COMMAND.exec(src); m; m = CITE_COMMAND.exec(src)) {
      let i = m.index + m[0].length;
      for (let opt = 0; opt < 2; opt++) {
        while (src[i] === ' ' || src[i] === '\n') i++;
        if (src[i] !== '[') break;
        const close = src.slice(i, i + MAX_OPTIONAL).indexOf(']');
        if (close < 0) break;
        i += close + 1;
      }
      while (src[i] === ' ' || src[i] === '\n') i++;
      if (src[i] !== '{') continue;
      const close = src.slice(i, i + MAX_OPTIONAL).indexOf('}');
      if (close < 0) continue;
      const body = src.slice(i + 1, i + close);
      if (body.includes('{')) continue;
      for (const raw of body.split(',')) {
        const key = raw.trim();
        if (!key || out.has(key) || (wanted && !wanted.has(key))) continue;
        out.set(key, { file: f.path, line: lineAt(m.index) });
      }
    }
  }
  return out;
}
