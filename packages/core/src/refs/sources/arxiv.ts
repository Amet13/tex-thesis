import { parseNames } from '../../bib/names.js';
import { type HttpClient, SourceUnavailableError } from '../http.js';
import { normalizeTitle } from '../normalize.js';
import type { WorkRecord } from '../types.js';

const API = 'https://export.arxiv.org/api/query';
const NEW_ID = /^(\d{4}\.\d{4,5})(v\d+)?$/;
const OLD_ID = /^([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?$/;

/**
 * An arXiv identifier as people write it (`arXiv:2401.12345v2`, `2401.12345`,
 * `hep-th/9901001`, an arxiv.org URL, a 10.48550 DOI). Returns the id without
 * version, or null.
 */
export function parseArxivId(input: string): string | null {
  const s = input
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf)\//i, '')
    .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/)?10\.48550\/arxiv\./i, '')
    .replace(/^arxiv:\s*/i, '')
    .replace(/\.pdf$/i, '');
  const m = NEW_ID.exec(s) ?? OLD_ID.exec(s);
  return m ? (m[1] as string) : null;
}

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function xmlText(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_m, e: string) => XML_ENTITIES[e] as string)
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(xml: string, name: string): string | undefined {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? xmlText(m[1] as string) : undefined;
}

function yearFrom(date: string | undefined): number | undefined {
  const y = Number(date?.slice(0, 4));
  return Number.isInteger(y) && y > 1990 ? y : undefined;
}

/** Parses an arXiv Atom feed with plain string matching (no DOMParser in Node). */
export function parseArxivFeed(xml: string): WorkRecord[] {
  const records: WorkRecord[] = [];
  for (const m of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)) {
    const entry = m[1] as string;
    const idUrl = tag(entry, 'id') ?? '';
    const title = tag(entry, 'title');
    if (!title || idUrl.includes('/api/errors')) continue;
    const arxivId = parseArxivId(idUrl.replace(/^https?:\/\/arxiv\.org\/abs\//, ''));
    const authors = [...entry.matchAll(/<author\b[^>]*>([\s\S]*?)<\/author>/g)]
      .map((a) => parseNames(tag(a[1] as string, 'name') ?? '')[0])
      .filter((n) => n !== undefined)
      .map((n) => (n.given ? { given: n.given, family: n.family } : { family: n.family }));
    const years = [yearFrom(tag(entry, 'published')), yearFrom(tag(entry, 'updated'))].filter(
      (y): y is number => y !== undefined,
    );
    const record: WorkRecord = {
      source: 'arxiv',
      title,
      authors,
      years: [...new Set(years)],
      type: 'arxiv',
    };
    if (arxivId) {
      record.arxivId = arxivId;
      record.url = `https://arxiv.org/abs/${arxivId}`;
    }
    const doi = tag(entry, 'arxiv:doi');
    if (doi) record.doi = doi.toLowerCase();
    const journal = tag(entry, 'arxiv:journal_ref');
    if (journal) record.venue = journal;
    records.push(record);
  }
  return records;
}

async function query(client: HttpClient, url: string): Promise<WorkRecord[]> {
  const res = await client.get(url, 'application/atom+xml');
  if (res.status !== 200 || !res.body.includes('<feed')) {
    throw new SourceUnavailableError(
      'export.arxiv.org',
      `export.arxiv.org answered HTTP ${res.status} without an Atom feed`,
    );
  }
  return parseArxivFeed(res.body);
}

function arxivIdUrl(id: string): string {
  return `${API}?id_list=${encodeURIComponent(id)}&max_results=1`;
}

function arxivTitleUrl(title: string): string {
  const phrase = normalizeTitle(title, false);
  const params = new URLSearchParams({ search_query: `ti:"${phrase}"`, max_results: '5' });
  return `${API}?${params}`;
}

/** The record for an arXiv id, or null when arXiv has no such paper. */
export async function arxivById(client: HttpClient, id: string): Promise<WorkRecord | null> {
  const [record] = await query(client, arxivIdUrl(id));
  return record ?? null;
}

/** arXiv title phrase search; up to 5 candidates. `title` is plain text. */
export async function arxivSearch(client: HttpClient, title: string): Promise<WorkRecord[]> {
  return query(client, arxivTitleUrl(title));
}
