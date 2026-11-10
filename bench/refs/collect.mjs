#!/usr/bin/env node
// Builds dataset/real.bib by looking works up. Nothing in it is written from memory.
//
//   node bench/refs/collect.mjs [--seed 1] [--out bench/refs/dataset/real.bib]
//   OVERFULL_MAILTO=you@example.org node bench/refs/collect.mjs   # CrossRef polite pool
//
// 1. Starts from packages/core/test/fixtures/refs/real.bib (entries recorded from the indexes).
// 2. Finds more identifiers by sampling the indexes themselves: CrossRef's `sample`
//    parameter (journal articles, proceedings papers, books, dissertations, preprints,
//    non-English works) and arXiv's listing API by category. No identifier comes from memory.
// 3. Looks each identifier up with the same `lookup` function `overfull cite` uses, and keeps the
//    entry it returns. Lookups that fail are skipped and listed on stderr.
// 4. Removes the DOI from every third article or conference paper, so that the check has to find
//    that work by title (that is how an author's entry often looks, and it exercises title search).
// Every entry gets x-bench = {real}, x-bench-source and, where known, x-bench-field.
// The live APIs answer differently from day to day, so a rerun gives a different sample;
// the committed dataset/real.bib is the artifact, and this script documents how it was made.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { formatBibEntry, lookup, parseBib, repoRoot } from './lib/core.mjs';
import { rng } from './lib/rng.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    seed: { type: 'string', default: '1' },
    out: { type: 'string', default: join(here, 'dataset', 'real.bib') },
  },
});
const random = rng(Number(values.seed));
const mailto = process.env.OVERFULL_MAILTO;
const today = new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lookupOpts = { mailto, arxivIntervalMs: 3000, timeoutMs: 20_000 };

/** Quotas per research field. CrossRef returns no subject for most works, so each field is reached
 * with a few generic topic words searched in titles (the identifiers still come from the index). */
const FIELDS = {
  'computer-science': { terms: ['algorithm', 'neural network', 'distributed systems'], want: 8 },
  physics: { terms: ['quantum', 'superconductivity', 'dark matter'], want: 7 },
  biology: { terms: ['protein', 'gene expression', 'ecology'], want: 7 },
  medicine: { terms: ['randomized trial', 'cancer therapy', 'cohort of patients'], want: 7 },
  'social-science': { terms: ['inequality', 'labor market', 'education attainment'], want: 7 },
  mathematics: { terms: ['theorem', 'graph', 'differential equations'], want: 7 },
};

async function crossref(params) {
  const q = new URLSearchParams({
    ...params,
    select: 'DOI,title,type,subject,is-referenced-by-count,author,issued',
  });
  if (mailto) q.set('mailto', mailto);
  let res = await fetch(`https://api.crossref.org/works?${q}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 429) {
    await sleep(15_000);
    res = await fetch(`https://api.crossref.org/works?${q}`, {
      signal: AbortSignal.timeout(30_000),
    });
  }
  if (!res.ok) throw new Error(`CrossRef HTTP ${res.status}`);
  return (await res.json()).message.items ?? [];
}

const usable = (w, minCites) =>
  w.DOI &&
  (w.title?.[0] ?? '').length >= 25 &&
  (w.author?.length ?? 0) > 0 &&
  (w['is-referenced-by-count'] ?? 0) >= minCites &&
  !/[<>]/.test(w.title[0]);

const picks = []; // { id, source, field, kind }
const seen = new Set();
const add = (p) => {
  if (seen.has(p.id.toLowerCase())) return false;
  seen.add(p.id.toLowerCase());
  picks.push(p);
  return true;
};

let consecutiveFailures = 0;
async function sampleCrossref(label, params, minCites, take) {
  const got = [];
  for (let call = 0; call < (take.calls ?? 8) && got.length < take.max; call++) {
    try {
      const items = await crossref({ sample: '100', ...params });
      consecutiveFailures = 0;
      for (const w of items) if (usable(w, minCites) && take.accept(w)) got.push(w);
    } catch (e) {
      console.error(`crossref ${label}: ${e.message}`);
      if (++consecutiveFailures >= 3) {
        console.error('CrossRef keeps failing; stopping this stage');
        break;
      }
    }
    await sleep(2500);
  }
  return got;
}

// Conference papers: CrossRef's random sample, filtered to works that others have cited.
const fieldCount = Object.fromEntries(Object.keys(FIELDS).map((f) => [f, 0]));
const procs = await sampleCrossref(
  'proceedings-article',
  { filter: 'type:proceedings-article,has-references:true,from-pub-date:1990' },
  10,
  { max: 30, accept: () => true },
);
for (const w of random.shuffle(procs).slice(0, 8))
  if (
    add({
      id: w.DOI,
      kind: 'proceedings-article',
      field: 'computer-science',
      source: 'crossref sample proceedings-article',
    })
  )
    fieldCount['computer-science']++;

// Journal articles per field: title search on generic topic words at a random offset.
for (const [field, f] of Object.entries(FIELDS)) {
  const pool = [];
  for (const term of f.terms) {
    for (let t = 0; t < 2; t++) {
      try {
        const offset = random.int(1500);
        const items = await crossref({
          'query.title': term,
          filter: 'type:journal-article,has-references:true,from-pub-date:1990',
          rows: '60',
          offset: String(offset),
        });
        for (const w of items) if (usable(w, 10)) pool.push({ w, term, offset });
      } catch (e) {
        console.error(`crossref ${field}/${term}: ${e.message}`);
      }
      await sleep(2500);
    }
  }
  for (const { w, term, offset } of random.shuffle(pool)) {
    if (fieldCount[field] >= f.want) break;
    if (
      add({
        id: w.DOI,
        kind: 'journal-article',
        field,
        source: `crossref title search "${term}" offset ${offset}`,
      })
    )
      fieldCount[field]++;
  }
}
console.error('fields', fieldCount);

// Books, dissertations, preprints (bioRxiv/medRxiv etc.), non-English works.
const books = await sampleCrossref('book', { filter: 'type:book,has-references:true' }, 8, {
  max: 40,
  accept: () => true,
});
for (const w of random.shuffle(books).slice(0, 6))
  add({ id: w.DOI, kind: 'book', source: 'crossref sample book' });
const theses = await sampleCrossref('dissertation', { filter: 'type:dissertation' }, 0, {
  max: 40,
  accept: () => true,
});
for (const w of random.shuffle(theses).slice(0, 6))
  add({ id: w.DOI, kind: 'thesis', source: 'crossref sample dissertation' });
const posted = await sampleCrossref(
  'posted-content',
  { filter: 'type:posted-content,has-references:true' },
  3,
  { max: 40, accept: () => true },
);
for (const w of random.shuffle(posted).slice(0, 6))
  add({ id: w.DOI, kind: 'preprint', source: 'crossref sample posted-content' });
// CrossRef cannot select or filter on language, so non-English titles are recognised from the
// title itself: it contains a common German/French/Spanish/Portuguese function word and none of
// the common English ones.
const NON_EN =
  /\b(und|der|die|das|zur|zum|von|bei|eine?|des|les|une?|dans|pour|sur|aux|del|las|los|por|para|uma|nos|dos|sobre)\b/i;
const EN = /\b(the|of|and|in|for|with|on|to)\b/i;
const foreign = await sampleCrossref(
  'non-English',
  { filter: 'type:journal-article,has-references:true,from-pub-date:1990' },
  2,
  {
    max: 40,
    calls: 25,
    accept: (w) => NON_EN.test(w.title[0]) && !EN.test(w.title[0]),
  },
);
for (const w of random.shuffle(foreign).slice(0, 8))
  add({
    id: w.DOI,
    kind: 'non-English title',
    source: 'crossref sample, title recognised as non-English',
  });

// arXiv preprints by category (listing API, 3 s apart as arXiv asks).
const CATS = [
  'cs.CL',
  'cs.CV',
  'cs.DC',
  'cs.CR',
  'hep-th',
  'astro-ph.CO',
  'q-bio.NC',
  'math.CO',
  'math.PR',
  'stat.ML',
  'cond-mat.str-el',
  'econ.EM',
];
for (const cat of random.shuffle(CATS).slice(0, 10)) {
  const start = random.int(4000);
  try {
    const res = await fetch(
      `https://export.arxiv.org/api/query?search_query=cat:${cat}&start=${start}&max_results=1&sortBy=submittedDate&sortOrder=descending`,
      { signal: AbortSignal.timeout(30_000) },
    );
    const m = /<id>https?:\/\/arxiv\.org\/abs\/([^<]+?)(v\d+)?<\/id>/.exec(await res.text());
    if (m)
      add({
        id: `arXiv:${m[1]}`,
        kind: 'preprint',
        field: cat,
        source: `arxiv listing cat:${cat}`,
      });
  } catch (e) {
    console.error(`arxiv ${cat}: ${e.message}`);
  }
  await sleep(3200);
}

console.error(`${picks.length} identifiers to look up`);
const real = parseBib(
  readFileSync(join(repoRoot, 'packages/core/test/fixtures/refs/real.bib'), 'utf8'),
);
const out = [];
const keys = new Set();
const dois = new Set();
const toEntry = (e, extra) => {
  const f = { ...e.fields };
  delete f['x-overfull'];
  return { type: e.type, key: e.key, fields: { ...f, 'x-bench': 'real', ...extra } };
};
for (const e of real) {
  keys.add(e.key);
  if (e.fields.doi) dois.add(e.fields.doi.toLowerCase());
  out.push(
    toEntry(e, {
      'x-bench-source':
        'packages/core/test/fixtures/refs/real.bib (recorded from the indexes 2026-11-08)',
    }),
  );
}
const fixtureCount = out.length;

let n = 0;
for (const p of picks) {
  let r;
  try {
    r = await lookup(p.id, lookupOpts);
  } catch (e) {
    console.error(`lookup ${p.id}: ${e.message}`);
  }
  await sleep(1000);
  if (!r) {
    console.error(`lookup ${p.id}: no result, skipped`);
    continue;
  }
  const e = r.entry;
  if (!e.fields.title || !e.fields.author || !/\d{4}/.test(e.fields.year ?? '')) {
    console.error(`lookup ${p.id}: incomplete entry, skipped`);
    continue;
  }
  const doi = e.fields.doi?.toLowerCase();
  if (doi && dois.has(doi)) continue;
  let key = e.key;
  for (let i = 0; keys.has(key); i++) key = `${e.key}${String.fromCharCode(97 + i)}`;
  keys.add(key);
  if (doi) dois.add(doi);
  const extra = {
    'x-bench-source': `${p.source}; ${r.source} lookup of ${p.id}; ${today}`,
    'x-bench-kind': p.kind,
  };
  if (p.field) extra['x-bench-field'] = p.field;
  const entry = toEntry({ ...e, key }, extra);
  // Every third article/conference paper loses its DOI (and URL), so that title search is exercised.
  if (['article', 'inproceedings'].includes(e.type) && entry.fields.doi) {
    if (n++ % 3 === 2) {
      delete entry.fields.doi;
      delete entry.fields.url;
      entry.fields['x-bench-note'] = 'doi removed to exercise title search';
    }
  }
  out.push(entry);
  console.error(`ok ${out.length - fixtureCount}\t${p.id}\t${e.fields.title.slice(0, 60)}`);
}

const header = `% Real works for the reference-check benchmark (class: real).
% ${fixtureCount} entries come from packages/core/test/fixtures/refs/real.bib; the other ${out.length - fixtureCount} were
% found by sampling CrossRef and arXiv and looked up with Overfull's own lookup on ${today}.
% See bench/refs/dataset/README.md. Built by bench/refs/collect.mjs.

`;
const fieldOrder = ['x-bench', 'x-bench-kind', 'x-bench-field', 'x-bench-note', 'x-bench-source'];
const text = out
  .map((e) => {
    const f = e.fields;
    const plain = Object.fromEntries(Object.entries(f).filter(([k]) => !fieldOrder.includes(k)));
    const bench = Object.fromEntries(
      fieldOrder.filter((k) => f[k] !== undefined).map((k) => [k, f[k]]),
    );
    return formatBibEntry({ ...e, fields: { ...plain, ...bench } });
  })
  .join('\n');
writeFileSync(values.out, header + text);
console.error(`wrote ${out.length} entries to ${values.out}`);
