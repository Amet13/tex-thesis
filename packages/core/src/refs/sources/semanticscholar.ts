/**
 * Semantic Scholar Academic Graph API: title search (`/paper/search`).
 *
 * Documentation: https://api.semanticscholar.org/api-docs/graph (OpenAPI document read at
 *   https://api.semanticscholar.org/graph/v1/swagger.json) and
 *   https://www.semanticscholar.org/product/api (rate limits), both read 2026-11-10.
 * Key: optional. Without one the API answers, but "rate-limited to 1000 requests per second
 *   shared among all unauthenticated users", so a request can get HTTP 429 at busy times (seen
 *   while recording the fixtures); a key (`x-api-key` header, free on request) has an
 *   introductory limit of 1 request per second. `RefsOptions.semanticScholarKey` sets it.
 * CORS: a 200 answer carries `access-control-allow-origin: *`; a 429 does not. Overfull's
 *   browser check does not ask it anyway (it passes an allow-list without this source).
 * Used only as a fallback title search (see search.ts): identifier lookups go to doi.org,
 *   arXiv, ACL Anthology and Europe PMC. Semantic Scholar's PMID lookup was seen returning
 *   another paper than the one with that PMID, so ids are not looked up here.
 */

import { parseNames } from '../../bib/names.js';
import { getJson, type HttpClient } from '../http.js';
import type { WorkRecord } from '../types.js';

const FIELDS = 'title,authors,year,venue,externalIds,publicationTypes,journal,citationCount';

interface S2Paper {
  paperId?: string;
  title?: string;
  year?: number | null;
  venue?: string;
  citationCount?: number;
  authors?: { name?: string }[];
  externalIds?: { DOI?: string; ArXiv?: string } | null;
  publicationTypes?: string[] | null;
  journal?: { name?: string } | null;
}

export function semanticScholarSearchUrl(title: string): string {
  const params = new URLSearchParams({ query: title, limit: '5', fields: FIELDS });
  return `https://api.semanticscholar.org/graph/v1/paper/search?${params}`;
}

const TYPES: Record<string, string> = {
  JournalArticle: 'journal-article',
  Conference: 'proceedings-article',
  Book: 'book',
  BookSection: 'book-chapter',
};

export function fromSemanticScholar(p: S2Paper): WorkRecord | null {
  const title = p.title?.trim();
  if (!title) return null;
  const authors = (p.authors ?? [])
    .map((a) => parseNames(a.name ?? '')[0])
    .filter((n) => n !== undefined)
    .map((n) => (n.given ? { given: n.given, family: n.family } : { family: n.family }));
  const record: WorkRecord = {
    source: 'semanticscholar',
    title,
    authors,
    years: typeof p.year === 'number' ? [p.year] : [],
  };
  const arxivId = p.externalIds?.ArXiv;
  const venue = (p.venue || p.journal?.name || '').trim();
  // A "journal article" whose venue is arXiv is a preprint, not a publication.
  const isPreprint = /^(arxiv|corr)\b/i.test(venue);
  if (venue && !isPreprint) record.venue = venue;
  const doi = p.externalIds?.DOI;
  if (doi) record.doi = doi.toLowerCase();
  if (arxivId) record.arxivId = arxivId.replace(/v\d+$/, '');
  if (p.paperId) record.url = `https://www.semanticscholar.org/paper/${p.paperId}`;
  const kind = (p.publicationTypes ?? []).map((t) => TYPES[t]).find((t) => t !== undefined);
  if (isPreprint && arxivId) record.type = 'preprint';
  else if (kind) record.type = kind;
  if (typeof p.citationCount === 'number') record.citations = p.citationCount;
  return record;
}

/** Semantic Scholar title search; up to 5 candidates. */
export async function semanticScholarSearch(
  client: HttpClient,
  title: string,
  apiKey?: string,
): Promise<WorkRecord[]> {
  const { data } = await getJson<{ data?: S2Paper[] }>(
    client,
    semanticScholarSearchUrl(title),
    'application/json',
    apiKey ? { 'x-api-key': apiKey } : undefined,
  );
  return (data?.data ?? []).map(fromSemanticScholar).filter((r): r is WorkRecord => r !== null);
}
