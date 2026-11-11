import { normalizeTitle } from './normalize.js';
import type { RefCache } from './types.js';

export function doiCacheKey(doi: string): string {
  return `doi:${doi.toLowerCase()}`;
}

export function arxivCacheKey(id: string): string {
  return `arxiv:${id.replace(/v\d+$/, '')}`;
}

/** `title:<normalized title>|<year>`; `isTex` when the title comes from a .bib file. */
export function titleCacheKey(title: string, year?: number, isTex = true): string {
  return `title:${normalizeTitle(title, isTex)}|${year ?? ''}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Default lifetimes: a record stays valid 30 days; a "does not exist" answer only 1 day,
 * because new DOIs and new indexing appear quickly. Transport errors are never cached.
 */
const DEFAULT_CACHE_MAX_AGE_DAYS = { negative: 1, positive: 30 } as const;

export interface CacheMaxAge {
  /** Days a negative answer (DOI missing, no arXiv paper, empty search) stays valid. */
  negative: number;
  /** Days a positive answer (a record) stays valid. */
  positive: number;
}

/** Resolves `RefsOptions.cacheMaxAgeDays` (a number sets both lifetimes). */
export function cacheMaxAge(option: number | Partial<CacheMaxAge> | undefined): CacheMaxAge {
  if (typeof option === 'number') return { negative: option, positive: option };
  return { ...DEFAULT_CACHE_MAX_AGE_DAYS, ...(option ?? {}) };
}

/**
 * True when a value stored at `cachedAt` (ms since epoch) is still valid. Entries
 * written before timestamps existed have no `cachedAt`: a positive one is kept, a
 * negative one is re-fetched (its age is unknown).
 */
export function isFresh(
  cachedAt: number | undefined,
  negative: boolean,
  maxAge: CacheMaxAge,
  now = Date.now(),
): boolean {
  if (typeof cachedAt !== 'number' || !Number.isFinite(cachedAt)) return !negative;
  const days = negative ? maxAge.negative : maxAge.positive;
  return now - cachedAt <= days * DAY_MS;
}

export interface CachedOptions<T> {
  /** True for "does not exist" answers, which expire sooner. */
  isNegative: (value: T) => boolean;
  maxAge: CacheMaxAge;
  /** Ignore stored answers (`--refresh`); the fresh answer is still stored. */
  refresh?: boolean;
}

/**
 * Reads a cached value, or computes and stores it. Errors are never cached. Object
 * values are stored with a `cachedAt` timestamp; stale entries are re-fetched.
 */
export async function cached<T extends object>(
  cache: RefCache | undefined,
  key: string,
  compute: () => Promise<T>,
  opts: CachedOptions<T>,
): Promise<T> {
  if (cache && !opts.refresh) {
    const hit = (await cache.get(key)) as (T & { cachedAt?: number }) | null | undefined;
    if (hit !== undefined && hit !== null && typeof hit === 'object') {
      const { cachedAt, ...value } = hit;
      if (isFresh(cachedAt, opts.isNegative(value as T), opts.maxAge)) return value as T;
    }
  }
  const value = await compute();
  if (cache) await cache.set(key, { ...value, cachedAt: Date.now() });
  return value;
}
