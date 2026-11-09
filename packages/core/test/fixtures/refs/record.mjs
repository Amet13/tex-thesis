#!/usr/bin/env node
// Records real HTTP responses for the reference-verification tests.
//
//   node packages/core/test/fixtures/refs/record.mjs            # re-record everything
//   OVERFULL_MAILTO=you@example.org node …/record.mjs           # use CrossRef's polite pool
//
// It runs the real verifyEntries/lookup code against the live indexes with a
// fetch wrapper that saves every response to http.json, keyed by
// "<Accept> <URL>" (mailto/api_key query parameters removed). Tests replay
// these with a fake fetch, so they run offline and deterministically.
//
// Bodies are trimmed to keep the file small: doi.org CSL records keep only the
// fields Overfull reads (first 100 authors), arXiv feeds drop abstracts, and non-JSON pages (bot challenges) keep 300 chars.
// When a host answers with a bot challenge, that response is also stored as
// the host's fallback, because the code stops asking a host once it has seen one.

import { readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Load the TypeScript sources directly (Node ≥22.18 strips types): map ./x.js → ./x.ts.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.endsWith('.js')) return next(specifier.replace(/\.js$/, '.ts'), context);
      throw err;
    }
  },
});

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '../../../src');
const { parseBib } = await import(pathToFileURL(join(src, 'bib/index.ts')).href);
const { verifyEntries, lookup } = await import(pathToFileURL(join(src, 'refs/index.ts')).href);
const { LOOKUP_QUERIES } = await import(pathToFileURL(join(here, 'queries.mjs')).href);

const CSL_KEYS = [
  'DOI',
  'URL',
  'type',
  'title',
  'subtitle',
  'author',
  'issued',
  'published-print',
  'published-online',
  'published',
  'container-title',
  'is-referenced-by-count',
  'volume',
  'issue',
  'page',
  'publisher',
];

function fixtureKey(url, accept) {
  const u = new URL(url);
  u.searchParams.delete('mailto');
  u.searchParams.delete('api_key');
  return `${accept} ${u.toString()}`;
}

function trimBody(url, contentType, body) {
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    // arXiv abstracts are not used; dropping them keeps the fixture small.
    if (body.includes('<feed')) return body.replace(/<summary>[\s\S]*?<\/summary>/g, '<summary/>');
    return /xml|bibtex|x-bibtex|text\/plain/.test(contentType) ||
      body.startsWith('@') ||
      body.startsWith('<?xml')
      ? body
      : body.slice(0, 300);
  }
  if (new URL(url).host === 'doi.org' && json && typeof json === 'object' && !Array.isArray(json)) {
    const kept = Object.fromEntries(CSL_KEYS.filter((k) => k in json).map((k) => [k, json[k]]));
    // Collaboration papers list thousands of authors; the first 100 are plenty for matching.
    if (Array.isArray(kept.author)) kept.author = kept.author.slice(0, 100);
    return JSON.stringify(kept);
  }
  return JSON.stringify(json);
}

const out = join(here, 'http.json');
const store = { requests: {}, hostFallbacks: {} };

async function recordingFetch(url, init = {}) {
  const accept = init.headers?.Accept ?? '*/*';
  const res = await fetch(url, init);
  const body = await res.text();
  const contentType = res.headers.get('content-type') ?? '';
  const entry = { status: res.status, contentType, body: trimBody(url, contentType, body) };
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter) entry.retryAfter = retryAfter;
  store.requests[fixtureKey(url, accept)] = entry;
  const host = new URL(url).host;
  const botWall = res.status === 202 || /not a bot|captcha|challenge/i.test(body.slice(0, 2000));
  if (
    /json/.test(accept) &&
    /text\/html/.test(contentType) &&
    botWall &&
    !store.hostFallbacks[host]
  ) {
    store.hostFallbacks[host] = entry;
  }
  process.stderr.write(`${res.status} ${url.slice(0, 140)}\n`);
  return new Response(body, { status: res.status, headers: res.headers });
}

const opts = {
  fetch: recordingFetch,
  mailto: process.env.OVERFULL_MAILTO,
  concurrency: 2,
  timeoutMs: 30_000,
  arxivIntervalMs: 3000,
};

for (const name of ['real.bib', 'fabricated.bib', 'errors.bib']) {
  const entries = parseBib(readFileSync(join(here, name), 'utf8'));
  const results = await verifyEntries(entries, opts);
  for (const r of results) console.log(`${name}\t${r.key}\t${r.status}\t${r.reason ?? ''}`);
}
for (const q of LOOKUP_QUERIES) {
  const r = await lookup(q, opts).catch((e) => ({ error: e.message }));
  console.log(`lookup\t${q}\t${r ? (r.entry?.key ?? r.error) : 'null'}`);
}

writeFileSync(out, `${JSON.stringify(store, null, 1)}\n`);
console.error(`wrote ${Object.keys(store.requests).length} responses to ${out}`);
