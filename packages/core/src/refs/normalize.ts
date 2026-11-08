/** Text normalization and similarity used to compare bib entries with index records. */

import { texToPlain } from '../bib/tex.js';

const GREEK_NAMES: Record<string, string> = {
  α: 'alpha',
  β: 'beta',
  γ: 'gamma',
  δ: 'delta',
  ε: 'epsilon',
  ζ: 'zeta',
  η: 'eta',
  θ: 'theta',
  ϑ: 'theta',
  ι: 'iota',
  κ: 'kappa',
  λ: 'lambda',
  μ: 'mu',
  ν: 'nu',
  ξ: 'xi',
  π: 'pi',
  ρ: 'rho',
  σ: 'sigma',
  ς: 'sigma',
  τ: 'tau',
  υ: 'upsilon',
  φ: 'phi',
  ϕ: 'phi',
  χ: 'chi',
  ψ: 'psi',
  ω: 'omega',
};

const FOLD: Record<string, string> = {
  ß: 'ss',
  ø: 'o',
  æ: 'ae',
  œ: 'oe',
  ł: 'l',
  ð: 'd',
  þ: 'th',
  ı: 'i',
  ŋ: 'ng',
};

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Removes HTML/JATS/MathML tags and decodes entities (CrossRef titles contain `<i>`, `<sub>`…). */
export function stripMarkup(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** ASCII-folds plain text: strips diacritics, spells out Greek, lowercases. */
export function foldText(plain: string): string {
  return plain
    .toLowerCase()
    .replace(/[α-ωϑϕς]/g, (c) => ` ${GREEK_NAMES[c] ?? c} `)
    .replace(/[ßøæœłðþıŋ]/g, (c) => FOLD[c] ?? c)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}

/** Normalized word list for a title written in TeX (bib) or markup (records). */
export function titleWords(title: string, isTex = true): string[] {
  const plain = isTex ? texToPlain(title) : stripMarkup(title);
  return foldText(plain)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** Normalized title string: lowercase ASCII words separated by single spaces. */
export function normalizeTitle(title: string, isTex = true): string {
  return titleWords(title, isTex).join(' ');
}

function dice(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const counts = new Map<string, number>();
  for (const w of a) counts.set(w, (counts.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of b) {
    const n = counts.get(w) ?? 0;
    if (n > 0) {
      shared++;
      counts.set(w, n - 1);
    }
  }
  return (2 * shared) / (a.length + b.length);
}

/** The part of a title before its subtitle separator (`:`, `?`, `.`, ` - `, em dash). */
export function mainTitle(plain: string): string {
  const m = /^(.+?)(?:\s*[:?!.]\s+|\s+[-–—]+\s+|\s*—\s*)\S/.exec(plain);
  return m ? (m[1] as string) : plain;
}

/**
 * Title similarity in [0, 1]: Sørensen–Dice on normalized words, plus a
 * subtitle rule — when one title equals the other's main title (the part
 * before `:` etc.) and has at least two words, the score is 0.92.
 * `bibTitle` is TeX; `recordTitle` is plain text/markup from an index.
 */
export function titleSimilarity(bibTitle: string, recordTitle: string): number {
  const a = titleWords(bibTitle, true);
  const b = titleWords(recordTitle, false);
  if (!a.length || !b.length) return 0;
  if (a.join(' ') === b.join(' ')) return 1;
  let score = dice(a, b);
  const aMain = titleWords(mainTitle(texToPlain(bibTitle)), false);
  const bMain = titleWords(mainTitle(stripMarkup(recordTitle)), false);
  const subtitleMatch =
    (aMain.length >= 2 && aMain.join(' ') === b.join(' ') && aMain.length < a.length) ||
    (bMain.length >= 2 && bMain.join(' ') === a.join(' ') && bMain.length < b.length);
  if (subtitleMatch) score = Math.max(score, 0.92);
  return score;
}

/** Folded surname for comparison: `Erd{\H{o}}s` → `erdos`, `van der Aalst` → `van der aalst`. */
export function foldName(name: string): string {
  return foldText(stripMarkup(name))
    .replace(/[^a-z\s-]+/g, '')
    .replace(/[\s-]+/g, ' ')
    .trim();
}

const PARTICLES = new Set(['van', 'von', 'der', 'den', 'de', 'del', 'della', 'di', 'da', 'du', 'dos', 'la', 'le', 'ten', 'ter', 'jr', 'sr']);

function significant(name: string): string[] {
  return name.split(' ').filter((w) => w.length > 1 && !PARTICLES.has(w));
}

/**
 * Two folded surnames match when the significant words (particles dropped) of
 * one are a subset of the other's: `van der aalst` ~ `aalst`, `garcia marquez` ~ `garcia`.
 */
export function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const sa = significant(a);
  const sb = significant(b);
  if (!sa.length || !sb.length) return false;
  const [small, large] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
  return small.every((w) => large.includes(w));
}
