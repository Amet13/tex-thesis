import type { BibEntry } from '../bib/parse.js';
import { arxivCacheKey, doiCacheKey, titleCacheKey } from './cache.js';
import { provenanceOf } from './entry.js';
import { HttpClient } from './http.js';
import {
  type EntryKind,
  entryKind,
  type Identifiers,
  identifiersOf,
  notIndexedReason,
} from './kind.js';
import { type Assessment, assess, type BibFacts, bestAssessment, bibFacts } from './match.js';
import {
  arxivByIdCached,
  type Ctx,
  failureReason,
  resolveDoiCached,
  type SourceFailure,
  titleSearch,
} from './search.js';
import type { MatchedRecord, RefResult, RefSource, RefsOptions, WorkRecord } from './types.js';

const SOURCE_NAMES: Record<RefSource, string> = {
  'doi.org': 'doi.org',
  crossref: 'CrossRef',
  dblp: 'dblp',
  arxiv: 'arXiv',
  openalex: 'OpenAlex',
};

/** Sources whose answer is needed before "no match" may become `not-found`. */
const REQUIRED_FOR_NOT_FOUND: RefSource[] = ['crossref', 'dblp'];

export function sourceName(s: RefSource): string {
  return SOURCE_NAMES[s];
}

export function toMatched(r: WorkRecord): MatchedRecord {
  const m: MatchedRecord = {
    title: r.title.replace(/<[^>]+>/g, ''),
    authors: r.authors.map((a) => (a.given ? `${a.given} ${a.family}` : a.family)),
  };
  const year = r.years.length ? Math.min(...r.years) : undefined;
  if (year !== undefined) m.year = year;
  if (r.venue) m.venue = r.venue;
  if (r.doi) m.doi = r.doi;
  if (r.url) m.url = r.url;
  if (r.type) m.type = r.type;
  return m;
}

/** Evidence gathered for one entry across identifier lookups and title searches. */
interface Evidence {
  assessments: Assessment[];
  searched: Set<RefSource>;
  failures: SourceFailure[];
  doiMissing: boolean;
  arxivMissing: boolean;
  queries: string[];
}

function isSkipped(entry: BibEntry, ignore: Set<string>): boolean {
  if (ignore.has(entry.key)) return true;
  return /overfull\s*:\s*skip/i.test(`${entry.fields.note ?? ''} ${entry.fields.annote ?? ''}`);
}

function fromAssessment(base: RefResult, a: Assessment, ev: Evidence): RefResult {
  const result: RefResult = {
    ...base,
    status: a.verdict === 'verified' ? 'verified' : 'mismatch',
    source: a.record.source,
    matched: toMatched(a.record),
    searched: [...ev.searched],
  };
  if (a.differences.length) result.differences = a.differences;
  const doiDiff = a.differences[0];
  if (a.differentWork && doiDiff?.field === 'doi' && a.record.source === 'doi.org') {
    result.wrongWork = { field: 'doi', id: doiDiff.bib, title: toMatched(a.record).title };
  }
  if (a.verdict === 'verified' && a.yearDiff === 1) {
    result.reason = 'year differs by one (common between preprint, online and print versions)';
  }
  return result;
}

async function checkDoi(
  ctx: Ctx,
  doi: string,
  facts: BibFacts,
  ev: Evidence,
): Promise<Assessment | null> {
  ev.queries.push(doiCacheKey(doi));
  try {
    const res = await resolveDoiCached(ctx, doi);
    ev.searched.add('doi.org');
    if (res.kind === 'missing') ev.doiMissing = true;
    if (res.kind !== 'found') return null;
    const a = assess(facts, res.record, true);
    if (a.differentWork) {
      a.differences = [
        { field: 'doi', bib: doi, record: `resolves to “${a.record.title}”` },
        ...a.differences.filter((d) => d.field !== 'title'),
      ];
    }
    ev.assessments.push(a);
    return a;
  } catch (err) {
    if (ctx.opts.signal?.aborted) throw err;
    ev.failures.push({ source: 'doi.org', reason: failureReason(err) });
    return null;
  }
}

async function checkArxiv(
  ctx: Ctx,
  id: string,
  facts: BibFacts,
  ev: Evidence,
): Promise<Assessment | null> {
  ev.queries.push(arxivCacheKey(id));
  try {
    const record = await arxivByIdCached(ctx, id);
    ev.searched.add('arxiv');
    if (!record) {
      ev.arxivMissing = true;
      return null;
    }
    const a = assess(facts, record, true);
    if (a.differentWork) {
      a.differences = [
        { field: 'eprint', bib: id, record: `is “${record.title}”` },
        ...a.differences.filter((d) => d.field !== 'title'),
      ];
    }
    ev.assessments.push(a);
    return a;
  } catch (err) {
    if (ctx.opts.signal?.aborted) throw err;
    ev.failures.push({ source: 'arxiv', reason: failureReason(err) });
    return null;
  }
}

async function searchByTitle(
  ctx: Ctx,
  facts: BibFacts,
  kind: EntryKind,
  ev: Evidence,
): Promise<void> {
  if (!facts.title) return;
  ev.queries.push(titleCacheKey(facts.title, facts.year));
  const firstAuthor = facts.firstIsPersonal ? facts.surnames[0] : undefined;
  const outcome = await titleSearch(
    ctx,
    {
      title: facts.title,
      isTex: true,
      ...(firstAuthor ? { firstAuthor } : {}),
      ...(facts.year ? { year: facts.year } : {}),
    },
    (records) => {
      // For books, theses and misc entries a same-title record from another year is usually
      // another edition, a review or a re-deposit: only a full match counts.
      const found = records
        .map((r) => assess(facts, r, false))
        .filter((a) => kind === 'scholarly' || a.verdict !== 'mismatch');
      ev.assessments.push(...found);
      return found.some((a) => a.verdict === 'verified');
    },
  );
  for (const s of outcome.searched) ev.searched.add(s);
  ev.failures.push(...outcome.failures);
}

function sourcesText(sources: RefSource[]): string {
  const names = sources.map(sourceName);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

function failuresText(failures: SourceFailure[]): string {
  return failures.map((f) => f.reason).join('; ');
}

/**
 * The entry's own DOI or arXiv id did not resolve, but a title search found the work:
 * the identifier in the .bib is wrong, so the entry cannot be `verified`.
 */
function withBrokenIds(result: RefResult, ids: Identifiers, ev: Evidence): RefResult {
  const broken: NonNullable<RefResult['differences']> = [];
  if (ev.doiMissing && ids.doi) {
    broken.push({ field: 'doi', bib: ids.doi, record: 'does not resolve' });
  }
  if (ev.arxivMissing && ids.arxivId) {
    broken.push({ field: 'eprint', bib: ids.arxivId, record: 'does not resolve' });
  }
  if (!broken.length) return result;
  const what = broken.map((d) => (d.field === 'doi' ? `DOI ${d.bib}` : `arXiv id ${d.bib}`));
  const { reason: _reason, ...rest } = result;
  return {
    ...rest,
    status: 'mismatch',
    differences: [...broken, ...(result.differences ?? [])],
    reason: `the ${what.join(' and the ')} does not resolve, but a record with this title exists`,
  };
}

/** No candidate matched: decide between not-found, unverifiable and error. */
function noMatch(
  base: RefResult,
  entry: BibEntry,
  kind: EntryKind,
  ids: Identifiers,
  ev: Evidence,
): RefResult {
  const searched = [...ev.searched];
  const withSearched = { ...base, searched };
  const failedRequired = ev.failures.filter((f) => REQUIRED_FOR_NOT_FOUND.includes(f.source));
  const titleNote = entry.fields.title ? ' and no record has a similar title' : '';
  if (ev.arxivMissing) {
    return {
      ...withSearched,
      status: 'not-found',
      reason: `arXiv has no paper ${ids.arxivId}${titleNote}`,
    };
  }
  if (ev.doiMissing) {
    if (kind === 'scholarly') {
      return {
        ...withSearched,
        status: 'not-found',
        reason: `the DOI ${ids.doi} does not exist${titleNote}`,
      };
    }
    return {
      ...withSearched,
      status: 'mismatch',
      differences: [
        { field: 'doi', bib: ids.doi as string, record: 'does not resolve at doi.org' },
      ],
      reason: `the DOI ${ids.doi} does not exist`,
    };
  }
  if (kind !== 'scholarly') {
    const why =
      entry.type === 'book' || entry.type === 'inbook'
        ? 'books are often not indexed'
        : entry.type.endsWith('thesis')
          ? 'theses are often not indexed'
          : 'this kind of entry is often not indexed';
    const failed = ev.failures.length ? ` (lookup incomplete: ${failuresText(ev.failures)})` : '';
    return {
      ...withSearched,
      status: 'unverifiable',
      reason: `no match found, but ${why}${failed}`,
    };
  }
  if (failedRequired.length || !searched.length) {
    const failed = [...new Set(ev.failures.map((f) => f.source))];
    return {
      ...withSearched,
      ...(failed.length ? { failed } : {}),
      status: 'error',
      reason: `lookup incomplete: ${failuresText(ev.failures) || 'no source answered'}`,
    };
  }
  return {
    ...withSearched,
    status: 'not-found',
    reason: `no record with a similar title in ${sourcesText(searched.filter((s) => s !== 'doi.org'))}`,
  };
}

/** Verifies one entry. Never throws for network problems (they become `error`). */
export async function verifyEntry(
  entry: BibEntry,
  ctx: Ctx,
  ignore: Set<string>,
): Promise<RefResult> {
  const base: RefResult = { key: entry.key, status: 'unverifiable' };
  if (entry.line) base.location = { line: entry.line, ...(entry.file ? { file: entry.file } : {}) };
  if (isSkipped(entry, ignore)) return { ...base, reason: 'skipped by author' };
  const ids = identifiersOf(entry);
  const kind = entryKind(entry, ids);
  if (kind === 'not-indexed') return { ...base, reason: notIndexedReason(entry) };
  const facts = bibFacts(entry);
  if (!facts.title && !ids.doi && !ids.arxivId)
    return { ...base, reason: 'no title, DOI or arXiv id to look up' };

  const ev: Evidence = {
    assessments: [],
    searched: new Set(),
    failures: [],
    doiMissing: false,
    arxivMissing: false,
    queries: [],
  };
  // The entry's own identifiers are authoritative: their verdict is final.
  const viaId =
    (ids.doi ? await checkDoi(ctx, ids.doi, facts, ev) : null) ??
    (ids.arxivId ? await checkArxiv(ctx, ids.arxivId, facts, ev) : null);
  const withQuery = (r: RefResult): RefResult => ({ ...r, query: ev.queries[0] ?? '' });
  if (viaId) return withQuery(withBrokenIds(fromAssessment(base, viaId, ev), ids, ev));

  await searchByTitle(ctx, facts, kind, ev);
  const best = bestAssessment(ev.assessments);
  if (best) return withQuery(withBrokenIds(fromAssessment(base, best, ev), ids, ev));
  return withQuery(noMatch(base, entry, kind, ids, ev));
}

async function runPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i] as T);
    }
  });
  await Promise.all(lanes);
  return results;
}

/**
 * Verifies every entry against doi.org, CrossRef, dblp, arXiv (and OpenAlex
 * with a key). Results are in input order. Network failures yield `error`,
 * never `not-found`.
 */
export async function verifyEntries(
  entries: BibEntry[],
  opts: RefsOptions = {},
): Promise<RefResult[]> {
  if (opts.offline) {
    return entries.map((e) => ({
      key: e.key,
      status: 'unverifiable' as const,
      reason: 'offline',
      ...(e.line ? { location: { line: e.line, ...(e.file ? { file: e.file } : {}) } } : {}),
    }));
  }
  const ctx: Ctx = { client: new HttpClient(opts), opts };
  const ignore = new Set(opts.ignore ?? []);
  return runPool(entries, opts.concurrency ?? 4, async (e) => {
    const result = await verifyEntry(e, ctx, ignore);
    return opts.requireProvenance && isUnproven(e, result) ? { ...result, unproven: true } : result;
  });
}

/** Not verified, not added with `overfull cite`, and of a kind `overfull cite` can add. */
export function isUnproven(entry: BibEntry, result: RefResult): boolean {
  if (result.status === 'verified' || provenanceOf(entry)) return false;
  return entryKind(entry, identifiersOf(entry)) !== 'not-indexed';
}
