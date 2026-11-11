import { parseNames } from '../../bib/names.js';
import { getJson, type HttpClient } from '../http.js';
import type { WorkRecord } from '../types.js';

interface DblpAuthor {
  text?: string;
}

interface DblpInfo {
  title?: string;
  authors?: { author?: DblpAuthor | DblpAuthor[] };
  venue?: string | string[];
  year?: string;
  type?: string;
  doi?: string;
  ee?: string | string[];
  url?: string;
}

interface DblpResponse {
  result?: { hits?: { hit?: { info?: DblpInfo }[] } };
}

function dblpSearchUrl(title: string): string {
  const params = new URLSearchParams({ q: title, format: 'json', h: '5' });
  return `https://dblp.org/search/publ/api?${params}`;
}

/** "Jane Doe 0002" → { given: Jane, family: Doe } (dblp's homonym suffix dropped). */
function dblpPerson(text: string): { given?: string; family: string } {
  const clean = text.replace(/\s+\d{4}$/, '');
  const [name] = parseNames(clean);
  if (!name) return { family: clean };
  return name.given ? { given: name.given, family: name.family } : { family: name.family };
}

function fromDblp(info: DblpInfo): WorkRecord | null {
  if (!info.title) return null;
  const authorField = info.authors?.author;
  const authors = (Array.isArray(authorField) ? authorField : authorField ? [authorField] : [])
    .map((a) => dblpPerson(a.text ?? ''))
    .filter((a) => a.family);
  const year = Number(info.year);
  const record: WorkRecord = {
    source: 'dblp',
    title: info.title.replace(/\.$/, ''),
    authors,
    years: Number.isInteger(year) ? [year] : [],
  };
  const venue = Array.isArray(info.venue) ? info.venue[0] : info.venue;
  if (venue) record.venue = venue;
  if (info.doi) record.doi = info.doi.toLowerCase();
  const ee = Array.isArray(info.ee) ? info.ee[0] : info.ee;
  if (ee ?? info.url) record.url = (ee ?? info.url) as string;
  if (info.type) record.type = info.type;
  return record;
}

/** dblp publication search; up to 5 candidates. */
export async function dblpSearch(client: HttpClient, title: string): Promise<WorkRecord[]> {
  const { data } = await getJson<DblpResponse>(client, dblpSearchUrl(title));
  return (data?.result?.hits?.hit ?? [])
    .map((h) => (h.info ? fromDblp(h.info) : null))
    .filter((r): r is WorkRecord => r !== null);
}
