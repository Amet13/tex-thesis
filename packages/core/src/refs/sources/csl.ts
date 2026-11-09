import type { RefSource, WorkRecord } from '../types.js';

/** CrossRef works JSON and CSL-JSON (from doi.org content negotiation) share these fields. */
export interface CslLike {
  DOI?: string;
  URL?: string;
  type?: string;
  title?: string | string[];
  subtitle?: string | string[];
  author?: { given?: string; family?: string; name?: string; literal?: string }[];
  issued?: CslDate;
  'published-print'?: CslDate;
  'published-online'?: CslDate;
  published?: CslDate;
  'container-title'?: string | string[];
  'is-referenced-by-count'?: number;
}

interface CslDate {
  'date-parts'?: (number | string | null)[][];
}

function first(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() || undefined;
}

function yearOf(d: CslDate | undefined): number | undefined {
  const y = Number(d?.['date-parts']?.[0]?.[0]);
  return Number.isInteger(y) && y > 0 ? y : undefined;
}

/** Normalizes a CrossRef/CSL record. The subtitle is appended as `Title: Subtitle`. */
export function fromCsl(item: CslLike, source: RefSource): WorkRecord | null {
  const main = first(item.title);
  if (!main) return null;
  const sub = first(item.subtitle);
  const title = sub && !main.toLowerCase().includes(sub.toLowerCase()) ? `${main}: ${sub}` : main;
  const years = [item.issued, item['published-print'], item['published-online'], item.published]
    .map(yearOf)
    .filter((y): y is number => y !== undefined);
  const authors = (item.author ?? [])
    .map((a) => ({
      family: (a.family ?? a.name ?? a.literal ?? '').trim(),
      ...(a.given ? { given: a.given.trim() } : {}),
    }))
    .filter((a) => a.family);
  const record: WorkRecord = { source, title, authors, years: [...new Set(years)] };
  const venue = first(item['container-title']);
  if (venue) record.venue = venue;
  if (item.DOI) record.doi = item.DOI.toLowerCase();
  if (item.URL) record.url = item.URL;
  if (item.type) record.type = item.type;
  if (typeof item['is-referenced-by-count'] === 'number') {
    record.citations = item['is-referenced-by-count'];
  }
  return record;
}
