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

/** DOI and arXiv id from doi/eprint/archiveprefix/journal/url/howpublished/note fields. */
export function identifiersOf(entry: BibEntry): Identifiers {
  const f = entry.fields;
  const ids: Identifiers = {};
  // A DOI written as a doi.org link in `url` or `howpublished` is the entry's DOI too.
  const doi =
    (f.doi ? parseDoi(f.doi) : null) ??
    [f.url, f.howpublished]
      .map((v) => {
        const m = /https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/[^\s{}]+)/i.exec(v ?? '');
        return m ? parseDoi(m[1] as string) : null;
      })
      .find((d): d is string => Boolean(d)) ??
    null;
  const archive = (f.archiveprefix ?? f.eprinttype ?? '').toLowerCase();
  const candidates = [
    archive === 'arxiv' || (!archive && f.eprint) ? f.eprint : undefined,
    doi?.startsWith('10.48550/') ? doi : undefined,
    ...[f.journal, f.journaltitle, f.url, f.note, f.howpublished].map(
      (v) =>
        /arxiv[.:/\s]*(?:abs\/|org\/abs\/)?\s*([a-z-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})(v\d+)?/i.exec(
          v ?? '',
        )?.[1],
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

/** Entry types a standard is filed under. Journal and conference papers never are. */
const STANDARD_TYPES = new Set(['techreport', 'report', 'standard', 'manual', 'misc']);

/** Bodies that publish standards (institution / organization / publisher). */
const STANDARDS_BODY =
  /^(?:the\s+)?(?:ISO|IEC|ISO\/IEC|IETF|Internet Engineering Task Force|RFC Editor|W3C|World Wide Web Consortium|ANSI|American National Standards Institute|NIST|National Institute of Standards and Technology|ETSI|European Telecommunications Standards Institute|ITU|ITU-T|ITU-R|International Telecommunication Union|International Organization for Standardization|International Electrotechnical Commission|DIN|BSI|British Standards Institution|CEN|CENELEC|Ecma International|ECMA|Unicode Consortium|The Unicode Consortium|OASIS|IEEE Standards Association|IEEE-SA|3GPP|WHATWG|Khronos Group)\b/i;

/** A standards identifier at the start of a number, title or howpublished field. */
const STANDARD_ID =
  /^(?:RFC\s*-?\s*\d+|BCP\s*\d+|ISO(?:\/IEC)?(?:\/IEEE)?\s+\d{3,}|IEC\s+\d{3,}|IEEE\s+Std\b|IEEE\s+\d{3,}(?:\.\d+)?-\d{4}|ANSI\s+[A-Z]|NIST\s+(?:SP|FIPS|IR)\b|FIPS\s*(?:PUB\s*)?\d+|ITU-[TR]\s+[A-Z]\.\d+|ETSI\s+(?:TS|EN|ES|TR)\b|ECMA-\d+|3GPP\s+TS\b|W3C\s+Recommendation\b)/i;

/** URLs of standards bodies' document pages. */
const STANDARD_URL =
  /^https?:\/\/(?:www\.)?(?:rfc-editor\.org|datatracker\.ietf\.org|tools\.ietf\.org|iso\.org|w3\.org\/TR|nvlpubs\.nist\.gov|etsi\.org\/deliver|itu\.int\/rec)\b/i;

const plain = (v: string | undefined) =>
  (v ?? '').replace(/[{}]/g, '').replace(/\\url/g, '').trim();

/**
 * RFCs, ISO/IEEE standards and similar. Only report-like entry types qualify
 * (techreport, standard, manual, misc), and only when a standards body issued
 * them or their number/title starts with a standards identifier: a journal or
 * conference paper whose title mentions "ISO 9001" is still a paper.
 */
export function isStandard(entry: BibEntry): boolean {
  if (!STANDARD_TYPES.has(entry.type)) return false;
  const f = entry.fields;
  if (entry.type !== 'standard' && (f.journal || f.journaltitle || f.booktitle)) return false;
  const body = [f.institution, f.organization, f.publisher].map(plain);
  if (body.some((b) => STANDARDS_BODY.test(b))) return true;
  const ids = [f.number, f.title, f.howpublished, f.series].map(plain);
  if (ids.some((v) => STANDARD_ID.test(v))) return true;
  return [f.url, f.howpublished].map(plain).some((u) => STANDARD_URL.test(u));
}

/** Only a URL (and maybe a title/date): a web page, whatever the entry type says. */
function isWebOnly(entry: BibEntry): boolean {
  const f = entry.fields;
  const hasVenue =
    f.journal || f.journaltitle || f.booktitle || f.publisher || f.school || f.institution;
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
