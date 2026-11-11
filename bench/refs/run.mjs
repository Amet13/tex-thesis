#!/usr/bin/env node
// Runs Overfull's reference verification over dataset/real.bib and dataset/fabricated.bib and writes results.json.
//
//   node bench/refs/run.mjs                              # live network (monthly workflow)
//   node bench/refs/run.mjs --record http.json --limit 6 # live, and save every response
//   node bench/refs/run.mjs --replay http.json           # offline, from a recording
//
// Options: --real, --fabricated (bib files), --out (default bench/refs/results.json),
//   --limit N (first N entries of each class; marks the run partial), --seed N (order of entries),
//   --summary file (append a Markdown table, e.g. $GITHUB_STEP_SUMMARY), --timeout-ms.
// OVERFULL_MAILTO adds a contact address for CrossRef's polite pool; OPENALEX_API_KEY and
// SEMANTIC_SCHOLAR_API_KEY are passed on like the CLI does.
// Exit code: 0 whenever a run completed (misses are results, not failures); 1 or 2 if the harness itself failed.
//
// Entries are verified one at a time, in a seeded shuffled order that mixes real and fabricated entries,
// through one shared client: per-entry seconds are then the time between two answers, and a source that
// starts failing is switched off by the core's circuit breaker for everyone alike.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseBib, repoRoot, verifyEntries } from './lib/core.mjs';
import { rng } from './lib/rng.mjs';
import { toMarkdown } from './report.mjs';
import { CLASSES, score } from './score.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    real: { type: 'string', default: join(here, 'dataset', 'real.bib') },
    fabricated: { type: 'string', default: join(here, 'dataset', 'fabricated.bib') },
    replay: { type: 'string' },
    record: { type: 'string' },
    out: { type: 'string', default: join(here, 'results.json') },
    limit: { type: 'string' },
    seed: { type: 'string', default: '1' },
    summary: { type: 'string' },
    'timeout-ms': { type: 'string', default: '15000' },
  },
});

function fail(message, code = 2) {
  console.error(`bench/refs/run.mjs: ${message}`);
  process.exit(code);
}
if (values.replay && values.record) fail('--replay and --record cannot be combined');

// ---- dataset ----
function load(file) {
  const entries = parseBib(readFileSync(file, 'utf8'));
  return entries.map((e) => {
    const cls = e.fields['x-bench'];
    if (!CLASSES.includes(cls))
      fail(
        `${file}: entry ${e.key} has x-bench = {${cls ?? ''}}; expected one of ${CLASSES.join(', ')}`,
      );
    return { entry: e, cls };
  });
}
let items = [...load(values.real), ...load(values.fabricated)];
const keys = new Set();
for (const it of items) {
  if (keys.has(it.entry.key)) fail(`duplicate citation key ${it.entry.key}`);
  keys.add(it.entry.key);
}
const datasets = {
  real: {
    file: 'bench/refs/dataset/real.bib',
    entries: items.filter((i) => i.cls === 'real').length,
  },
  fabricated: {
    file: 'bench/refs/dataset/fabricated.bib',
    entries: items.filter((i) => i.cls !== 'real').length,
  },
};
const partial = values.limit !== undefined;
if (partial) {
  const n = Number(values.limit);
  if (!(n > 0)) fail('--limit needs a positive number');
  const taken = Object.fromEntries(CLASSES.map((c) => [c, 0]));
  items = items.filter((i) => ++taken[i.cls] <= n);
}
if (items.length === 0) fail('no entries');
items = rng(Number(values.seed)).shuffle(items);

// ---- HTTP: live, recorded or replayed, with per-host counters ----
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
const fixtureKey = (url, accept) => {
  const u = new URL(url);
  u.searchParams.delete('mailto');
  u.searchParams.delete('api_key');
  return `${accept} ${u}`;
};
function trimBody(url, contentType, body) {
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    if (body.includes('<feed')) return body.replace(/<summary>[\s\S]*?<\/summary>/g, '<summary/>');
    return /xml|bibtex|text\/plain/.test(contentType) || body.startsWith('@')
      ? body
      : body.slice(0, 300);
  }
  if (new URL(url).host === 'doi.org' && json && typeof json === 'object' && !Array.isArray(json)) {
    const kept = Object.fromEntries(CSL_KEYS.filter((k) => k in json).map((k) => [k, json[k]]));
    if (Array.isArray(kept.author)) kept.author = kept.author.slice(0, 100);
    return JSON.stringify(kept);
  }
  return JSON.stringify(json);
}

const hostStats = new Map();
const stat = (host) => {
  if (!hostStats.has(host)) hostStats.set(host, { host, requests: 0, failures: 0 });
  return hostStats.get(host);
};
const store = values.replay
  ? JSON.parse(readFileSync(values.replay, 'utf8'))
  : { requests: {}, hostFallbacks: {} };
const misses = [];
const liveFetch = (url, init) => fetch(url, init);
async function countingFetch(input, init = {}) {
  const url = String(input instanceof Request ? input.url : input);
  const host = new URL(url).host;
  const s = stat(host);
  s.requests++;
  const accept = init.headers?.Accept ?? '*/*';
  if (values.replay) {
    const hit = store.requests[fixtureKey(url, accept)] ?? store.hostFallbacks?.[host];
    if (!hit) {
      misses.push(fixtureKey(url, accept));
      s.failures++;
      throw new TypeError('fetch failed (no recording)');
    }
    if (hit.status === 429 || hit.status >= 500) s.failures++;
    const headers = { 'content-type': hit.contentType };
    if (hit.retryAfter) headers['retry-after'] = hit.retryAfter;
    return new Response(hit.status === 204 ? null : hit.body, { status: hit.status, headers });
  }
  let res;
  try {
    res = await liveFetch(url, init);
  } catch (e) {
    s.failures++;
    throw e;
  }
  const contentType = res.headers.get('content-type') ?? '';
  // A failure is anything the core cannot use: rate limit, server error, or a bot challenge page where JSON was asked for.
  const botWall = /json/.test(accept) && /text\/html/.test(contentType) && res.status !== 404;
  if (res.status === 429 || res.status >= 500 || botWall) s.failures++;
  if (values.record) {
    const body = await res.clone().text();
    const entry = { status: res.status, contentType, body: trimBody(url, contentType, body) };
    const retryAfter = res.headers.get('retry-after');
    if (retryAfter) entry.retryAfter = retryAfter;
    store.requests[fixtureKey(url, accept)] = entry;
    if (botWall && !store.hostFallbacks[host]) store.hostFallbacks[host] = entry;
  }
  return res;
}

// ---- run ----
const started = Date.now();
const seconds = [];
let last = started;
const results = await verifyEntries(
  items.map((i) => i.entry),
  {
    fetch: countingFetch,
    mailto: process.env.OVERFULL_MAILTO || undefined,
    ...(process.env.OPENALEX_API_KEY ? { openalexKey: process.env.OPENALEX_API_KEY } : {}),
    ...(process.env.SEMANTIC_SCHOLAR_API_KEY
      ? { semanticScholarKey: process.env.SEMANTIC_SCHOLAR_API_KEY }
      : {}),
    concurrency: 1,
    timeoutMs: Number(values['timeout-ms']),
    ...(values.replay ? { arxivIntervalMs: 0, retryDelayMs: 0 } : {}),
    onProgress: (done, total) => {
      const now = Date.now();
      seconds.push((now - last) / 1000);
      last = now;
      if (done % 10 === 0 || done === total) console.error(`${done}/${total}`);
    },
  },
);
const wallSeconds = (Date.now() - started) / 1000;
if (results.length !== items.length || seconds.length !== items.length)
  fail(
    `expected ${items.length} results and timings, got ${results.length} and ${seconds.length}`,
    1,
  );

const scored = items.map((it, i) => {
  const r = results[i];
  return {
    key: it.entry.key,
    class: it.cls,
    status: r.status,
    seconds: values.replay ? null : seconds[i],
    ...(r.source ? { source: r.source } : {}),
    ...(r.wrongWork ? { wrongWork: r.wrongWork } : {}),
    ...(r.reason ? { reason: r.reason } : {}),
    ...(r.failures?.length ? { failures: r.failures } : {}),
  };
});
const { counts, metrics } = score(scored);
if (values.replay) metrics.secondsPerEntry = { n: 0, median: null, p95: null, total: null };
else metrics.secondsPerEntry.total = wallSeconds;

// Which host belongs to which core source name (for "entries where the source was switched off").
const HOST_OF = {
  'doi.org': 'doi.org',
  crossref: 'api.crossref.org',
  dblp: 'dblp.org',
  arxiv: 'export.arxiv.org',
  openalex: 'api.openalex.org',
  semanticscholar: 'api.semanticscholar.org',
};
const SWITCHED_OFF = /rest of this run|blocking automated|budget used up/i;
const sources = [...hostStats.values()]
  .sort((a, b) => b.requests - a.requests)
  .map((s) => ({
    ...s,
    skippedByBreaker: scored.filter((e) =>
      (e.failures ?? []).some(
        (f) => (HOST_OF[f.source] ?? f.source) === s.host && SWITCHED_OFF.test(f.reason),
      ),
    ).length,
  }));

const pkg = JSON.parse(readFileSync(join(repoRoot, 'packages', 'cli', 'package.json'), 'utf8'));
const out = {
  schema: 1,
  date: new Date().toISOString(),
  overfullVersion: pkg.version,
  mode: values.replay ? 'replay' : 'live',
  partial,
  seed: Number(values.seed),
  datasets,
  sources,
  counts,
  metrics,
  entries: scored.map(({ failures, ...e }) => e),
};
writeFileSync(values.out, `${JSON.stringify(out, null, 2)}\n`);
if (values.record) writeFileSync(values.record, `${JSON.stringify(store, null, 1)}\n`);
if (values.summary) appendFileSync(values.summary, toMarkdown(out));
if (misses.length) console.error(`${misses.length} requests had no recording, e.g. ${misses[0]}`);
console.error(`wrote ${values.out}`);
process.stdout.write(toMarkdown(out));
