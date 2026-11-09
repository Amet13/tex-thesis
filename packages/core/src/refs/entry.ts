/** Builds clean BibEntry values from index metadata, with generated citation keys. */

import { parseNames } from '../bib/names.js';
import { type BibEntry, parseBib } from '../bib/parse.js';
import { texToPlain } from '../bib/tex.js';
import { foldText, stripMarkup } from './normalize.js';
import type { WorkRecord } from './types.js';

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'on',
  'of',
  'in',
  'for',
  'and',
  'to',
  'with',
  'at',
  'by',
  'from',
  'towards',
  'toward',
  'via',
  'is',
  'are',
  'do',
  'does',
  'how',
  'what',
  'why',
  'when',
  'can',
  'we',
  'all',
  'into',
  'about',
  'over',
  'under',
  'using',
  'der',
  'die',
  'das',
  'le',
  'la',
  'les',
  'zur',
  'uber',
]);

function asciiWord(s: string): string {
  return foldText(s).replace(/[^a-z0-9]/g, '');
}

/**
 * `<first author surname><year><first significant title word>`, lowercase
 * ASCII: `ongaro2014search`, `vaswani2017attention`, `godel1931formal`.
 */
export function generateKey(entry: Pick<BibEntry, 'fields'>): string {
  const [first] = parseNames(entry.fields.author ?? entry.fields.editor);
  const surname = first
    ? asciiWord(
        first.corporate
          ? (first.family.split(/\s+/)[0] ?? '')
          : (first.family.split(/\s+/).pop() ?? ''),
      )
    : '';
  const year = /\d{4}/.exec(entry.fields.year ?? entry.fields.date ?? '')?.[0] ?? '';
  const words = foldText(texToPlain(entry.fields.title ?? ''))
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const word = words.find((w) => !STOPWORDS.has(w) && w.length > 1) ?? words[0] ?? '';
  return `${surname || 'anon'}${year}${word}`;
}

/** Escapes characters that are special in BibTeX/TeX values. */
export function escapeTex(s: string): string {
  return s.replace(/([&%$#_])/g, '\\$1').replace(/[{}]/g, '');
}

const CROSSREF_TYPES: Record<string, string> = {
  'journal-article': 'article',
  'article-journal': 'article',
  'proceedings-article': 'inproceedings',
  'paper-conference': 'inproceedings',
  'book-chapter': 'incollection',
  chapter: 'incollection',
  book: 'book',
  monograph: 'book',
  'edited-book': 'book',
  dissertation: 'phdthesis',
  thesis: 'phdthesis',
  report: 'techreport',
  'Journal Articles': 'article',
  'Conference and Workshop Papers': 'inproceedings',
  'Parts in Books or Collections': 'incollection',
  'Books and Theses': 'book',
  article: 'article',
};

function bibType(record: WorkRecord): string {
  if (record.source === 'arxiv') return 'misc';
  return CROSSREF_TYPES[record.type ?? ''] ?? 'misc';
}

function authorField(record: WorkRecord): string {
  return record.authors
    .map((a) =>
      a.given ? `${escapeTex(a.family)}, ${escapeTex(a.given)}` : `{${escapeTex(a.family)}}`,
    )
    .join(' and ');
}

/** BibEntry from a normalized record (used when no publisher BibTeX is available). */
export function entryFromRecord(record: WorkRecord): BibEntry {
  const type = bibType(record);
  const fields: Record<string, string> = {};
  if (record.authors.length) fields.author = authorField(record);
  fields.title = escapeTex(stripMarkup(record.title));
  if (record.venue && record.source !== 'arxiv') {
    fields[type === 'inproceedings' || type === 'incollection' ? 'booktitle' : 'journal'] =
      escapeTex(record.venue);
  }
  const year = record.years.length ? Math.min(...record.years) : undefined;
  if (year) fields.year = String(year);
  if (record.doi && !record.doi.startsWith('10.48550/')) fields.doi = record.doi;
  if (record.arxivId) {
    fields.eprint = record.arxivId;
    fields.archiveprefix = 'arXiv';
    fields.url = `https://arxiv.org/abs/${record.arxivId}`;
  } else if (record.url && !record.doi) {
    fields.url = record.url;
  }
  const entry: BibEntry = { key: '', type, fields, line: 0, raw: '' };
  entry.key = generateKey(entry);
  return entry;
}

const DROP_FIELDS = new Set([
  'issn',
  'abstract',
  'abstractnote',
  'keywords',
  'copyright',
  'language',
  'month',
]);

/**
 * Normalizes BibTeX served by doi.org: one entry, cleaned fields (`–` → `--`
 * in pages, publisher URL kept, noise like ISSN dropped), generated key.
 */
export function entryFromPublisherBibtex(bibtex: string, doi: string): BibEntry | null {
  const [parsed] = parseBib(bibtex);
  if (!parsed?.fields.title) return null;
  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed.fields)) {
    if (DROP_FIELDS.has(name)) continue;
    fields[name] = name === 'pages' ? value.replace(/\s*[–—-]+\s*/g, '--') : value;
  }
  fields.doi = doi;
  if (fields.url && /doi\.org\//i.test(fields.url)) delete fields.url;
  const entry: BibEntry = { key: '', type: parsed.type, fields, line: 0, raw: '' };
  entry.key = generateKey(entry);
  return entry;
}

/** BibTeX field that records how an entry was added (`overfull cite`). */
export const PROVENANCE_FIELD = 'x-overfull';

/**
 * Records where an entry came from: `x-overfull = {cite <source> <yyyy-mm-dd>}`.
 * BibTeX and biber ignore unknown fields, and `formatBibEntry` keeps them; with
 * `requireProvenance` the references check accepts unverified entries only with it.
 */
export function markCited(entry: BibEntry, source: string, date: Date | string = new Date()): BibEntry {
  const day = typeof date === 'string' ? date : date.toISOString().slice(0, 10);
  return { ...entry, fields: { ...entry.fields, [PROVENANCE_FIELD]: `cite ${source} ${day}` } };
}

/** The `x-overfull = {cite …}` provenance of an entry, if it has one. */
export function provenanceOf(entry: Pick<BibEntry, 'fields'>): string | undefined {
  const value = entry.fields[PROVENANCE_FIELD]?.trim();
  return value && /^cite\b/i.test(value) ? value : undefined;
}
