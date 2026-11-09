import { parseNames } from '../../bib/names.js';
import { getJson, type HttpClient } from '../http.js';
import type { WorkRecord } from '../types.js';

interface OpenAlexWork {
  display_name?: string;
  title?: string;
  publication_year?: number;
  doi?: string;
  type?: string;
  cited_by_count?: number;
  authorships?: { author?: { display_name?: string } }[];
  primary_location?: { source?: { display_name?: string } | null; landing_page_url?: string };
}

export function openalexSearchUrl(title: string, apiKey?: string, mailto?: string): string {
  const params = new URLSearchParams({ search: title, 'per-page': '5' });
  if (apiKey) params.set('api_key', apiKey);
  if (mailto) params.set('mailto', mailto);
  return `https://api.openalex.org/works?${params}`;
}

function fromOpenAlex(w: OpenAlexWork): WorkRecord | null {
  const title = w.display_name ?? w.title;
  if (!title) return null;
  const authors = (w.authorships ?? [])
    .map((a) => parseNames(a.author?.display_name ?? '')[0])
    .filter((n) => n !== undefined)
    .map((n) => (n.given ? { given: n.given, family: n.family } : { family: n.family }));
  const record: WorkRecord = {
    source: 'openalex',
    title,
    authors,
    years: w.publication_year ? [w.publication_year] : [],
  };
  const venue = w.primary_location?.source?.display_name;
  if (venue) record.venue = venue;
  if (w.doi) record.doi = w.doi.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase();
  const url = w.primary_location?.landing_page_url;
  if (url) record.url = url;
  if (w.type) record.type = w.type;
  if (typeof w.cited_by_count === 'number') record.citations = w.cited_by_count;
  return record;
}

/**
 * OpenAlex search; up to 5 candidates. Without an API key OpenAlex serves a small
 * per-IP daily budget; a 429 once it is used up is a lookup failure.
 */
export async function openalexSearch(
  client: HttpClient,
  title: string,
  apiKey: string | undefined,
  mailto?: string,
): Promise<WorkRecord[]> {
  const { data } = await getJson<{ results?: OpenAlexWork[] }>(
    client,
    openalexSearchUrl(title, apiKey, mailto),
  );
  return (data?.results ?? []).map(fromOpenAlex).filter((r): r is WorkRecord => r !== null);
}
