/** Builds clean BibEntry values from index metadata, with generated citation keys. */

import { parseNames } from '../bib/names.js';
import { type BibEntry, parseBib } from '../bib/parse.js';
import { texToPlain } from '../bib/tex.js';
import { foldText, normalizeTitle, stripMarkup } from './normalize.js';
import { sha256Hex } from './sha256.js';
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

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  ndash: '–',
  mdash: '—',
};

/** Decodes HTML entities that indexes leave in metadata (`&amp;`, `&#39;`, `&#x2014;`). */
export function htmlUnescape(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code =
        name[1] === 'x' || name[1] === 'X'
          ? Number.parseInt(name.slice(2), 16)
          : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Removes emoji and pictographs (with their variation selectors and joiners), tidying spaces. */
export function stripPictographs(s: string): string {
  const out = s.replace(
    /\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}]|\u200d|\ufe0e|\ufe0f/gu,
    '',
  );
  return out === s
    ? s
    : out
        .replace(/ {2,}/g, ' ')
        .replace(/\s+([}.,;:!?])/g, '$1')
        .trim();
}

/**
 * Escapes the TeX specials in a value that is mostly plain text but may already
 * contain TeX (publisher BibTeX): unescaped `&`, `%`, `#` get a backslash, and
 * `_` outside `$…$` too. Existing macros and math are kept.
 */
export function escapeLooseTex(s: string): string {
  let out = '';
  let math = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    const escaped = i > 0 && s[i - 1] === '\\';
    if (c === '$' && !escaped) math = !math;
    if (!escaped && (c === '&' || c === '%' || c === '#' || (c === '_' && !math))) out += '\\';
    out += c;
  }
  return out;
}

/** Fields that hold plain text (not names, numbers, URLs or identifiers). */
const TEXT_FIELDS = new Set([
  'title',
  'booktitle',
  'journal',
  'journaltitle',
  'publisher',
  'series',
  'collection',
  'school',
  'institution',
  'organization',
]);

/** Cleans one value from an index: HTML entities decoded, emoji removed. */
function cleanValue(v: string): string {
  return stripPictographs(htmlUnescape(v));
}

/** Escapes plain text from an index (titles, venues, names) for BibTeX/LaTeX. */
export function escapeTex(s: string): string {
  return s.replace(/[\\{}&%$#_^~]/g, (c) => {
    if (c === '\\') return '\\textbackslash{}';
    if (c === '^') return '\\^{}';
    if (c === '~') return '\\~{}';
    return `\\${c}`;
  });
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
      a.given
        ? `${escapeTex(cleanValue(a.family))}, ${escapeTex(cleanValue(a.given))}`
        : `{${escapeTex(cleanValue(a.family))}}`,
    )
    .join(' and ');
}

/** BibEntry from a normalized record (used when no publisher BibTeX is available). */
export function entryFromRecord(record: WorkRecord): BibEntry {
  const type = bibType(record);
  const fields: Record<string, string> = {};
  if (record.authors.length) fields.author = authorField(record);
  fields.title = escapeTex(cleanValue(stripMarkup(record.title)));
  if (record.venue && record.source !== 'arxiv') {
    fields[type === 'inproceedings' || type === 'incollection' ? 'booktitle' : 'journal'] =
      escapeTex(cleanValue(record.venue));
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
 * TeX primitives and macros that read or write files, run code, or change how
 * TeX reads input. A .bib value is typeset by LaTeX, so a registration agency's
 * metadata (DataCite titles are free text) must not carry them into the paper.
 */
const DANGEROUS_MACROS = new Set(
  [
    'input',
    'include',
    'includeonly',
    'inputiffileexists',
    'iffileexists',
    'endinput',
    'write',
    'immediate',
    'openout',
    'openin',
    'read',
    'readline',
    'closeout',
    'closein',
    'catcode',
    'def',
    'edef',
    'gdef',
    'xdef',
    'let',
    'futurelet',
    'newcommand',
    'renewcommand',
    'providecommand',
    'declarerobustcommand',
    'csname',
    'endcsname',
    'expandafter',
    'scantokens',
    'everyeof',
    'everypar',
    'everyjob',
    'output',
    'shipout',
    'special',
    'directlua',
    'latelua',
    'luaexec',
    'luadirect',
    'usepackage',
    'requirepackage',
    'documentclass',
    'shellescape',
    'pdfshellescape',
    'outer',
    'uppercase',
    'lowercase',
    'detokenize',
    'unexpanded',
    'begingroup',
    'aftergroup',
    'afterassignment',
    'globaldefs',
  ].map((m) => m.toLowerCase()),
);

/**
 * Makes a publisher-supplied BibTeX value safe to typeset: dangerous control
 * sequences lose their backslash (`\input{x}` → `\textbackslash{}input{x}`) and
 * `^^` (TeX's way of writing any character, such as `^^5c` for a backslash) is
 * escaped. Accents and formatting (`\"o`, `\textit{…}`, `$x^2$`) are kept.
 */
export function sanitizeTexValue(value: string): string {
  return value
    .replace(/\^\^/g, '\\textasciicircum{}\\textasciicircum{}')
    .replace(/\\([A-Za-z@]+)/g, (whole, name: string) =>
      DANGEROUS_MACROS.has(name.toLowerCase()) ? `\\textbackslash{}${name}` : whole,
    );
}

/**
 * Normalizes BibTeX served by doi.org: one entry, cleaned fields (`–` → `--`
 * in pages, publisher URL kept, noise like ISSN dropped, dangerous TeX
 * neutralized by `sanitizeTexValue`), generated key.
 */
export function entryFromPublisherBibtex(bibtex: string, doi: string): BibEntry | null {
  const [parsed] = parseBib(bibtex);
  if (!parsed?.fields.title) return null;
  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed.fields)) {
    if (DROP_FIELDS.has(name)) continue;
    // Publisher BibTeX is TeX-ish text with HTML entities left in (`&amp;`) and
    // sometimes emoji: decode, drop pictographs, escape loose specials, defuse macros.
    const decoded = cleanValue(value);
    const clean = sanitizeTexValue(TEXT_FIELDS.has(name) ? escapeLooseTex(decoded) : decoded);
    fields[name] = name === 'pages' ? clean.replace(/\s*[–—-]+\s*/g, '--') : clean;
  }
  fields.doi = doi;
  if (fields.url && isDoiOrgUrl(fields.url)) delete fields.url;
  // `collection` is not a BibTeX or biblatex field (some publishers' BibTeX has it,
  // often next to a `series` with the same value): keep it only as `series`.
  if (fields.collection) {
    fields.series ??= fields.collection;
    delete fields.collection;
  }
  const entry: BibEntry = { key: '', type: parsed.type, fields, line: 0, raw: '' };
  entry.key = generateKey(entry);
  return entry;
}

/** BibTeX field that records how an entry was added (`overfull cite`). */
export const PROVENANCE_FIELD = 'x-overfull';

/**
 * The string the provenance hash covers: type, key, normalized title, authors,
 * year, DOI and eprint. Editing any of them after `overfull cite` breaks the hash.
 */
export function provenanceCanonical(entry: Pick<BibEntry, 'type' | 'key' | 'fields'>): string {
  const f = entry.fields;
  const ws = (v: string | undefined) => (v ?? '').replace(/\s+/g, ' ').trim();
  return [
    entry.type.toLowerCase(),
    entry.key,
    normalizeTitle(f.title ?? '', true),
    ws(f.author),
    ws(f.year ?? f.date),
    ws(f.doi).toLowerCase(),
    ws(f.eprint).toLowerCase(),
  ].join('\u001f');
}

/** First 12 hex digits of SHA-256 over `provenanceCanonical(entry)`. */
export function provenanceHash(entry: Pick<BibEntry, 'type' | 'key' | 'fields'>): string {
  return sha256Hex(provenanceCanonical(entry)).slice(0, 12);
}

/**
 * Records where an entry came from: `x-overfull = {cite <source> <yyyy-mm-dd> <hash>}`.
 * The hash makes later edits to the entry evident (it is tamper-evident, not
 * authentication: anyone can recompute it). BibTeX and biber ignore unknown
 * fields; with `requireProvenance` the references check accepts unverified
 * entries only with a valid marker.
 */
export function markCited(
  entry: BibEntry,
  source: string,
  date: Date | string = new Date(),
): BibEntry {
  const day = typeof date === 'string' ? date : date.toISOString().slice(0, 10);
  return {
    ...entry,
    fields: {
      ...entry.fields,
      [PROVENANCE_FIELD]: `cite ${source} ${day} ${provenanceHash(entry)}`,
    },
  };
}

/**
 * The `x-overfull = {cite … <hash>}` provenance of an entry, when it has one
 * whose hash matches the entry as it is now. A missing or wrong hash (a
 * hand-written or edited entry) counts as no provenance.
 */
export function provenanceOf(entry: Pick<BibEntry, 'type' | 'key' | 'fields'>): string | undefined {
  const value = entry.fields[PROVENANCE_FIELD]?.replace(/\s+/g, ' ').trim();
  const m = value ? /^cite\s+\S+\s+\d{4}-\d{2}-\d{2}\s+([0-9a-f]{12})$/i.exec(value) : null;
  if (!m || (m[1] as string).toLowerCase() !== provenanceHash(entry)) return undefined;
  return value;
}

/** An entry the author vouches for: `note = {overfull: author-provided}` (agents must not add it). */
export function isAuthorProvided(entry: Pick<BibEntry, 'fields'>): boolean {
  return /overfull\s*:\s*author-provided/i.test(
    `${entry.fields.note ?? ''} ${entry.fields.annote ?? ''}`,
  );
}

/** True for a doi.org (or dx.doi.org) link; the host is compared, not searched for. */
function isDoiOrgUrl(value: string): boolean {
  try {
    const host = new URL(value.trim()).hostname.toLowerCase();
    return host === 'doi.org' || host === 'dx.doi.org';
  } catch {
    return false;
  }
}
