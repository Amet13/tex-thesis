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

/** Reads a cached value, or computes and stores it. Errors are never cached. */
export async function cached<T>(
  cache: RefCache | undefined,
  key: string,
  compute: () => Promise<T>,
): Promise<T> {
  if (cache) {
    const hit = await cache.get(key);
    if (hit !== undefined && hit !== null) return hit as T;
  }
  const value = await compute();
  if (cache) await cache.set(key, value);
  return value;
}
