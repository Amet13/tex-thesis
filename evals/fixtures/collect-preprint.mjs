#!/usr/bin/env node
// Finds one arXiv paper whose arXiv record names a published DOI, and writes both forms of the
// reference with Overfull's own lookup, to evals/fixtures/preprint.bib. Used by the task
// switch-to-published-version. Nothing is written from memory: the pair comes from arXiv's listing API.
//
//   node evals/fixtures/collect-preprint.mjs [--category cs.CL] [--start 2500]
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { formatBibEntry, lookup } from '../../bench/refs/lib/core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    category: { type: 'string', default: 'cs.CL' },
    start: { type: 'string', default: '2500' },
  },
});
const res = await fetch(
  `https://export.arxiv.org/api/query?search_query=cat:${values.category}&start=${values.start}&max_results=100&sortBy=submittedDate&sortOrder=descending`,
);
const xml = await res.text();
const pairs = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
  .map((m) => ({
    id: /<id>https?:\/\/arxiv\.org\/abs\/([^<]+?)(?:v\d+)?<\/id>/.exec(m[1])?.[1],
    doi: /<arxiv:doi[^>]*>([^<]+)<\/arxiv:doi>/.exec(m[1])?.[1],
  }))
  .filter((p) => p.id && p.doi && !/arxiv/i.test(p.doi));
console.error(`${pairs.length} papers with a published DOI in this page`);
for (const p of pairs) {
  const pre = await lookup(`arXiv:${p.id}`, { arxivIntervalMs: 3000 }).catch(() => null);
  const pub = await lookup(p.doi, {}).catch(() => null);
  if (!pre || !pub || pub.entry.fields.doi?.toLowerCase() !== p.doi.toLowerCase()) continue;
  const clean = (e, key, note) => ({ ...e, key, fields: { ...e.fields, 'x-fixture': note } });
  const today = new Date().toISOString().slice(0, 10);
  const text = `% Both forms of one reference, for the eval task switch-to-published-version.
% Found with ${'`'}evals/fixtures/collect-preprint.mjs${'`'} on ${today}: arXiv ${p.id} names the published DOI ${p.doi} in its own record.
% preprint = arXiv lookup; published = doi.org lookup of that DOI.

${formatBibEntry(clean(pre.entry, 'preprint', `arXiv lookup ${today}`))}
${formatBibEntry(clean(pub.entry, 'published', `doi.org lookup ${today}`))}`;
  writeFileSync(join(here, 'preprint.bib'), text);
  console.error(`wrote preprint.bib for arXiv:${p.id} / ${p.doi}`);
  process.exit(0);
}
console.error('no usable pair found; try another --category or --start');
process.exit(1);
