/**
 * `lookup`: turn a DOI, an arXiv id or a title into a BibEntry built from real
 * metadata. Title queries only return a near-exact title match; a weak match
 * returns null, because an agent must never receive the wrong paper.
 */

import { entryFromPublisherBibtex, entryFromRecord } from './entry.js';
import { HttpClient } from './http.js';
import { foldName, namesMatch, titleSimilarity } from './normalize.js';
import { arxivByIdCached, type Ctx, resolveDoiCached, titleSearch } from './search.js';
import { parseArxivId } from './sources/arxiv.js';
import { fetchDoiBibtex, parseDoi } from './sources/doi.js';
import type {
  LookupCandidate,
  LookupHint,
  LookupResult,
  RefsOptions,
  WorkRecord,
} from './types.js';

/** Minimum title similarity for a title query to return anything. */
export const LOOKUP_TITLE_THRESHOLD = 0.95;
/** Below this confidence, lookup returns null. */
export const LOOKUP_MIN_CONFIDENCE = 0.8;

const PUBLISHED_TYPES = new Set([
  'journal-article',
  'article-journal',
  'proceedings-article',
  'paper-conference',
  'book-chapter',
  'chapter',
  'book',
  'monograph',
  'edited-book',
  'dissertation',
  'article',
  'Journal Articles',
  'Conference and Workshop Papers',
  'Parts in Books or Collections',
  'Books and Theses',
]);

export type QueryKind = 'doi' | 'arxiv' | 'title';

/**
 * Thrown when a title query matches several distinct works (for example two
 * papers both titled "Literate Programming"). Callers show the candidates and
 * ask for a DOI, or retry with an author/year hint. Never pick one silently.
 */
export class AmbiguousLookupError extends Error {
  readonly candidates: LookupCandidate[];
  constructor(query: string, candidates: LookupCandidate[]) {
    super(
      candidates.length > 1
        ? `"${query}" matches ${candidates.length} different works. Use a DOI or arXiv id, or narrow it with an author or year.`
        : `"${query}" is too short to identify one work. Use a DOI or arXiv id, or add an author or year.`,
    );
    this.name = 'AmbiguousLookupError';
    this.candidates = candidates;
  }
}

/** Short titles ("Literate programming") are shared by many works: require a hint. */
const MIN_UNHINTED_TITLE_WORDS = 3;
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'on',
  'in',
  'for',
  'and',
  'to',
  'with',
  'by',
  'at',
]);

function significantWords(title: string): number {
  return title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !STOPWORDS.has(w)).length;
}

function matchesHint(r: WorkRecord, hint: LookupHint | undefined): boolean {
  if (!hint) return true;
  if (hint.author) {
    const surname = foldName(hint.author.trim().split(/\s+/).pop() ?? '');
    if (!r.authors.some((a) => namesMatch(foldName(a.family), surname))) return false;
  }
  if (hint.year !== undefined && !r.years.some((y) => Math.abs(y - (hint.year as number)) <= 1)) {
    return false;
  }
  return true;
}

export function toCandidate(r: WorkRecord): LookupCandidate {
  return {
    title: r.title,
    authors: r.authors.map((a) => (a.given ? `${a.given} ${a.family}` : a.family)),
    ...(r.years.length ? { year: Math.min(...r.years) } : {}),
    ...(r.venue ? { venue: r.venue } : {}),
    ...(r.doi ? { doi: r.doi } : {}),
    ...(r.arxivId ? { arxivId: r.arxivId } : {}),
    source: r.source,
  };
}

/** Classifies a lookup query. */
export function queryKind(query: string): { kind: QueryKind; value: string } {
  const arxiv = parseArxivId(query);
  if (arxiv) return { kind: 'arxiv', value: arxiv };
  const doi = parseDoi(query);
  if (doi) return { kind: 'doi', value: doi };
  return { kind: 'title', value: query.trim() };
}

/** Published versions outrank preprints, which outrank posted content and odds and ends. */
function typeRank(r: WorkRecord): number {
  if (r.source === 'arxiv' || r.type === 'Informal and Other Publications') return 2;
  if (PUBLISHED_TYPES.has(r.type ?? '')) return 3;
  if (r.type === 'posted-content' || r.type === 'preprint') return 1;
  return 0;
}

function sharesAuthor(a: WorkRecord, b: WorkRecord): boolean {
  return a.authors.some((x) =>
    b.authors.some((y) => namesMatch(foldName(x.family), foldName(y.family))),
  );
}

const firstYear = (r: WorkRecord) => (r.years.length ? Math.min(...r.years) : 9999);

interface Pick {
  record: WorkRecord;
  confidence: number;
}

/**
 * Among near-exact title matches, the earliest record anchors the work (copies
 * and spam re-deposits come later); within the anchor's author family the
 * published version wins. A strong match by different authors lowers confidence.
 */
export type TitlePick = Pick | { ambiguous: WorkRecord[] } | null;

/**
 * Among near-exact title matches (filtered by the hint), the earliest record
 * anchors the work (copies and spam re-deposits come later); within the
 * anchor's author family the published version wins. If another author family
 * also has a published or arXiv record with the same title, the query is
 * ambiguous and the caller must ask, never guess.
 */
export function pickTitleMatch(query: string, records: WorkRecord[], hint?: LookupHint): TitlePick {
  const strong = records
    .map((record) => ({ record, sim: titleSimilarity(query, record.title) }))
    .filter((c) => c.sim >= LOOKUP_TITLE_THRESHOLD && matchesHint(c.record, hint));
  if (!strong.length) return null;
  const anchor = [...strong].sort(
    (a, b) => firstYear(a.record) - firstYear(b.record) || typeRank(b.record) - typeRank(a.record),
  )[0] as (typeof strong)[number];
  const anchorYear = firstYear(anchor.record);
  const family = strong.filter((c) => c === anchor || sharesAuthor(c.record, anchor.record));
  const effectiveRank = (r: WorkRecord) =>
    firstYear(r) - anchorYear > 2 ? Math.min(typeRank(r), 1) : typeRank(r);
  const best = [...family].sort(
    (a, b) =>
      effectiveRank(b.record) - effectiveRank(a.record) ||
      (b.record.citations ?? 0) - (a.record.citations ?? 0) ||
      Number(!!b.record.doi) - Number(!!a.record.doi) ||
      firstYear(a.record) - firstYear(b.record),
  )[0] as (typeof strong)[number];
  const rivals = strong.filter((c) => !family.includes(c) && effectiveRank(c.record) >= 2);
  const unhintedShort =
    !hint?.author && hint?.year === undefined && significantWords(query) < MIN_UNHINTED_TITLE_WORDS;
  if (rivals.length || unhintedShort) {
    const seen: WorkRecord[] = [best.record];
    for (const c of [...rivals, ...strong]) {
      if (!seen.some((r) => r === c.record || sharesAuthor(r, c.record))) seen.push(c.record);
    }
    // A short title is too generic to trust even with a single match.
    if (seen.length > 1 || unhintedShort) return { ambiguous: seen.slice(0, 5) };
  }
  return { record: best.record, confidence: best.sim };
}

async function lookupDoi(ctx: Ctx, doi: string): Promise<LookupResult | null> {
  const res = await resolveDoiCached(ctx, doi);
  if (res.kind !== 'found') return null;
  const bibtex = await fetchDoiBibtex(ctx.client, doi);
  const entry = (bibtex && entryFromPublisherBibtex(bibtex, doi)) || entryFromRecord(res.record);
  return { entry, source: 'doi.org', confidence: 1 };
}

async function lookupArxiv(ctx: Ctx, id: string): Promise<LookupResult | null> {
  const record = await arxivByIdCached(ctx, id);
  return record ? { entry: entryFromRecord(record), source: 'arxiv', confidence: 1 } : null;
}

async function lookupTitle(
  ctx: Ctx,
  title: string,
  hint?: LookupHint,
): Promise<LookupResult | null> {
  const records: WorkRecord[] = [];
  const surname = hint?.author?.trim().split(/\s+/).pop();
  const query = {
    title,
    isTex: false,
    ...(surname ? { firstAuthor: surname, hinted: true } : {}),
    ...(hint?.year !== undefined ? { year: hint.year } : {}),
  };
  const outcome = await titleSearch(ctx, query, (found) => {
    records.push(...found);
    return false;
  });
  const picked = pickTitleMatch(title, records, hint);
  if (picked && 'ambiguous' in picked) {
    throw new AmbiguousLookupError(title, picked.ambiguous.map(toCandidate));
  }
  const pick = picked;
  if (!pick || pick.confidence < LOOKUP_MIN_CONFIDENCE) {
    if (!outcome.searched.length && outcome.failures.length) {
      throw new Error(`lookup failed: ${outcome.failures.map((f) => f.reason).join('; ')}`);
    }
    return null;
  }
  const { record } = pick;
  if (record.doi && !record.doi.startsWith('10.48550/')) {
    const viaDoi = await lookupDoi(ctx, record.doi).catch(() => null);
    if (
      viaDoi &&
      titleSimilarity(title, viaDoi.entry.fields.title ?? '') >= LOOKUP_TITLE_THRESHOLD
    ) {
      return { ...viaDoi, source: record.source, confidence: pick.confidence };
    }
  }
  return { entry: entryFromRecord(record), source: record.source, confidence: pick.confidence };
}

/**
 * Looks up a DOI (bare or doi.org URL), an arXiv id (`arXiv:2401.12345`,
 * `2401.12345v2`) or a title. Returns null when nothing confident is found;
 * throws `AmbiguousLookupError` when a title matches several works, and a plain
 * Error when no source could be reached at all.
 */
export async function lookup(query: string, opts: RefsOptions = {}): Promise<LookupResult | null> {
  if (opts.offline) return null;
  const ctx: Ctx = { client: new HttpClient(opts), opts };
  const { kind, value } = queryKind(query);
  if (kind === 'doi') return lookupDoi(ctx, value);
  if (kind === 'arxiv') return lookupArxiv(ctx, value);
  return lookupTitle(ctx, value, opts.hint);
}
