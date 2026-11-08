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
import type { LookupResult, RefsOptions, WorkRecord } from './types.js';

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
export function pickTitleMatch(query: string, records: WorkRecord[]): Pick | null {
  const strong = records
    .map((record) => ({ record, sim: titleSimilarity(query, record.title) }))
    .filter((c) => c.sim >= LOOKUP_TITLE_THRESHOLD);
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
  const competitor = strong.some((c) => !family.includes(c) && effectiveRank(c.record) >= 2);
  return { record: best.record, confidence: best.sim * (competitor ? 0.85 : 1) };
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

async function lookupTitle(ctx: Ctx, title: string): Promise<LookupResult | null> {
  const records: WorkRecord[] = [];
  const outcome = await titleSearch(ctx, { title, isTex: false }, (found) => {
    records.push(...found);
    return false;
  });
  const pick = pickTitleMatch(title, records);
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
 * throws when no source could be reached at all.
 */
export async function lookup(query: string, opts: RefsOptions = {}): Promise<LookupResult | null> {
  if (opts.offline) return null;
  const ctx: Ctx = { client: new HttpClient(opts), opts };
  const { kind, value } = queryKind(query);
  if (kind === 'doi') return lookupDoi(ctx, value);
  if (kind === 'arxiv') return lookupArxiv(ctx, value);
  return lookupTitle(ctx, value);
}
