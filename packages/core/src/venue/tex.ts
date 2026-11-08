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

function lineAt(s: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (s.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * Finds uses of `\name[opt]{arg}` (optionally starred) in comment-stripped source.
 */
export function findCommands(files: TexFile[], names: string[]): CommandUse[] {
  const out: CommandUse[] = [];
  const re = new RegExp(`\\\\(${names.join('|')})\\*?(?![A-Za-z@])`, 'g');
  for (const f of files) {
    const src = stripComments(f.content);
    re.lastIndex = 0;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      let i = m.index + m[0].length;
      while (src[i] === ' ' || src[i] === '\n') i++;
      let optional: string | undefined;
      if (src[i] === '[') {
        const close = src.indexOf(']', i);
        if (close < 0) continue;
        optional = src.slice(i + 1, close);
        i = close + 1;
        while (src[i] === ' ' || src[i] === '\n') i++;
      }
      const g = readGroup(src, i);
      if (!g) continue;
      const use: CommandUse = {
        file: f.path,
        line: lineAt(src, m.index),
        name: m[1] as string,
        arg: g.value,
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
    for (let m = g.exec(src); m; m = g.exec(src)) {
      out.push({ file: f.path, line: lineAt(src, m.index), match: m[0] });
      if (m[0].length === 0) g.lastIndex++;
    }
  }
  return out;
}
