import type { Problem } from '../types.js';
import type { PdfFacts } from './types.js';

const REF_WORDS = [
  'Figure',
  'Figures',
  'Fig\\.',
  'Figs\\.',
  'Table',
  'Tables',
  'Tab\\.',
  'Section',
  'Sections',
  'Sec\\.',
  'Secs\\.',
  'Chapter',
  'Chapters',
  'Ch\\.',
  'Appendix',
  'Appendices',
  'App\\.',
  'Equation',
  'Equations',
  'Eq\\.',
  'Eqs\\.',
  'Algorithm',
  'Alg\\.',
  'Listing',
  'Theorem',
  'Thm\\.',
  'Lemma',
  'Definition',
  'Def\\.',
  'Corollary',
  'Proposition',
  'Prop\\.',
  'Example',
  'Remark',
  'Line',
  'Lines',
  'Page',
  'Pages',
  'p\\.',
  'pp\\.',
  'Part',
  'Step',
  'Footnote',
  '§',
];

/** "Figure ??", "Eq. (??)", "Sections ?? and ??" — the reference word is the anchor. */
const CONTEXT_REF = new RegExp(
  `(?<!\\p{L})(?:${REF_WORDS.join('|')})[\\s\\u00a0~]*\\(?\\?\\?\\)?`,
  'giu',
);
/** "(??)" alone (equation refs) or a standalone "??" followed by punctuation or line end. */
const STANDALONE_REF = /(?:\(\?\?\))|(?:(?<=^|[\s ([])\?\?(?=[.,;:)\]]|\s*$))/gm;
/** Every "??" not part of a longer run of question marks. */
const BARE_QQ = /(?<!\?)\?\?(?!\?)/g;
/** A prose word right before a reference: "See ??", "in ??", "and ??". */
const PROSE_BEFORE =
  /(?:^|[^\p{L}\p{N}_])(?:see|in|of|from|by|and|or|to|cf\.|with|on|under|at|than|like|as|per|also)[\s\u00a0~]{1,3}$/iu;
/** A prose word right after a reference: "?? and", "?? shows". */
const PROSE_AFTER =
  /^[\s\u00a0]{1,3}(?:and|or|shows?|for|to|in|is|are|was|were|we|that|which|with|of|on|gives?|illustrates?|lists?|summari[sz]es?|presents?|describes?|compares?|reports?|depicts?)(?![\p{L}\p{N}_])/iu;

/**
 * A standalone "??" in running prose ("See ?? and the table"): whitespace or punctuation
 * on both sides and a prose word before or after it. Code such as `a ?? b`, `a??b` or
 * `options ?? defaults` is not matched.
 */
function proseHits(text: string): Hit[] {
  const hits: Hit[] = [];
  BARE_QQ.lastIndex = 0;
  for (let m = BARE_QQ.exec(text); m; m = BARE_QQ.exec(text)) {
    const i = m.index;
    const prev = text[i - 1] ?? ' ';
    const next = text[i + 2] ?? ' ';
    if (!/[\s\u00a0~([]/.test(prev) || !/[\s\u00a0.,;:)\]]/.test(next)) continue;
    const before = text.slice(Math.max(0, i - 12), i);
    const after = text.slice(i + 2, i + 18);
    if (PROSE_BEFORE.test(before) || PROSE_AFTER.test(after)) hits.push({ index: i, length: 2 });
  }
  return hits;
}

/** "[?]" and "[?, ?]" — numeric citations that could not be resolved. */
const UNRESOLVED_CITE = /\[\?(?:\s*[,;]\s*\?)*\]/g;

function snippet(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 30);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

interface Hit {
  index: number;
  length: number;
}

function findAll(text: string, re: RegExp): Hit[] {
  const hits: Hit[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    hits.push({ index: m.index, length: m[0].length });
    if (m[0].length === 0) re.lastIndex++;
  }
  return hits;
}

function refHits(text: string): Hit[] {
  const ctx = findAll(text, CONTEXT_REF);
  const covered = (i: number) => ctx.some((h) => i >= h.index && i < h.index + h.length);
  const alone = findAll(text, STANDALONE_REF).filter((h) => !covered(h.index + h.length - 1));
  const seen = (i: number) =>
    covered(i + 1) || alone.some((h) => i >= h.index && i < h.index + h.length);
  const prose = proseHits(text).filter((h) => !seen(h.index));
  return [...ctx, ...alone, ...prose].sort((a, b) => a.index - b.index);
}

/**
 * Finds unresolved references ("??") and citations ("[?]") in the PDF text,
 * one problem per page and kind. Bare "??" inside code (`a ?? b`, `x??`) is
 * not reported: a reference word, parentheses or trailing punctuation is required.
 */
export function pdfOutputProblems(facts: PdfFacts): Problem[] {
  const problems: Problem[] = [];
  for (const page of facts.pages) {
    const refs = refHits(page.text);
    if (refs.length > 0) {
      const first = refs[0] as Hit;
      problems.push({
        rule: 'pdf-unresolved-reference',
        check: 'output',
        severity: 'error',
        message:
          refs.length === 1
            ? `"??" printed instead of a reference number`
            : `"??" printed instead of a reference number (${refs.length} times)`,
        location: { page: page.number },
        fix: 'Check the label exists and is spelled the same in `\\label` and `\\ref`, then rebuild (latexmk runs LaTeX until references settle)',
        evidence: snippet(page.text, first.index, first.length),
        data: { count: refs.length },
      });
    }
    const cites = findAll(page.text, UNRESOLVED_CITE);
    if (cites.length > 0) {
      const first = cites[0] as Hit;
      problems.push({
        rule: 'pdf-unresolved-citation',
        check: 'output',
        severity: 'error',
        message:
          cites.length === 1
            ? `"[?]" printed instead of a citation`
            : `"[?]" printed instead of a citation (${cites.length} times)`,
        location: { page: page.number },
        fix: 'Add the missing key to the .bib file (or fix its spelling) and rerun biber/bibtex via latexmk',
        evidence: snippet(page.text, first.index, first.length),
        data: { count: cites.length },
      });
    }
  }
  return problems;
}
