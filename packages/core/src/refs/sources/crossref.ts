import { getJson, type HttpClient } from '../http.js';
import type { WorkRecord } from '../types.js';
import { type CslLike, fromCsl } from './csl.js';

const SELECT = [
  'DOI',
  'URL',
  'type',
  'title',
  'subtitle',
  'author',
  'issued',
  'published-print',
  'published-online',
  'container-title',
  'is-referenced-by-count',
].join(',');

export interface TitleQuery {
  title: string;
  firstAuthor?: string;
  year?: number;
}

function crossrefSearchUrl(q: TitleQuery, mailto?: string): string {
  const text = [q.title, q.firstAuthor, q.year].filter(Boolean).join(' ');
  const params = new URLSearchParams({ 'query.bibliographic': text, rows: '5', select: SELECT });
  if (mailto) params.set('mailto', mailto);
  return `https://api.crossref.org/works?${params}`;
}

/** CrossRef bibliographic search; up to 5 candidates. */
export async function crossrefSearch(
  client: HttpClient,
  q: TitleQuery,
  mailto?: string,
): Promise<WorkRecord[]> {
  const { data } = await getJson<{ message?: { items?: CslLike[] } }>(
    client,
    crossrefSearchUrl(q, mailto),
  );
  return (data?.message?.items ?? [])
    .map((item) => fromCsl(item, 'crossref'))
    .filter((r): r is WorkRecord => r !== null);
}
