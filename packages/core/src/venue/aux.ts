import { readGroup } from './tex.js';

export interface AuxLabel {
  /** The printed reference (e.g. `3.2`). */
  ref: string;
  /** The printed page (`\thepage`), e.g. `9` or `ix`. */
  page: string;
}

/**
 * Parses `\newlabel{name}{{ref}{page}...}` lines from .aux content. Handles
 * hyperref's five-field form and ignores biblatex and other noise.
 */
export function parseAuxLabels(aux: string): Map<string, AuxLabel> {
  const labels = new Map<string, AuxLabel>();
  const re = /\\newlabel\s*\{/g;
  for (let m = re.exec(aux); m; m = re.exec(aux)) {
    const name = readGroup(aux, m.index + m[0].length - 1);
    if (!name) continue;
    let i = name.end;
    while (aux[i] === ' ') i++;
    const body = readGroup(aux, i);
    if (!body) continue;
    const fields: string[] = [];
    let j = 0;
    while (j < body.value.length && fields.length < 2) {
      while (body.value[j] === ' ') j++;
      const g = readGroup(body.value, j);
      if (!g) break;
      fields.push(g.value);
      j = g.end;
    }
    if (fields.length < 2) continue;
    labels.set(name.value, { ref: clean(fields[0] ?? ''), page: clean(fields[1] ?? '') });
    re.lastIndex = body.end;
  }
  return labels;
}

function clean(s: string): string {
  return s
    .replace(/\\relax\s*/g, '')
    .replace(/\\protect\s*/g, '')
    .replace(/[{}]/g, '')
    .trim();
}

/** Page number of a label as an integer, or undefined if not arabic (e.g. roman front matter). */
export function labelPage(aux: string, label: string): number | undefined {
  const entry = parseAuxLabels(aux).get(label);
  if (!entry) return undefined;
  return /^\d+$/.test(entry.page) ? Number(entry.page) : undefined;
}
