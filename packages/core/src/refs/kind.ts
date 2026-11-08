/**
 * What an index can be expected to know about an entry. This decides whether
 * "no match" may be reported as `not-found` (an error) or only as
 * `unverifiable` (info). Erring towards `unverifiable` is deliberate: a false
 * "not found" on a real reference is the worst outcome.
 */

import type { BibEntry } from '../bib/parse.js';
import { parseArxivId } from './sources/arxiv.js';
import { parseDoi } from './sources/doi.js';

export type EntryKind =
  /** Journal/conference/collection papers: indexes are expected to have them. */
  | 'scholarly'
  /** Books, theses, reports, preprints-as-misc: search, but a miss is not evidence. */
  | 'maybe-indexed'
  /** Websites, software, standards, datasets: not searched. */
  | 'not-indexed';

const SCHOLARLY = new Set(['article', 'inproceedings', 'conference', 'incollection']);
const NOT_INDEXED = new Set([
  'online',
  'www',
  'webpage',
  'electronic',
  'software',
  'codefragment',
  'softwareversion',
  'softwaremodule',
  'dataset',
  'data',
  'standard',
  'manual',
  'patent',
  'artwork',
  'audio',
  'video',
  'image',
  'movie',
  'music',
  'performance',
  'legislation',
  'legal',
  'jurisdiction',
]);

export interface Identifiers {
  doi?: string;
  arxivId?: string;
}

/** DOI and arXiv id from doi/eprint/archiveprefix/journal/url/note fields. */
export function identifiersOf(entry: BibEntry): Identifiers {
  const f = entry.fields;
  const ids: Identifiers = {};
  const doi = f.doi ? parseDoi(f.doi) : null;
  const archive = (f.archiveprefix ?? f.eprinttype ?? '').toLowerCase();
  const candidates = [
    archive === 'arxiv' || (!archive && f.eprint) ? f.eprint : undefined,
    doi?.startsWith('10.48550/') ? doi : undefined,
    ...[f.journal, f.journaltitle, f.url, f.note, f.howpublished].map(
      (v) => /arxiv[.:/\s]*(?:abs\/|org\/abs\/)?\s*([a-z-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})(v\d+)?/i.exec(v ?? '')?.[1],
    ),
  ];
  for (const c of candidates) {
    const id = c ? parseArxivId(c) : null;
    if (id) {
      ids.arxivId = id;
      break;
    }
  }
  if (doi && !doi.startsWith('10.48550/')) ids.doi = doi;
  return ids;
}

/** RFCs, ISO/IEEE standards and similar, whatever entry type they were filed under. */
export function isStandard(entry: BibEntry): boolean {
  const f = entry.fields;
  const text = [f.title, f.number, f.series, f.howpublished, f.url, f.publisher, f.institution]
    .filter(Boolean)
    .join(' ');
  return /\bRFC\s*\d+|rfc-editor\.org|datatracker\.ietf\.org|\bISO(?:\/IEC)?\s+\d{3,}|\bInternet Engineering Task Force\b/i.test(
    text,
  );
}

/** Only a URL (and maybe a title/date): a web page, whatever the entry type says. */
function isWebOnly(entry: BibEntry): boolean {
  const f = entry.fields;
  const hasVenue = f.journal || f.journaltitle || f.booktitle || f.publisher || f.school || f.institution;
  return !!(f.url || f.howpublished?.includes('\\url')) && !f.author && !hasVenue;
}

export function entryKind(entry: BibEntry, ids: Identifiers): EntryKind {
  if (ids.doi || ids.arxivId) return SCHOLARLY.has(entry.type) ? 'scholarly' : 'maybe-indexed';
  if (NOT_INDEXED.has(entry.type) || isStandard(entry) || isWebOnly(entry)) return 'not-indexed';
  if (SCHOLARLY.has(entry.type)) return 'scholarly';
  return 'maybe-indexed';
}

/** Plain-language label for an entry an index cannot be expected to have. */
export function notIndexedReason(entry: BibEntry): string {
  if (isStandard(entry)) return 'standards and RFCs are not in scholarly indexes';
  if (['software', 'codefragment', 'softwareversion', 'softwaremodule'].includes(entry.type)) {
    return 'software is not in scholarly indexes';
  }
  if (entry.type === 'dataset' || entry.type === 'data') return 'datasets are not reliably indexed';
  if (entry.type === 'patent') return 'patents are not in scholarly indexes';
  if (entry.type === 'manual') return 'manuals are not in scholarly indexes';
  return 'web pages are not in scholarly indexes';
}
