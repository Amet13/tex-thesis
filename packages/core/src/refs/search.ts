import { texToPlain } from '../bib/tex.js';
import {
  arxivCacheKey,
  cached,
  cacheMaxAge,
  doiCacheKey,
  isFresh,
  titleCacheKey,
} from './cache.js';
import { type HttpClient, SourceUnavailableError } from './http.js';
import { arxivById, arxivSearch } from './sources/arxiv.js';
import { crossrefSearch } from './sources/crossref.js';
import { dblpSearch } from './sources/dblp.js';
import { type DoiResolution, resolveDoi } from './sources/doi.js';
import { openalexSearch } from './sources/openalex.js';
import type { RefSource, RefsOptions, WorkRecord } from './types.js';

export interface Ctx {
  client: HttpClient;
  opts: RefsOptions;
  /** What `lookup` reached so far (for `RefsOptions.onSearch`). */
  outcome?: SearchOutcome;
  /** Epoch ms after which title searches stop asking further sources. */
  deadline?: number;
}

export interface SourceFailure {
  source: RefSource;
  reason: string;
}

export interface SearchOutcome {
  /** Sources that answered (with or without candidates). */
  searched: RefSource[];
  failures: SourceFailure[];
}

export interface TitleSearch {
  /** As written: TeX for bib titles, plain text for user queries. */
  title: string;
  isTex: boolean;
  firstAuthor?: string;
  year?: number;
  /** A user-supplied author hint narrows results, so it must be part of the cache key. */
  hinted?: boolean;
}

/** Records per source, with the time each source's answer was stored. */
type TitleCacheValue = Partial<Record<RefSource, WorkRecord[]>> & {
  cachedAt?: Partial<Record<RefSource, number>>;
};

/** True when `opts.sources` (the allow-list) lets this index be queried. */
export function sourceAllowed(opts: RefsOptions, source: RefSource): boolean {
  return !opts.sources || opts.sources.includes(source);
}

export function failureReason(err: unknown): string {
  return err instanceof SourceUnavailableError ? err.message : `unexpected error: ${String(err)}`;
}

/** Resolves a DOI (cached). Throws SourceUnavailableError when doi.org cannot answer. */
export function resolveDoiCached(ctx: Ctx, doi: string): Promise<DoiResolution> {
  return cached(ctx.opts.cache, doiCacheKey(doi), () => resolveDoi(ctx.client, doi), {
    isNegative: (v) => v.kind !== 'found',
    maxAge: cacheMaxAge(ctx.opts.cacheMaxAgeDays),
  });
}

/** arXiv record by id (cached); null when arXiv has no such paper. */
export async function arxivByIdCached(ctx: Ctx, id: string): Promise<WorkRecord | null> {
  const value = await cached(
    ctx.opts.cache,
    arxivCacheKey(id),
    async () => ({ record: await arxivById(ctx.client, id) }),
    { isNegative: (v) => !v.record, maxAge: cacheMaxAge(ctx.opts.cacheMaxAgeDays) },
  );
  return value.record;
}

function titleSources(ctx: Ctx, q: TitleSearch): [RefSource, () => Promise<WorkRecord[]>][] {
  const plain = q.isTex ? texToPlain(q.title) : q.title;
  const { client, opts } = ctx;
  const crossrefQuery = {
    title: plain,
    ...(q.firstAuthor ? { firstAuthor: q.firstAuthor } : {}),
    ...(q.year ? { year: q.year } : {}),
  };
  const list: [RefSource, () => Promise<WorkRecord[]>][] = [
    ['crossref', () => crossrefSearch(client, crossrefQuery, opts.mailto)],
    ['dblp', () => dblpSearch(client, plain)],
    ['arxiv', () => arxivSearch(client, plain)],
  ];
  const key = opts.openalexKey;
  if (key) list.push(['openalex', () => openalexSearch(client, plain, key, opts.mailto)]);
  return list.filter(([source]) => sourceAllowed(opts, source));
}

async function searchOne(
  ctx: Ctx,
  cacheKey: string,
  source: RefSource,
  run: () => Promise<WorkRecord[]>,
): Promise<WorkRecord[]> {
  const cache = ctx.opts.cache;
  const hit = cache ? ((await cache.get(cacheKey)) as TitleCacheValue | undefined) : undefined;
  const cachedRecords = hit?.[source];
  if (
    Array.isArray(cachedRecords) &&
    isFresh(
      hit?.cachedAt?.[source],
      cachedRecords.length === 0,
      cacheMaxAge(ctx.opts.cacheMaxAgeDays),
    )
  ) {
    return cachedRecords;
  }
  const records = await run();
  if (cache) {
    const latest = ((await cache.get(cacheKey)) as TitleCacheValue | undefined) ?? {};
    await cache.set(cacheKey, {
      ...latest,
      [source]: records,
      cachedAt: { ...(latest.cachedAt ?? {}), [source]: Date.now() },
    });
  }
  return records;
}

/**
 * Searches CrossRef, dblp, arXiv (and OpenAlex with a key) in order. `visit`
 * sees each source's candidates and returns true to stop early.
 */
export async function titleSearch(
  ctx: Ctx,
  q: TitleSearch,
  visit: (records: WorkRecord[], source: RefSource) => boolean,
): Promise<SearchOutcome> {
  const outcome: SearchOutcome = { searched: [], failures: [] };
  const cacheKey =
    titleCacheKey(q.title, q.year, q.isTex) +
    (q.hinted && q.firstAuthor ? `|author:${q.firstAuthor.toLowerCase()}` : '');
  for (const [source, run] of titleSources(ctx, q)) {
    if (ctx.deadline !== undefined && Date.now() > ctx.deadline) {
      outcome.failures.push({ source, reason: `${source} not asked: lookup time budget used up` });
      continue;
    }
    let records: WorkRecord[];
    try {
      records = await searchOne(ctx, cacheKey, source, run);
    } catch (err) {
      if (ctx.opts.signal?.aborted) throw err;
      outcome.failures.push({ source, reason: failureReason(err) });
      continue;
    }
    outcome.searched.push(source);
    if (visit(records, source)) return outcome;
  }
  // Keyless fallback: when dblp could not answer (bot wall, 429, 5xx) and no OpenAlex key
  // is configured, ask OpenAlex without a key (it has a free per-IP daily budget).
  if (
    (ctx.deadline === undefined || Date.now() <= ctx.deadline) &&
    !ctx.opts.openalexKey &&
    sourceAllowed(ctx.opts, 'openalex') &&
    outcome.failures.some((f) => f.source === 'dblp')
  ) {
    const plain = q.isTex ? texToPlain(q.title) : q.title;
    try {
      const records = await searchOne(ctx, cacheKey, 'openalex', () =>
        openalexSearch(ctx.client, plain, undefined, ctx.opts.mailto),
      );
      outcome.searched.push('openalex');
      visit(records, 'openalex');
    } catch (err) {
      if (ctx.opts.signal?.aborted) throw err;
      outcome.failures.push({ source: 'openalex', reason: failureReason(err) });
    }
  }
  return outcome;
}
