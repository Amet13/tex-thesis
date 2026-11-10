/**
 * Problems that are not lookup outcomes: a retracted work (`reference-retracted`), an arXiv
 * entry with a published version (`reference-published-version`), two entries for one work
 * (`reference-duplicate`, offline) and entries nothing cites (`reference-uncited`, off by
 * default). Each is built from the results and entries `refsCheck` already has.
 */

import type { BibEntry } from '../bib/parse.js';
import type { Location, Problem } from '../types.js';
import { identifiersOf } from './kind.js';
import { bibYear } from './match.js';
import { normalizeTitle } from './normalize.js';
import type { RefResult } from './types.js';

function locationOf(r: RefResult | undefined, entry: BibEntry | undefined): Location | undefined {
  return (
    r?.location ??
    (entry?.line ? { line: entry.line, ...(entry.file ? { file: entry.file } : {}) } : undefined)
  );
}

const ASSERTED_BY: Record<string, string> = {
  'retraction-watch': 'Retraction Watch',
  publisher: 'the publisher',
};

/** `reference-retracted`: CrossRef records the matched work as retracted or withdrawn. */
export function retractedProblems(results: RefResult[], byKey: Map<string, BibEntry>): Problem[] {
  const problems: Problem[] = [];
  for (const r of results) {
    const n = r.retraction;
    if (!n) continue;
    const entry = byKey.get(r.key);
    const location = locationOf(r, entry);
    const word = n.kind === 'withdrawal' ? 'withdrawn' : 'retracted';
    const who = n.assertedBy ? (ASSERTED_BY[n.assertedBy] ?? n.assertedBy) : undefined;
    const notice = n.noticeDoi ? `https://doi.org/${n.noticeDoi}` : undefined;
    problems.push({
      rule: 'reference-retracted',
      check: 'references',
      severity: 'error',
      message: `\`${r.key}\` is recorded as ${word} (DOI ${n.doi})`,
      ...(location ? { location } : {}),
      detail: [
        `CrossRef lists a ${n.kind} for ${n.doi}${n.date ? `, dated ${n.date}` : ''}${who ? `, asserted by ${who}` : ''}.`,
        notice ? `Notice: ${notice}` : undefined,
      ]
        .filter(Boolean)
        .join(' '),
      fix: `Read the notice${notice ? ` (${notice})` : ''}. Do not cite the work as sound evidence: replace it with a work that stands, or cite it only to say it was ${word}, together with the notice.`,
      ...(entry?.raw ? { evidence: entry.raw } : {}),
      data: {
        key: r.key,
        doi: n.doi,
        kind: n.kind,
        ...(n.noticeDoi ? { noticeDoi: n.noticeDoi } : {}),
        ...(n.date ? { date: n.date } : {}),
        ...(n.assertedBy ? { assertedBy: n.assertedBy } : {}),
      },
    });
  }
  return problems;
}

/** `reference-published-version`: the entry's arXiv record names a published DOI. */
export function publishedVersionProblems(
  results: RefResult[],
  byKey: Map<string, BibEntry>,
): Problem[] {
  const problems: Problem[] = [];
  for (const r of results) {
    const entry = byKey.get(r.key);
    const doi = r.matched?.doi;
    if (r.source !== 'arxiv' || !entry || !doi || doi.startsWith('10.48550/')) continue;
    if (r.status !== 'verified' && r.status !== 'mismatch') continue;
    // An entry that already carries a DOI points at a published version itself.
    if (identifiersOf(entry).doi || entry.fields.doi) continue;
    const location = locationOf(r, entry);
    problems.push({
      rule: 'reference-published-version',
      check: 'references',
      severity: 'info',
      message: `\`${r.key}\` is an arXiv preprint whose arXiv record names a published version (DOI ${doi})`,
      ...(location ? { location } : {}),
      detail:
        'The arXiv record of this paper gives a DOI for the published article. If you read the published version, cite that; if you read the preprint, keep this entry.',
      fix: `Run \`overfull cite ${doi}\`, use the key it prints in \`\\cite{}\`, and remove this entry if nothing else cites it.`,
      ...(entry.raw ? { evidence: entry.raw } : {}),
      data: { key: r.key, doi, ...(r.matched?.title ? { title: r.matched.title } : {}) },
    });
  }
  return problems;
}

interface DuplicateKey {
  kind: 'doi' | 'arxiv' | 'title';
  value: string;
}

function duplicateKeys(entry: BibEntry): DuplicateKey[] {
  const ids = identifiersOf(entry);
  const keys: DuplicateKey[] = [];
  if (ids.doi) keys.push({ kind: 'doi', value: ids.doi.toLowerCase() });
  if (ids.arxivId) keys.push({ kind: 'arxiv', value: ids.arxivId.toLowerCase() });
  const year = bibYear(entry);
  const title = normalizeTitle(entry.fields.title ?? '', true);
  // A very short title ("Introduction") says nothing about which work is meant.
  if (year !== undefined && title.length >= 12)
    keys.push({ kind: 'title', value: `${title}|${year}` });
  return keys;
}

const WHAT: Record<DuplicateKey['kind'], string> = {
  doi: 'the same DOI',
  arxiv: 'the same arXiv id',
  title: 'the same title and year',
};

/**
 * `reference-duplicate`: two entries for one work (same DOI, same arXiv id, or same
 * normalized title and year). Offline. Reported once per later entry, naming the first.
 */
export function duplicateProblems(entries: BibEntry[]): Problem[] {
  const first = new Map<string, BibEntry>();
  const problems: Problem[] = [];
  for (const entry of entries) {
    let reported = false;
    for (const k of duplicateKeys(entry)) {
      const id = `${k.kind}:${k.value}`;
      const earlier = first.get(id);
      if (!earlier) {
        first.set(id, entry);
        continue;
      }
      if (reported || earlier === entry) continue;
      reported = true;
      const location = locationOf(undefined, entry);
      problems.push({
        rule: 'reference-duplicate',
        check: 'references',
        severity: 'warning',
        message: `\`${entry.key}\` and \`${earlier.key}\` are the same work (${WHAT[k.kind]})`,
        ...(location ? { location } : {}),
        detail: `Both entries have ${WHAT[k.kind]}${k.kind === 'title' ? '' : `: ${k.value}`}. \`${earlier.key}\` comes first${earlier.line ? ` (line ${earlier.line}${earlier.file ? ` of ${earlier.file}` : ''})` : ''}.`,
        fix: `Keep one entry, use its key in every \`\\cite{}\`, and delete the other. If they are two different works (for example two editions), give them different titles or years.`,
        ...(entry.raw ? { evidence: entry.raw } : {}),
        data: { key: entry.key, duplicateOf: earlier.key, by: k.kind },
      });
    }
  }
  return problems;
}

/** `reference-uncited`: entries whose key no `\cite` uses. Only when `cited` is known. */
export function uncitedProblems(entries: BibEntry[], cited: string[]): Problem[] {
  const used = new Set(cited);
  return entries
    .filter((e) => !used.has(e.key))
    .map((entry) => {
      const location = locationOf(undefined, entry);
      return {
        rule: 'reference-uncited',
        check: 'references' as const,
        severity: 'info' as const,
        message: `\`${entry.key}\` is in the bibliography but no \`\\cite\` uses it`,
        ...(location ? { location } : {}),
        fix: 'Cite it where it belongs, or remove the entry if you do not need it.',
        data: { key: entry.key },
      };
    });
}
