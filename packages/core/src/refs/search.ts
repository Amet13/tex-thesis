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
import { aclById } from './sources/acl.js';
import { arxivById, arxivSearch } from './sources/arxiv.js';
import { crossrefSearch } from './sources/crossref.js';
import { dblpSearch } from './sources/dblp.js';
import { type DoiResolution, resolveDoi } from './sources/doi.js';
import { europepmcByPmcid, europepmcByPmid, europepmcSearch } from './sources/europepmc.js';
import { openalexSearch } from './sources/openalex.js';
import { semanticScholarSearch } from './sources/semanticscholar.js';
import type { RefCache, RefSource, RefsOptions, WorkRecord } from './types.js';

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
    refresh: ctx.opts.refresh === true,
  });
}

/** arXiv record by id (cached); null when arXiv has no such paper. */
export async function arxivByIdCached(ctx: Ctx, id: string): Promise<WorkRecord | null> {
  const value = await cached(
    ctx.opts.cache,
    arxivCacheKey(id),
    async () => ({ record: await arxivById(ctx.client, id) }),
    {
      isNegative: (v) => !v.record,
      maxAge: cacheMaxAge(ctx.opts.cacheMaxAgeDays),
      refresh: ctx.opts.refresh === true,
    },
  );
  return value.record;
}

/** Most sources that answer a title search for one entry before the fallbacks stop. */
export const MAX_TITLE_ANSWERS = 3;

/** An ACL Anthology paper by id (cached); null when the Anthology has no such paper. */
export async function aclByIdCached(ctx: Ctx, id: string): Promise<WorkRecord | null> {
  const value = await cached(
    ctx.opts.cache,
    `acl:${id}`,
    async () => ({ record: await aclById(ctx.client, id) }),
    {
      isNegative: (v) => !v.record,
      maxAge: cacheMaxAge(ctx.opts.cacheMaxAgeDays),
      refresh: ctx.opts.refresh === true,
    },
  );
  return value.record;
}

/** A Europe PMC record by PubMed id or PubMed Central id (cached); null when it has none. */
export async function europepmcByIdCached(
  ctx: Ctx,
  id: { pmid: string } | { pmcid: string },
): Promise<WorkRecord | null> {
  const key = 'pmid' in id ? `pmid:${id.pmid}` : `pmcid:${id.pmcid}`;
  const value = await cached(
    ctx.opts.cache,
    key,
    async () => ({
      record:
        'pmid' in id
          ? await europepmcByPmid(ctx.client, id.pmid)
          : await europepmcByPmcid(ctx.client, id.pmcid),
    }),
    {
      isNegative: (v) => !v.record,
      maxAge: cacheMaxAge(ctx.opts.cacheMaxAgeDays),
      refresh: ctx.opts.refresh === true,
    },
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

const writes = new WeakMap<RefCache, Promise<void>>();

async function searchOne(
  ctx: Ctx,
  cacheKey: string,
  source: RefSource,
  run: () => Promise<WorkRecord[]>,
): Promise<WorkRecord[]> {
  const cache = ctx.opts.cache;
  const hit =
    cache && !ctx.opts.refresh
      ? ((await cache.get(cacheKey)) as TitleCacheValue | undefined)
      : undefined;
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
    // Sources of one entry run concurrently and share one cache value: serialize the
    // read-modify-write so one answer does not overwrite another.
    const write = (writes.get(cache) ?? Promise.resolve()).then(async () => {
      const latest = ((await cache.get(cacheKey)) as TitleCacheValue | undefined) ?? {};
      await cache.set(cacheKey, {
        ...latest,
        [source]: records,
        cachedAt: { ...(latest.cachedAt ?? {}), [source]: Date.now() },
      });
    });
    writes.set(
      cache,
      write.catch(() => {}),
    );
    await write;
  }
  return records;
}

/**
 * Searches CrossRef, dblp, arXiv (and OpenAlex with a key), concurrently within each
 * wave. `visit` sees each source's candidates in source order and returns true to stop early.
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
  // Independent indexes are asked at the same time, in two waves: CrossRef and dblp first,
  // then (only when neither verified) the rest. arXiv has a strict request spacing, so it
  // is not queried for entries the first wave already settled. Answers are visited in the
  // usual source order, and a `visit` that returns true stops the search.
  const sources = titleSources(ctx, q);
  const first = sources.filter(([s]) => s === 'crossref' || s === 'dblp');
  const waves = [first, sources.filter((entry) => !first.includes(entry))];
  for (const wave of waves) {
    const pending = wave.map(([source, run]) => {
      if (ctx.deadline !== undefined && Date.now() > ctx.deadline) {
        const reason = `${source} not asked: lookup time budget used up`;
        return Promise.resolve({ source, reason } as { source: RefSource; reason: string });
      }
      return searchOne(ctx, cacheKey, source, run).then(
        (records) => ({ source, records }),
        (err: unknown) => ({ source, err }),
      );
    });
    for (const p of pending) {
      const got = await p;
      if ('records' in got) {
        outcome.searched.push(got.source);
        if (visit(got.records, got.source)) return outcome;
      } else if ('reason' in got) {
        outcome.failures.push({ source: got.source, reason: got.reason });
      } else {
        if (ctx.opts.signal?.aborted) throw got.err;
        outcome.failures.push({ source: got.source, reason: failureReason(got.err) });
      }
    }
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
      if (visit(records, 'openalex')) return outcome;
    } catch (err) {
      if (ctx.opts.signal?.aborted) throw err;
      outcome.failures.push({ source: 'openalex', reason: failureReason(err) });
    }
  }
  // Fallbacks, one at a time and only while fewer than MAX_TITLE_ANSWERS sources have
  // answered (a source that failed does not use up a slot): the indexes that were reachable
  // found nothing, so ask the next. Semantic Scholar first, then Europe PMC.
  const plainTitle = q.isTex ? texToPlain(q.title) : q.title;
  const fallbacks: [RefSource, () => Promise<WorkRecord[]>][] = [
    ['semanticscholar', () => semanticScholarSearch(ctx.client, plainTitle, ctx.opts.semanticScholarKey)],
    ['europepmc', () => europepmcSearch(ctx.client, plainTitle)],
  ];
  for (const [source, run] of fallbacks) {
    if (outcome.searched.length >= MAX_TITLE_ANSWERS) break;
    if (ctx.deadline !== undefined && Date.now() > ctx.deadline) break;
    if (!sourceAllowed(ctx.opts, source)) continue;
    try {
      const records = await searchOne(ctx, cacheKey, source, run);
      outcome.searched.push(source);
      if (visit(records, source)) return outcome;
    } catch (err) {
      if (ctx.opts.signal?.aborted) throw err;
      // These two are extras: when one cannot answer, the lookup is exactly as complete as it
      // was without it, so its failure is not reported as a reason for `error`.
    }
  }
  return outcome;
}
