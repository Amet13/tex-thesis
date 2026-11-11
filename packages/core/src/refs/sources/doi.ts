import { type HttpClient, SourceUnavailableError } from '../http.js';
import type { WorkRecord } from '../types.js';
import { type CslLike, fromCsl } from './csl.js';

const CSL = 'application/vnd.citationstyles.csl+json';
const BIBTEX = 'application/x-bibtex';

/** A DOI as typed by people: bare, `doi:`, or a doi.org URL. Returns the lowercase DOI or null. */
export function parseDoi(input: string): string | null {
  const m = /^\s*(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?(10\.\d{4,9}\/\S+?)\s*$/i.exec(input);
  if (!m) return null;
  let doi = m[1] as string;
  try {
    doi = decodeURIComponent(doi);
  } catch {
    // keep as written
  }
  return trimTrailingPunctuation(doi).toLowerCase();
}

/**
 * Drops sentence punctuation pasted after a DOI (`10.1/x.`, `10.1/x,;`). A loop from the
 * end, not `/[.,;]+$/`: that pattern backtracks quadratically on a long run of commas
 * that is not at the end of the input.
 */
function trimTrailingPunctuation(s: string): string {
  let end = s.length;
  while (end > 0 && '.,;'.includes(s[end - 1] as string)) end--;
  return s.slice(0, end);
}

function doiUrl(doi: string): string {
  return `https://doi.org/${encodeURIComponent(doi).replace(/%2F/gi, '/')}`;
}

export type DoiResolution =
  | { kind: 'found'; record: WorkRecord }
  /** doi.org says the DOI does not exist. */
  | { kind: 'missing' }
  /** The DOI exists but its registration agency gives no machine-readable metadata. */
  | { kind: 'no-metadata' };

/** Resolves a DOI through doi.org content negotiation (CSL JSON). */
export async function resolveDoi(client: HttpClient, doi: string): Promise<DoiResolution> {
  const res = await client.get(doiUrl(doi), CSL);
  if (res.status === 404 || res.status === 410) return { kind: 'missing' };
  if (res.status === 406 || res.status === 204) return { kind: 'no-metadata' };
  if (res.status < 200 || res.status >= 300) {
    throw new SourceUnavailableError('doi.org', `doi.org answered HTTP ${res.status}`);
  }
  let item: CslLike;
  try {
    item = JSON.parse(res.body) as CslLike;
  } catch {
    return { kind: 'no-metadata' };
  }
  const record = fromCsl(item, 'doi.org');
  if (!record) return { kind: 'no-metadata' };
  if (!record.doi) record.doi = doi;
  return { kind: 'found', record };
}

/** BibTeX for a DOI from doi.org, or null when unavailable. */
export async function fetchDoiBibtex(client: HttpClient, doi: string): Promise<string | null> {
  try {
    const res = await client.get(doiUrl(doi), BIBTEX);
    if (res.status !== 200 || !/^\s*@/.test(res.body)) return null;
    return res.body;
  } catch (err) {
    if (err instanceof SourceUnavailableError) return null;
    throw err;
  }
}
