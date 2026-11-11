/**
 * ACL Anthology: one paper by Anthology id, as BibTeX (`https://aclanthology.org/<id>.bib`).
 *
 * Documentation: https://aclanthology.org/faq/linking/ ("Append .bib to retrieve the BibTeX
 *   file, e.g., https://www.aclanthology.org/2020.iwclul-1.4.bib"), read 2026-11-10; the bulk
 *   data options are at https://aclanthology.org/faq/data/.
 * Key: none. Rate limit: none published; a static site, so the id lookups are one request each.
 * CORS: the .bib answer carries no `access-control-allow-origin`, so a browser cannot read it.
 *   A non-CORS source: Overfull's browser check passes an allow-list without it.
 * Identifier lookup only. There is no title-search endpoint.
 */

import { parseNames } from '../../bib/names.js';
import { parseBib } from '../../bib/parse.js';
import { texToPlain } from '../../bib/tex.js';
import { type HttpClient, SourceUnavailableError } from '../http.js';
import type { WorkRecord } from '../types.js';

/** `2020.acl-main.1`, `2021.findings-emnlp.100`, `2020.iwclul-1.4`. */
const NEW_ID = String.raw`\d{4}\.[a-z0-9]+(?:-[a-z0-9]+)+\.\d+`;
/** `P19-1001`, `W12-3903`, `E91-1001`. */
const OLD_ID = String.raw`[A-Za-z]\d{2}-\d{4}`;
const ID = new RegExp(`^(?:${NEW_ID}|${OLD_ID})$`);
const OLD_ONLY = new RegExp(`^${OLD_ID}$`);

/** Drops a query or fragment, a trailing slash and a `.pdf`/`.bib`/`.xml` suffix (no regex scan). */
function stripSuffixes(value: string): string {
  let s = value;
  for (const mark of ['?', '#']) {
    const at = s.indexOf(mark);
    if (at >= 0) s = s.slice(0, at);
  }
  if (s.endsWith('/')) s = s.slice(0, -1);
  for (const ext of ['.pdf', '.bib', '.xml']) {
    if (s.toLowerCase().endsWith(ext)) {
      s = s.slice(0, -ext.length);
      break;
    }
  }
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

/**
 * An ACL Anthology id as people write it: the bare id, `aclanthology.org/<id>` (with
 * `/`, `.pdf` or `.bib`), the old `aclweb.org/anthology/<id>`, or the ACL DOI
 * `10.18653/v1/<id>`. Returns the id, or null.
 */
export function parseAclId(input: string): string | null {
  // Ids and URLs are short; a long value is not one (and is never scanned).
  if (input.length > 512) return null;
  const s = input
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?(?:aclanthology\.org|aclweb\.org\/anthology)\//i, '')
    .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?10\.18653\/v1\//i, '')
    .replace(/^ACL:\s*/i, '');
  const id = stripSuffixes(s);
  if (!ID.test(id)) return null;
  // Old ids are upper case (`P19-1001`); a lower-cased DOI carries them in lower case.
  return OLD_ONLY.test(id) ? id.toUpperCase() : id;
}

function aclBibUrl(id: string): string {
  return `https://aclanthology.org/${id}.bib`;
}

const TYPES: Record<string, string> = {
  inproceedings: 'proceedings-article',
  article: 'journal-article',
  book: 'book',
  incollection: 'book-chapter',
  phdthesis: 'dissertation',
};

/** Normalizes the Anthology's BibTeX for one paper. Null when it holds no titled entry. */
export function parseAclBib(bib: string): WorkRecord | null {
  const entry = parseBib(bib)[0];
  const f = entry?.fields;
  if (!entry || !f?.title) return null;
  const authors = parseNames(f.author)
    .filter((n) => !n.corporate)
    .map((n) => (n.given ? { given: n.given, family: n.family } : { family: n.family }));
  const year = Number(/\b(\d{4})\b/.exec(f.year ?? '')?.[1]);
  const record: WorkRecord = {
    source: 'acl',
    title: texToPlain(f.title).replace(/\s+/g, ' ').trim(),
    authors,
    years: Number.isInteger(year) ? [year] : [],
  };
  const venue = f.booktitle ?? f.journal;
  if (venue) record.venue = texToPlain(venue).replace(/\s+/g, ' ').trim();
  if (f.doi) record.doi = f.doi.toLowerCase();
  if (f.url) record.url = f.url;
  const type = TYPES[entry.type.toLowerCase()];
  if (type) record.type = type;
  return record;
}

/** The record for an Anthology id, or null when the Anthology has no such paper. */
export async function aclById(client: HttpClient, id: string): Promise<WorkRecord | null> {
  const res = await client.get(aclBibUrl(id), 'text/plain');
  if (res.status === 404 || res.status === 410) return null;
  if (res.status !== 200 || !/^\s*@/.test(res.body)) {
    throw new SourceUnavailableError(
      'aclanthology.org',
      `aclanthology.org answered HTTP ${res.status} without BibTeX`,
    );
  }
  return parseAclBib(res.body);
}
