#!/usr/bin/env node
// Records real HTTP responses for the sources added after http.json: ACL Anthology,
// Europe PMC, Semantic Scholar and CrossRef's retraction data.
//
//   node packages/core/test/fixtures/refs/record-sources.mjs
//
// Same mechanism as record.mjs, written to a sibling file (http-sources.json) that
// fake-fetch.ts merges with http.json. Requests already in http.json are answered from
// it and from an earlier http-sources.json (so the indexes that are rate-limited or bot-walled are not asked again); every
// other request goes to the live service and is saved. Semantic Scholar answers HTTP 429
// when its shared keyless pool is busy: such an answer is retried after a pause and only
// the final answer is saved.
//
// Bodies are trimmed like in record.mjs: arXiv abstracts dropped and author lists cut to
// the first 100; Europe PMC records keep only the fields Overfull reads.

import { readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
const { CASES, LOOKUPS } = await import(pathToFileURL(join(here, 'sources-cases.mjs')).href);

const base = JSON.parse(readFileSync(join(here, 'http.json'), 'utf8'));

function fixtureKey(url, accept) {
  const u = new URL(url);
  u.searchParams.delete('mailto');
  u.searchParams.delete('api_key');
  return `${accept} ${u.toString()}`;
}

const EPMC_AUTHOR_KEYS = ['fullName', 'firstName', 'lastName', 'collectiveName'];
const EPMC_KEYS = [
  'id',
  'source',
  'pmid',
  'pmcid',
  'doi',
  'title',
  'authorString',
  'journalInfo',
  'pubYear',
  'firstPublicationDate',
  'bookOrReportDetails',
];

function trimBody(url, _contentType, body) {
  const host = new URL(url).host;
  if (body.includes('<feed')) {
    let n = 0;
    return body
      .replace(/<summary>[\s\S]*?<\/summary>/g, '<summary/>')
      .replace(/<author>[\s\S]*?<\/author>\s*/g, (a) => (++n > 100 ? '' : a));
  }
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    return body.startsWith('@') ? body : body.slice(0, 300);
  }
  if (host === 'www.ebi.ac.uk' && json?.resultList?.result) {
    json.resultList.result = json.resultList.result.map((r) => {
      const kept = Object.fromEntries(EPMC_KEYS.filter((k) => k in r).map((k) => [k, r[k]]));
      const authors = r.authorList?.author;
      if (authors) {
        kept.authorList = {
          author: authors
            .slice(0, 100)
            .map((a) =>
              Object.fromEntries(EPMC_AUTHOR_KEYS.filter((k) => k in a).map((k) => [k, a[k]])),
            ),
        };
      }
      if (kept.journalInfo?.journal) {
        const { title, medlineAbbreviation } = kept.journalInfo.journal;
        kept.journalInfo = { ...kept.journalInfo, journal: { title, medlineAbbreviation } };
      }
      return kept;
    });
    return JSON.stringify(json);
  }
  if (host === 'doi.org' && json && !Array.isArray(json) && Array.isArray(json.author)) {
    json.author = json.author.slice(0, 100);
  }
  return JSON.stringify(json);
}

const out = join(here, 'http-sources.json');
// A re-run keeps what was recorded before (so one slow service can be topped up alone);
// answers that were only a rate limit (429) are asked again.
let store = { requests: {}, hostFallbacks: {} };
try {
  store = JSON.parse(readFileSync(out, 'utf8'));
  for (const [k, v] of Object.entries(store.requests))
    if (v.status === 429) delete store.requests[k];
} catch {
  // first run
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function recordingFetch(url, init = {}) {
  const accept = init.headers?.Accept ?? '*/*';
  const key = fixtureKey(url, accept);
  const known = base.requests[key] ?? store.requests[key];
  if (known) {
    return new Response(known.status === 204 ? null : known.body, {
      status: known.status,
      headers: { 'content-type': known.contentType },
    });
  }
  const host = new URL(url).host;
  let res;
  for (let attempt = 0; attempt < 8; attempt++) {
    // The client's own timeouts (4 s to the first byte) would cut off slow first answers;
    // the recorder waits for them.
    const { signal: _signal, ...rest } = init;
    res = await fetch(url, rest);
    if (res.status !== 429 || host !== 'api.semanticscholar.org') break;
    await res.text();
    await sleep(15_000);
  }
  const body = await res.text();
  const contentType = res.headers.get('content-type') ?? '';
  const entry = { status: res.status, contentType, body: trimBody(url, contentType, body) };
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter) entry.retryAfter = retryAfter;
  store.requests[key] = entry;
  process.stderr.write(`${res.status} ${url.slice(0, 150)}\n`);
  return new Response(body, { status: res.status, headers: res.headers });
}

const common = {
  fetch: recordingFetch,
  mailto: process.env.OVERFULL_MAILTO,
  concurrency: 1,
  timeoutMs: 30_000,
  arxivIntervalMs: 3000,
  retryDelayMs: 8000,
};

for (const { file, opts } of CASES) {
  const entries = parseBib(readFileSync(join(here, file), 'utf8'));
  const results = await verifyEntries(entries, { ...common, ...opts });
  for (const r of results) {
    console.log(
      `${file}\t${JSON.stringify(opts)}\t${r.key}\t${r.status}\t${r.source ?? ''}\t${r.reason ?? ''}`,
    );
  }
}
for (const q of LOOKUPS) {
  const r = await lookup(q, common).catch((e) => ({ error: e.message }));
  console.log(`lookup\t${q}\t${r ? (r.entry?.key ?? r.error) : 'null'}`);
}

writeFileSync(out, `${JSON.stringify(store, null, 1)}\n`);
console.error(`wrote ${Object.keys(store.requests).length} responses to ${out}`);
