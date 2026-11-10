#!/usr/bin/env node
// Derives dataset/fabricated.bib mechanically from dataset/real.bib. Deterministic for a given seed.
//
//   node bench/refs/make-fabricated.mjs [--seed 1] [--per-class 30] [--in …/real.bib] [--out …/fabricated.bib]
//
// Three classes, each entry labelled x-bench = {class}; x-bench-from names the real entries it was built from:
//   invented         title words shuffled across three unrelated real titles, the author list of a fourth
//                    work, no identifier;
//   wrong-metadata   a real title with another work's author list and a year 3 to 9 years off, no identifier;
//   wrong-doi        a real work's title, authors and year with the DOI of a different real work.
// Nothing here is written by hand. An invented title could in principle coincide with a real work;
// the script rejects shuffles whose words overlap too much with any source title, and no index is
// consulted, so a coincidence cannot be ruled out entirely (see dataset/README.md).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { formatBibEntry, parseBib } from './lib/core.mjs';
import { rng } from './lib/rng.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    seed: { type: 'string', default: '1' },
    'per-class': { type: 'string', default: '30' },
    in: { type: 'string', default: join(here, 'dataset', 'real.bib') },
    out: { type: 'string', default: join(here, 'dataset', 'fabricated.bib') },
  },
});
const seed = Number(values.seed);
const random = rng(seed);
const SCHOLARLY = new Set([
  'article',
  'inproceedings',
  'book',
  'incollection',
  'phdthesis',
  'mastersthesis',
]);
const NOW_YEAR = 2026;

const real = parseBib(readFileSync(values.in, 'utf8'));
const eligible = real.filter(
  (e) =>
    SCHOLARLY.has(e.type) &&
    e.fields.title &&
    e.fields.author &&
    /^\d{4}$/.test(e.fields.year ?? '') &&
    e.fields['x-bench'] === 'real',
);
const perClass = Math.min(Number(values['per-class']), eligible.length);

const words = (title) => title.split(/\s+/).filter((w) => w && !/[{}\\$]/.test(w));
const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const wordSet = (title) => new Set(words(title).map(norm).filter(Boolean));
const jaccard = (a, b) => {
  const inter = [...a].filter((x) => b.has(x)).length;
  return inter / (a.size + b.size - inter || 1);
};
const realTitleSets = real.map((e) => wordSet(e.fields.title ?? ''));
const VENUE_FIELD = {
  article: 'journal',
  inproceedings: 'booktitle',
  incollection: 'booktitle',
  book: 'publisher',
  phdthesis: 'school',
  mastersthesis: 'school',
};
const venueOf = (e) => VENUE_FIELD[e.type];
const venueValue = (e) =>
  e.fields[venueOf(e)] ?? e.fields.publisher ?? e.fields.journal ?? e.fields.booktitle;

/** Distinct random indices into `eligible`, not equal to any in `not`. */
const others = (k, not) => {
  const out = [];
  while (out.length < k) {
    const i = random.int(eligible.length);
    if (!not.includes(i) && !out.includes(i)) out.push(i);
  }
  return out;
};

const bench = (cls, from) => ({
  'x-bench': cls,
  'x-bench-from': from.map((e) => e.key).join(' '),
  'x-bench-source': `bench/refs/make-fabricated.mjs, seed ${seed}`,
});

const out = [];
const order = random.shuffle(eligible.map((_, i) => i));

// (a) invented
const paperIdx = order.filter((i) => ['article', 'inproceedings'].includes(eligible[i].type));
for (let n = 0; n < perClass; n++) {
  const a = paperIdx[n % paperIdx.length];
  let made;
  for (let attempt = 0; attempt < 50 && !made; attempt++) {
    const [b, c, d] = others(3, [a]);
    const A = eligible[a];
    const [B, C, D] = [b, c, d].map((i) => eligible[i]);
    const pool = random.shuffle([
      ...words(A.fields.title),
      ...words(B.fields.title),
      ...words(C.fields.title),
    ]);
    const len = Math.min(10, Math.max(5, words(A.fields.title).length));
    const title = pool.slice(0, len).join(' ');
    const set = wordSet(title);
    if (realTitleSets.some((s) => jaccard(set, s) >= 0.5)) continue;
    made = { A, B, C, D, title };
  }
  if (!made) throw new Error('could not build an invented title; dataset too small');
  const { A, B, C, D, title } = made;
  const fields = {
    author: D.fields.author,
    title: title.replace(/[,.;:]+$/, ''),
    [venueOf(A)]: venueValue(A),
    year: B.fields.year,
    ...bench('invented', [A, B, C, D]),
  };
  out.push({ type: A.type, key: `fab-invented-${String(n + 1).padStart(2, '0')}`, fields });
}

// (b) wrong metadata
for (let n = 0; n < perClass; n++) {
  const a = order[(n + 7) % order.length];
  const A = eligible[a];
  const [b] = others(1, [a]);
  const B = eligible[b];
  const delta = (3 + random.int(7)) * (random.next() < 0.5 ? -1 : 1);
  let year = Number(A.fields.year) + delta;
  if (year > NOW_YEAR || year < 1900) year = Number(A.fields.year) - delta;
  const fields = {
    author: B.fields.author,
    title: A.fields.title,
    [venueOf(A)]: venueValue(A),
    year: String(year),
    ...bench('wrong-metadata', [A, B]),
  };
  out.push({ type: A.type, key: `fab-wrongmeta-${String(n + 1).padStart(2, '0')}`, fields });
}

// (c) real DOI on a different work
const withDoi = eligible.map((e, i) => [e, i]).filter(([e]) => e.fields.doi);
for (let n = 0; n < Math.min(perClass, withDoi.length); n++) {
  const shuffled = random.shuffle(withDoi);
  const [A] = shuffled[n % shuffled.length];
  const B = shuffled.find(
    ([e]) => e.fields.doi.toLowerCase() !== A.fields.doi.toLowerCase() && e.key !== A.key,
  )[0];
  const fields = {
    author: A.fields.author,
    title: A.fields.title,
    [venueOf(A)]: venueValue(A),
    year: A.fields.year,
    doi: B.fields.doi,
    ...bench('wrong-doi', [A, B]),
  };
  out.push({ type: A.type, key: `fab-wrongdoi-${String(n + 1).padStart(2, '0')}`, fields });
}

const header = `% Fabricated entries for the reference-check benchmark, derived from real.bib by
% bench/refs/make-fabricated.mjs (seed ${seed}). Classes: invented, wrong-metadata, wrong-doi.
% Nothing here is a real citation. See bench/refs/dataset/README.md.

`;
writeFileSync(values.out, header + out.map((e) => formatBibEntry(e)).join('\n'));
const byClass = Object.groupBy(out, (e) => e.fields['x-bench']);
console.error(
  `wrote ${out.length} entries to ${values.out}: ${Object.entries(byClass)
    .map(([c, es]) => `${c} ${es.length}`)
    .join(', ')}`,
);
