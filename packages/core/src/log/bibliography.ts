/**
 * Errors in typeset bibliography entries: LaTeX reports them at the `.bbl` line
 * (BibTeX) or at a `.tex` line near `\printbibliography` (biblatex), where the
 * author cannot fix anything. `attributeBibliography` points them at the `.bib`
 * entry instead. Browser-safe.
 */

import { parseBib } from '../bib/parse.js';
import type { Problem } from '../types.js';

export interface BibliographySources {
  /** The `.bbl` LaTeX read: project-relative path and text. */
  bbl?: { path: string; text: string };
  /** The project's `.bib` files. */
  bibs: { file: string; text: string }[];
}

interface BblEntry {
  key: string;
  line: number;
  offset: number;
}

function bblEntries(text: string): BblEntry[] {
  const out: BblEntry[] = [];
  const re = /\\(?:bibitem\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}|entry\s*\{([^}]+)\})/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const key = (m[1] ?? m[2] ?? '').trim();
    if (!key) continue;
    out.push({ key, offset: m.index, line: text.slice(0, m.index).split('\n').length });
  }
  return out;
}

/** The text TeX showed as the offending argument (`<argument> Speedups in R&`). */
function argumentSnippet(evidence: string | undefined): string | undefined {
  const m = /^<argument> (.+)$/m.exec(evidence ?? '');
  const text = m?.[1]?.replace(/[&_^#$%\\]+\s*$/, '').trim();
  return text && text.length >= 8 ? text : undefined;
}

const sameFile = (a: string, b: string) =>
  a.replace(/^\.\//, '') === b.replace(/^\.\//, '') || a.split('/').pop() === b.split('/').pop();

/**
 * Returns problems whose cause is a bibliography entry rewritten to point at the
 * `.bib` entry: `location` = the entry in its .bib file, `data.bibKey`, and the
 * message says "in the bibliography entry `<key>`". Other problems are returned
 * unchanged.
 */
export function attributeBibliography(problems: Problem[], src: BibliographySources): Problem[] {
  if (!src.bbl) return problems;
  const entries = bblEntries(src.bbl.text);
  if (!entries.length) return problems;
  let bibIndex: Map<string, { file: string; line: number }> | undefined;
  const bibLocation = (key: string) => {
    if (!bibIndex) {
      bibIndex = new Map();
      for (const b of src.bibs) {
        for (const e of parseBib(b.text)) {
          if (!bibIndex.has(e.key)) bibIndex.set(e.key, { file: b.file, line: e.line });
        }
      }
    }
    return bibIndex.get(key);
  };
  return problems.map((p) => {
    if (p.data?.bibKey) return p;
    let key: string | undefined;
    const loc = p.location;
    if (loc?.file && loc.line && sameFile(loc.file, src.bbl?.path ?? '')) {
      key = [...entries].reverse().find((e) => e.line <= (loc.line as number))?.key;
    } else {
      const snippet = argumentSnippet(p.evidence);
      const at = snippet ? (src.bbl?.text.indexOf(snippet) ?? -1) : -1;
      if (at >= 0) key = [...entries].reverse().find((e) => e.offset <= at)?.key;
    }
    if (!key) return p;
    const where = bibLocation(key);
    return {
      ...p,
      message: `${p.message} in the bibliography entry \`${key}\``,
      ...(where ? { location: { file: where.file, line: where.line } } : {}),
      data: { ...(p.data ?? {}), bibKey: key, ...(loc ? { reportedAt: loc } : {}) },
    };
  });
}
