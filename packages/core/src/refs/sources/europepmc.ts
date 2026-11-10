/**
 * Europe PMC REST API: PMID and PMCID lookups, and a title search.
 *
 * Endpoint: https://www.ebi.ac.uk/europepmc/webservices/rest/search (JSON, `resultType=core`).
 * Documentation: the REST reference at https://europepmc.org/RestfulWebService returned HTTP
 *   403 to scripted requests on 2026-11-10, so the query syntax (`EXT_ID:<id> AND SRC:MED`,
 *   `PMCID:<id>`, `TITLE:"<phrase>"`) was confirmed with live requests, and the limit from the
 *   Europe PMC team's answer in the official developer forum, dated 2024-10-01:
 *   https://groups.google.com/a/ebi.ac.uk/g/epmc-webservices/c/x3PLL09mels (read 2026-11-10).
 * Key: none. Rate limit: 10 requests per second (500 per minute), per that forum answer.
 * CORS: answers carry `access-control-allow-origin: *`, so a browser can read it.
 */

import { getJson, type HttpClient } from '../http.js';
import type { WorkRecord } from '../types.js';

interface EpmcResult {
  id?: string;
  source?: string;
  pmid?: string;
  pmcid?: string;
  doi?: string;
  title?: string;
  authorString?: string;
  authorList?: {
    author?: {
      fullName?: string;
      firstName?: string;
      lastName?: string;
      collectiveName?: string;
    }[];
  };
  journalInfo?: {
    yearOfPublication?: number;
    journal?: { title?: string; medlineAbbreviation?: string };
  };
  pubYear?: string;
  firstPublicationDate?: string;
  bookOrReportDetails?: { publisher?: string; yearOfPublication?: number };
}

interface EpmcResponse {
  resultList?: { result?: EpmcResult[] };
}

const PMID_PREFIX = /^\s*PMID[\s:]+(\d{1,9})\s*$/i;
const PMID_URL =
  /^(?:https?:\/\/)?(?:www\.)?(?:pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov\/pubmed)\/(\d{1,9})\/?$/i;
const PMCID_BARE = /^(PMC\d{1,9})\/?$/i;
const PMCID_URL =
  /^(?:https?:\/\/)?(?:(?:www\.)?ncbi\.nlm\.nih\.gov\/pmc\/articles|pmc\.ncbi\.nlm\.nih\.gov\/articles|europepmc\.org\/(?:article\/PMC|articles))\/(PMC\d{1,9})\/?$/i;

/** Ids and URLs are short; a longer value is not one and is never scanned. */
const MAX_ID_INPUT = 512;

/** A PubMed id: `PMID:19872477`, `pmid 19872477` or a pubmed.ncbi.nlm.nih.gov URL. */
export function parsePmid(input: string): string | null {
  if (input.length > MAX_ID_INPUT) return null;
  const s = input.trim();
  const m = PMID_PREFIX.exec(s) ?? PMID_URL.exec(s);
  return m ? (m[1] as string) : null;
}

/** A PubMed Central id: `PMC2323736`, or a PMC / Europe PMC article URL. */
export function parsePmcid(input: string): string | null {
  if (input.length > MAX_ID_INPUT) return null;
  const s = input.trim();
  const m = PMCID_BARE.exec(s) ?? PMCID_URL.exec(s);
  return m ? (m[1] as string).toUpperCase() : null;
}

function searchUrl(query: string): string {
  const params = new URLSearchParams({
    query,
    format: 'json',
    resultType: 'core',
    pageSize: '5',
  });
  return `https://www.ebi.ac.uk/europepmc/webservices/rest/search?${params}`;
}

export const europepmcPmidUrl = (pmid: string) => searchUrl(`EXT_ID:${pmid} AND SRC:MED`);
export const europepmcPmcidUrl = (pmcid: string) => searchUrl(`PMCID:${pmcid}`);

/** Words only: Europe PMC's query syntax treats quotes, brackets and colons specially. */
export function europepmcTitleUrl(title: string): string {
  const words = title.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return searchUrl(`TITLE:"${words}"`);
}

function authorsOf(r: EpmcResult): WorkRecord['authors'] {
  const list = r.authorList?.author ?? [];
  const named = list
    .map((a) => {
      if (a.lastName) return { family: a.lastName, ...(a.firstName ? { given: a.firstName } : {}) };
      return { family: (a.collectiveName ?? a.fullName ?? '').trim() };
    })
    .filter((a) => a.family);
  if (named.length) return named;
  // No author list: "Hitchcock DI." / "Sholts SB, Esteban J." (family name, then initials).
  return (r.authorString ?? '')
    .replace(/\.$/, '')
    .split(',')
    .map((part) => {
      const s = part.trim();
      const at = s.lastIndexOf(' ');
      // "Sholts SB": drop the trailing initials.
      return at > 0 && /^[A-Z]{1,4}$/.test(s.slice(at + 1)) ? s.slice(0, at).trim() : s;
    })
    .filter(Boolean)
    .map((family) => ({ family }));
}

export function fromEuropePmc(r: EpmcResult): WorkRecord | null {
  const trimmed = r.title?.trim();
  const title = trimmed?.endsWith('.') ? trimmed.slice(0, -1).trimEnd() : trimmed;
  if (!title) return null;
  const years = [
    Number(r.pubYear),
    r.journalInfo?.yearOfPublication,
    Number(r.firstPublicationDate?.slice(0, 4)),
    r.bookOrReportDetails?.yearOfPublication,
  ].filter((y): y is number => typeof y === 'number' && Number.isInteger(y) && y > 0);
  const record: WorkRecord = {
    source: 'europepmc',
    title,
    authors: authorsOf(r),
    years: [...new Set(years)],
  };
  const venue = r.journalInfo?.journal?.title ?? r.journalInfo?.journal?.medlineAbbreviation;
  if (venue) record.venue = venue;
  if (r.doi) record.doi = r.doi.toLowerCase();
  if (r.source && r.id) record.url = `https://europepmc.org/article/${r.source}/${r.id}`;
  if (r.source === 'PPR') record.type = 'preprint';
  else if (r.journalInfo) record.type = 'journal-article';
  else if (r.bookOrReportDetails) record.type = 'book';
  return record;
}

async function query(client: HttpClient, url: string): Promise<WorkRecord[]> {
  const { data } = await getJson<EpmcResponse>(client, url);
  return (data?.resultList?.result ?? [])
    .map(fromEuropePmc)
    .filter((r): r is WorkRecord => r !== null);
}

/** The record for a PubMed id, or null when Europe PMC has none. */
export async function europepmcByPmid(
  client: HttpClient,
  pmid: string,
): Promise<WorkRecord | null> {
  return (await query(client, europepmcPmidUrl(pmid)))[0] ?? null;
}

/** The record for a PubMed Central id, or null when Europe PMC has none. */
export async function europepmcByPmcid(
  client: HttpClient,
  pmcid: string,
): Promise<WorkRecord | null> {
  return (await query(client, europepmcPmcidUrl(pmcid)))[0] ?? null;
}

/** Europe PMC title phrase search; up to 5 candidates. `title` is plain text. */
export async function europepmcSearch(client: HttpClient, title: string): Promise<WorkRecord[]> {
  return query(client, europepmcTitleUrl(title));
}
