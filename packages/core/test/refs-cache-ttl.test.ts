/** Cache lifetimes (30 days found, 1 day not found), no caching of errors, and `refresh`. */
import { describe, expect, it } from 'vitest';
import { parseBib } from '../src/bib/index.js';
import { cacheMaxAge } from '../src/refs/cache.js';
import { type RefCache, verifyEntries } from '../src/refs/index.js';

const BIB = `@article{lamport1978time,
  author = {Lamport, Leslie},
  title = {Time, Clocks, and the Ordering of Events in a Distributed System},
  journal = {CACM}, year = {1978}, doi = {10.1145/359545.359563}}

@inproceedings{ongaro2014search,
  author = {Ongaro, Diego and Ousterhout, John},
  title = {In Search of an Understandable Consensus Algorithm},
  booktitle = {USENIX ATC}, year = {2014}}

@article{ghost,
  author = {Nobody, Ann},
  title = {A Study That Does Not Exist Anywhere},
  journal = {J}, year = {2020}}`;

const csl = {
  DOI: '10.1145/359545.359563',
  type: 'journal-article',
  title: 'Time, clocks, and the ordering of events in a distributed system',
  author: [{ given: 'Leslie', family: 'Lamport' }],
  issued: { 'date-parts': [[1978, 7]] },
};
const raftDblp = {
  result: {
    hits: {
      '@total': '1',
      hit: [
        {
          info: {
            authors: { author: [{ text: 'Diego Ongaro' }, { text: 'John K. Ousterhout' }] },
            title: 'In Search of an Understandable Consensus Algorithm.',
            venue: 'USENIX ATC',
            year: '2014',
            type: 'Conference and Workshop Papers',
          },
        },
      ],
    },
  },
};
const emptyAtom = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>';

function server(down: string[] = []) {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    calls.push(u.host);
    if (down.includes(u.host)) return new Response('unavailable', { status: 503 });
    if (u.host === 'doi.org') return Response.json(csl);
    if (u.host === 'dblp.org') {
      return Response.json(
        u.searchParams.get('q')?.includes('Understandable') ? raftDblp : { result: { hits: {} } },
      );
    }
    if (u.host === 'api.crossref.org') return Response.json({ message: { items: [] } });
    return new Response(emptyAtom, { headers: { 'content-type': 'application/atom+xml' } });
  }) as typeof fetch;
  return { fetch: f, calls };
}

function memory(): RefCache & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return { map, get: (k) => map.get(k), set: (k, v) => void map.set(k, v) };
}

const fast = { arxivIntervalMs: 0, retryDelayMs: 0 };

describe('cache lifetimes', () => {
  it('defaults to 30 days for records and 1 day for not-found answers', () => {
    expect(cacheMaxAge(undefined)).toEqual({ positive: 30, negative: 1 });
    expect(cacheMaxAge({ negative: 7 })).toEqual({ positive: 30, negative: 7 });
  });

  it('a second run over the same entries with a warm cache makes zero fetch calls', async () => {
    const cache = memory();
    const first = server();
    const a = await verifyEntries(parseBib(BIB), { fetch: first.fetch, cache, ...fast });
    expect(a.map((r) => r.status)).toEqual(['verified', 'verified', 'not-found']);
    expect(first.calls.length).toBeGreaterThan(0);
    const second = server();
    const b = await verifyEntries(parseBib(BIB), { fetch: second.fetch, cache, ...fast });
    expect(second.calls).toEqual([]);
    expect(b.map((r) => r.status)).toEqual(['verified', 'verified', 'not-found']);
  });

  it('asks again for empty answers after a day but reuses found ones after 29 days', async () => {
    const cache = memory();
    await verifyEntries(parseBib(BIB), { fetch: server().fetch, cache, ...fast });
    const day = 24 * 60 * 60 * 1000;
    for (const value of cache.map.values()) {
      const v = value as { cachedAt: number | Record<string, number> };
      const age = 29 * day;
      v.cachedAt =
        typeof v.cachedAt === 'number'
          ? Date.now() - age
          : Object.fromEntries(Object.keys(v.cachedAt).map((s) => [s, Date.now() - age]));
    }
    const again = server();
    await verifyEntries(parseBib(BIB), { fetch: again.fetch, cache, ...fast });
    // The found DOI record and the dblp hit (29 days old) are reused; every empty
    // answer (CrossRef twice, dblp and arXiv for the ghost) is asked again.
    expect(again.calls.sort()).toEqual([
      'api.crossref.org',
      'api.crossref.org',
      'dblp.org',
      'export.arxiv.org',
    ]);
  });

  it('never caches transport errors', async () => {
    const cache = memory();
    const broken = server(['api.crossref.org', 'dblp.org', 'export.arxiv.org', 'doi.org']);
    const a = await verifyEntries(parseBib(BIB), { fetch: broken.fetch, cache, ...fast });
    expect(a.every((r) => r.status === 'error')).toBe(true);
    expect(cache.map.size).toBe(0);
    const healthy = server();
    const b = await verifyEntries(parseBib(BIB), { fetch: healthy.fetch, cache, ...fast });
    expect(b.map((r) => r.status)).toEqual(['verified', 'verified', 'not-found']);
  });

  it('refresh ignores stored answers and stores the new ones', async () => {
    const cache = memory();
    await verifyEntries(parseBib(BIB), { fetch: server().fetch, cache, ...fast });
    const again = server();
    const results = await verifyEntries(parseBib(BIB), {
      fetch: again.fetch,
      cache,
      refresh: true,
      ...fast,
    });
    expect(again.calls.length).toBeGreaterThan(0);
    expect(results.map((r) => r.status)).toEqual(['verified', 'verified', 'not-found']);
    const warm = server();
    await verifyEntries(parseBib(BIB), { fetch: warm.fetch, cache, ...fast });
    expect(warm.calls).toEqual([]);
  });
});
