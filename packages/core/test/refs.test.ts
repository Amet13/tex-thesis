/**
 * Unit tests for reference verification with synthetic responses. Response
 * shapes follow the real APIs (CrossRef works, dblp search, arXiv Atom,
 * OpenAlex works); the recorded real-world set lives in refs-bench.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { parseBib } from '../src/bib/index.js';
import {
  arxivCacheKey,
  doiCacheKey,
  generateKey,
  identifiersOf,
  missingKeys,
  parseArxivFeed,
  parseArxivId,
  parseDoi,
  queryKind,
  type RefCache,
  type RefResult,
  refsCheck,
  refsRules,
  titleCacheKey,
  titleSimilarity,
  verifyEntries,
} from '../src/refs/index.js';
import { handlerFetch, json } from './fixtures/refs/fake-fetch.js';

const RAFT = `@inproceedings{ongaro2014search,
  author = {Ongaro, Diego and Ousterhout, John},
  title = {In Search of an Understandable Consensus Algorithm},
  booktitle = {USENIX ATC}, year = {2014}}`;

const CLOCKS = `@article{lamport1978time,
  author = {Lamport, Leslie},
  title = {Time, Clocks, and the Ordering of Events in a Distributed System},
  journal = {CACM}, year = {1978}, doi = {10.1145/359545.359563}}`;

const clocksCsl = {
  DOI: '10.1145/359545.359563',
  type: 'journal-article',
  title: 'Time, clocks, and the ordering of events in a distributed system',
  author: [{ given: 'Leslie', family: 'Lamport' }],
  issued: { 'date-parts': [[1978, 7]] },
  'container-title': 'Communications of the ACM',
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
            ee: 'https://www.usenix.org/conference/atc14/technical-sessions/presentation/ongaro',
          },
        },
      ],
    },
  },
};

const emptyCrossref = { message: { items: [] } };
const emptyDblp = { result: { hits: { '@total': '0' } } };
const emptyAtom = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>';
const atom = (body: string) =>
  new Response(body, { headers: { 'content-type': 'application/atom+xml' } });

/** Routes by host; each route returns a Response. */
function router(routes: Partial<Record<string, (u: URL) => Response>>) {
  return handlerFetch((u) => {
    const route = routes[u.host];
    if (!route) throw new TypeError(`fetch failed: ${u.host}`);
    return route(u);
  });
}

const allEmpty = {
  'api.crossref.org': () => json(emptyCrossref),
  'dblp.org': () => json(emptyDblp),
  'export.arxiv.org': () => atom(emptyAtom),
};

const fast = { arxivIntervalMs: 0, retryDelayMs: 0 };

describe('identifiers and query parsing', () => {
  it('parses DOIs in the forms people paste', () => {
    expect(parseDoi('https://doi.org/10.1145/359545.359563')).toBe('10.1145/359545.359563');
    expect(parseDoi('doi:10.1038/171737A0')).toBe('10.1038/171737a0');
    expect(parseDoi('10.1016/S0022-2836(05)80360-2')).toBe('10.1016/s0022-2836(05)80360-2');
    expect(parseDoi('not a doi')).toBeNull();
  });

  it('parses arXiv ids in the forms people paste', () => {
    expect(parseArxivId('arXiv:2401.12345')).toBe('2401.12345');
    expect(parseArxivId('2401.12345v2')).toBe('2401.12345');
    expect(parseArxivId('https://arxiv.org/abs/1706.03762v7')).toBe('1706.03762');
    expect(parseArxivId('hep-th/9901001')).toBe('hep-th/9901001');
    expect(parseArxivId('10.48550/arXiv.2302.13971')).toBe('2302.13971');
    expect(parseArxivId('Attention is all you need')).toBeNull();
  });

  it('classifies lookup queries', () => {
    expect(queryKind('https://doi.org/10.1000/X')).toEqual({ kind: 'doi', value: '10.1000/x' });
    expect(queryKind('arXiv:1706.03762')).toEqual({ kind: 'arxiv', value: '1706.03762' });
    expect(queryKind(' Paxos Made Simple ')).toEqual({ kind: 'title', value: 'Paxos Made Simple' });
  });

  it('finds arXiv ids in eprint, journal, url and 10.48550 DOIs', () => {
    const [a, b, c, d] = parseBib(`
@misc{a, eprint = {2302.13971}, archiveprefix = {arXiv}}
@article{b, journal = {arXiv preprint arXiv:1301.3781}}
@misc{c, url = {https://arxiv.org/abs/1706.03762v5}}
@misc{d, doi = {10.48550/arXiv.2005.14165}}`);
    expect([a, b, c, d].map((e) => identifiersOf(e as NonNullable<typeof e>).arxivId)).toEqual([
      '2302.13971',
      '1301.3781',
      '1706.03762',
      '2005.14165',
    ]);
    expect(identifiersOf(d as NonNullable<typeof d>).doi).toBeUndefined();
  });

  it('builds stable cache keys', () => {
    expect(doiCacheKey('10.1145/ABC')).toBe('doi:10.1145/abc');
    expect(arxivCacheKey('1706.03762v7')).toBe('arxiv:1706.03762');
    expect(titleCacheKey('{BERT}: Pre-training of {D}eep', 2019)).toBe(
      'title:bert pre training of deep|2019',
    );
  });
});

describe('generateKey', () => {
  const key = (bib: string) =>
    generateKey(parseBib(bib)[0] as NonNullable<ReturnType<typeof parseBib>[0]>);
  it('is <surname><year><first significant word>, lowercase ASCII', () => {
    expect(key(RAFT)).toBe('ongaro2014search');
    expect(
      key('@misc{x, author={Vaswani, Ashish}, title={Attention Is All You Need}, year=2017}'),
    ).toBe('vaswani2017attention');
    expect(
      key(
        '@article{x, author={G{\\"o}del, Kurt}, title={{\\"U}ber formal unentscheidbare S{\\"a}tze}, year=1931}',
      ),
    ).toBe('godel1931formal');
    expect(
      key(
        '@article{x, author={Erd{\\H{o}}s, Paul}, title={On the evolution of random graphs}, year=1960}',
      ),
    ).toBe('erdos1960evolution');
    expect(
      key(
        '@article{x, author={{ATLAS Collaboration}}, title={Observation of a new particle}, year=2012}',
      ),
    ).toBe('atlas2012observation');
    expect(
      key("@article{x, author={van der Walt, St{\\'e}fan}, title={The NumPy array}, year=2011}"),
    ).toBe('walt2011numpy');
  });
});

describe('titleSimilarity', () => {
  it('ignores case, TeX markup, accents and punctuation', () => {
    expect(titleSimilarity('{BERT}: Pre-training of {D}eep', 'BERT: Pre-Training of Deep')).toBe(1);
    expect(
      titleSimilarity(
        'Zur Elektrodynamik bewegter K{\\"o}rper',
        'Zur Elektrodynamik bewegter Körper',
      ),
    ).toBe(1);
    expect(titleSimilarity('A {$\\beta$}-sheet', 'A <i>β</i>-sheet')).toBe(1);
  });

  it('accepts a missing or extra subtitle', () => {
    expect(
      titleSimilarity('Prospect Theory', 'Prospect Theory: An Analysis of Decision under Risk'),
    ).toBeGreaterThanOrEqual(0.9);
    expect(
      titleSimilarity('MapReduce: Simplified Data Processing on Large Clusters', 'MapReduce'),
    ).toBeLessThan(0.9);
  });

  it('does not treat a longer, different title as the same work', () => {
    expect(
      titleSimilarity('Attention Is All You Need for Graphs', 'Attention is all you need'),
    ).toBeLessThan(0.9);
    expect(
      titleSimilarity('Generative Adversarial Nets', 'Generative Adversarial Networks'),
    ).toBeLessThan(0.75);
  });
});

describe('parseArxivFeed', () => {
  it('reads entries, skips API error entries', () => {
    const records = parseArxivFeed(`<feed xmlns="http://www.w3.org/2005/Atom">
<entry><id>http://arxiv.org/abs/1706.03762v7</id><published>2017-06-12T17:57:34Z</published>
<updated>2023-08-02T00:41:18Z</updated><title>Attention Is All
  You Need</title><author><name>Ashish Vaswani</name></author><author><name>Łukasz Kaiser</name></author>
<arxiv:doi>10.5555/x</arxiv:doi></entry>
<entry><id>http://arxiv.org/api/errors#incorrect_id_format_for_1</id><title>Error</title></entry>
</feed>`);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      title: 'Attention Is All You Need',
      arxivId: '1706.03762',
      years: [2017, 2023],
      authors: [
        { given: 'Ashish', family: 'Vaswani' },
        { given: 'Łukasz', family: 'Kaiser' },
      ],
    });
  });
});

describe('verifyEntries', () => {
  it('verifies through the DOI and does not search further', async () => {
    const f = router({ 'doi.org': () => json(clocksCsl) });
    const [r] = await verifyEntries(parseBib(CLOCKS), { fetch: f.fetch, ...fast });
    expect(r).toMatchObject({
      status: 'verified',
      source: 'doi.org',
      query: 'doi:10.1145/359545.359563',
    });
    expect(r?.matched?.authors).toEqual(['Leslie Lamport']);
    expect(f.calls).toHaveLength(1);
  });

  it('verifies a conference paper through dblp when CrossRef has nothing', async () => {
    const f = router({ ...allEmpty, 'dblp.org': () => json(raftDblp) });
    const [r] = await verifyEntries(parseBib(RAFT), { fetch: f.fetch, ...fast });
    expect(r).toMatchObject({ status: 'verified', source: 'dblp', searched: ['crossref', 'dblp'] });
    expect(f.calls.some((c) => c.includes('arxiv'))).toBe(false);
  });

  it('reports not-found only when CrossRef and dblp both answered', async () => {
    const f = router(allEmpty);
    const [r] = await verifyEntries(parseBib(RAFT), { fetch: f.fetch, ...fast });
    expect(r?.status).toBe('not-found');
    expect(r?.searched).toEqual(['crossref', 'dblp', 'arxiv']);
  });

  it('never turns a network failure into not-found', async () => {
    const f = handlerFetch(() => {
      throw new TypeError('fetch failed');
    });
    const results = await verifyEntries(parseBib(`${RAFT}\n${CLOCKS}`), {
      fetch: f.fetch,
      ...fast,
    });
    expect(results.map((r) => r.status)).toEqual(['error', 'error']);
    expect(results[0]?.reason).toMatch(/network error/);
  });

  it('a dblp bot wall makes the lookup incomplete (error), not not-found', async () => {
    const f = router({
      ...allEmpty,
      'dblp.org': () => new Response('<html>Making sure you’re not a bot!</html>', { status: 202 }),
    });
    const results = await verifyEntries(
      parseBib(`${RAFT}\n${RAFT.replace('ongaro2014search', 'second')}`),
      {
        fetch: f.fetch,
        concurrency: 1,
        ...fast,
      },
    );
    expect(results.map((r) => r.status)).toEqual(['error', 'error']);
    expect(results[0]?.reason).toMatch(/non-JSON page/);
    // After the first bot wall, dblp is not asked again in this run.
    expect(f.calls.filter((c) => c.includes('dblp.org'))).toHaveLength(1);
  });

  it('a DOI that does not exist is not-found when no title matches', async () => {
    const f = router({ ...allEmpty, 'doi.org': () => new Response('Not found', { status: 404 }) });
    const [r] = await verifyEntries(parseBib(CLOCKS), { fetch: f.fetch, ...fast });
    expect(r?.status).toBe('not-found');
    expect(r?.reason).toMatch(/does not exist/);
  });

  it('a made-up DOI on a real title is a mismatch, not verified', async () => {
    const f = router({
      'doi.org': () => new Response('Not found', { status: 404 }),
      'api.crossref.org': () => json({ message: { items: [clocksCsl] } }),
    });
    const [r] = await verifyEntries(parseBib(CLOCKS), { fetch: f.fetch, ...fast });
    expect(r).toMatchObject({ status: 'mismatch', source: 'crossref' });
    expect(r?.differences?.[0]).toEqual({
      field: 'doi',
      bib: '10.1145/359545.359563',
      record: 'does not resolve',
    });
  });

  it('a made-up arXiv id on a real title is a mismatch, not verified', async () => {
    const bib = `@article{vaswani2017attention,
  author = {Vaswani, Ashish and Shazeer, Noam},
  title = {Attention Is All You Need}, year = {2017}, eprint = {1799.99999}}`;
    const f = router({
      'export.arxiv.org': (u) =>
        u.searchParams.get('id_list')
          ? atom(emptyAtom)
          : atom(`<feed xmlns="http://www.w3.org/2005/Atom">
<entry><id>http://arxiv.org/abs/1706.03762v7</id><published>2017-06-12T17:57:34Z</published>
<title>Attention Is All You Need</title><author><name>Ashish Vaswani</name></author>
<author><name>Noam Shazeer</name></author></entry></feed>`),
      'api.crossref.org': () =>
        json({
          message: {
            items: [
              {
                type: 'proceedings-article',
                title: 'Attention is all you need',
                author: [
                  { given: 'Ashish', family: 'Vaswani' },
                  { given: 'Noam', family: 'Shazeer' },
                ],
                issued: { 'date-parts': [[2017]] },
              },
            ],
          },
        }),
      'dblp.org': () => json(emptyDblp),
    });
    const [r] = await verifyEntries(parseBib(bib), { fetch: f.fetch, ...fast });
    expect(r?.status).toBe('mismatch');
    expect(r?.differences?.[0]).toEqual({
      field: 'eprint',
      bib: '1799.99999',
      record: 'does not resolve',
    });
  });

  it('flags a DOI that points to a different work', async () => {
    const bib = CLOCKS.replace(
      'Time, Clocks, and the Ordering of Events in a Distributed System',
      'Neural Byzantine Consensus',
    ).replace('Lamport, Leslie', 'Chen, Wei');
    const f = router({ 'doi.org': () => json(clocksCsl) });
    const [r] = await verifyEntries(parseBib(bib), { fetch: f.fetch, ...fast });
    expect(r?.status).toBe('mismatch');
    expect(r?.differences?.map((d) => d.field)).toEqual(['doi', 'author']);
  });

  it('year off by one is verified with a note; off by more is a mismatch', async () => {
    const f = router({ 'doi.org': () => json(clocksCsl) });
    const [one, three] = await verifyEntries(
      parseBib(
        `${CLOCKS.replace('year = {1978}', 'year = {1979}')}\n${CLOCKS.replace('lamport1978time', 'b').replace('year = {1978}', 'year = {1981}')}`,
      ),
      { fetch: f.fetch, ...fast },
    );
    expect(one?.status).toBe('verified');
    expect(one?.differences).toEqual([{ field: 'year', bib: '1979', record: '1978' }]);
    expect(three?.status).toBe('mismatch');
    expect(three?.differences).toEqual([{ field: 'year', bib: '1981', record: '1978' }]);
  });

  it('treats websites, software and RFCs as unverifiable without any request', async () => {
    const f = handlerFetch(() => json({}));
    const results = await verifyEntries(
      parseBib(`@online{a, title={CTAN}, url={https://ctan.org}}
@software{b, author={Doe, J.}, title={tool}}
@misc{c, title={HTTP Semantics}, howpublished={RFC 9110}}
@misc{d, url={https://example.org}}`),
      { fetch: f.fetch, ...fast },
    );
    expect(results.map((r) => r.status)).toEqual([
      'unverifiable',
      'unverifiable',
      'unverifiable',
      'unverifiable',
    ]);
    expect(f.calls).toHaveLength(0);
  });

  it('books, theses and plain misc entries that are not found are unverifiable', async () => {
    const f = router(allEmpty);
    const results = await verifyEntries(
      parseBib(`@book{a, author={Knuth, D.}, title={Some Book}, year=1997}
@phdthesis{b, author={Ongaro, Diego}, title={Consensus: Bridging Theory and Practice}, year=2014}
@misc{c, author={Doe, J.}, title={A Blog Post}, year=2020}`),
      { fetch: f.fetch, ...fast },
    );
    expect(results.map((r) => r.status)).toEqual(['unverifiable', 'unverifiable', 'unverifiable']);
  });

  it('honors the ignore list and note = {overfull: skip}', async () => {
    const f = handlerFetch(() => json({}));
    const results = await verifyEntries(
      parseBib(`${RAFT}\n${CLOCKS.replace('doi =', 'note = {Overfull: skip}, doi =')}`),
      { fetch: f.fetch, ignore: ['ongaro2014search'], ...fast },
    );
    expect(results.map((r) => [r.status, r.reason])).toEqual([
      ['unverifiable', 'skipped by author'],
      ['unverifiable', 'skipped by author'],
    ]);
    expect(f.calls).toHaveLength(0);
  });

  it('offline: everything unverifiable, no requests, check skipped', async () => {
    const f = handlerFetch(() => json({}));
    const results = await verifyEntries(parseBib(`${RAFT}\n${CLOCKS}`), {
      fetch: f.fetch,
      offline: true,
    });
    expect(results.map((r) => [r.status, r.reason])).toEqual([
      ['unverifiable', 'offline'],
      ['unverifiable', 'offline'],
    ]);
    expect(f.calls).toHaveLength(0);
    const check = refsCheck(results);
    expect(check.status).toBe('skipped');
    expect(check.skippedReason).toMatch(/offline/);
  });

  it('retries once on 503 honoring Retry-After', async () => {
    let n = 0;
    const f = router({
      'doi.org': () => (n++ === 0 ? json({}, 503, { 'retry-after': '0' }) : json(clocksCsl)),
    });
    const [r] = await verifyEntries(parseBib(CLOCKS), { fetch: f.fetch, ...fast });
    expect(r?.status).toBe('verified');
    expect(f.calls).toHaveLength(2);
  });

  it('times out slow requests and reports error', async () => {
    const f = handlerFetch(
      (_u) =>
        new Promise<Response>(() => {
          /* never answers */
        }),
    );
    const slow: typeof fetch = (input, init) =>
      new Promise((resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
        void f.fetch(input, init).then(resolve);
      });
    const [r] = await verifyEntries(parseBib(CLOCKS), { fetch: slow, timeoutMs: 30, ...fast });
    expect(r?.status).toBe('error');
    expect(r?.reason).toMatch(/timed out/);
  });

  it('limits concurrency', async () => {
    const f = router({ 'doi.org': () => json(clocksCsl) });
    const bib = Array.from({ length: 10 }, (_, i) =>
      CLOCKS.replace('lamport1978time', `k${i}`),
    ).join('\n');
    const results = await verifyEntries(parseBib(bib), { fetch: f.fetch, concurrency: 3, ...fast });
    expect(results.every((r) => r.status === 'verified')).toBe(true);
    expect(f.maxInFlight()).toBeLessThanOrEqual(3);
    expect(f.maxInFlight()).toBeGreaterThan(1);
  });

  it('cache hits avoid fetch', async () => {
    const map = new Map<string, unknown>();
    const cache: RefCache = { get: (k) => map.get(k), set: (k, v) => void map.set(k, v) };
    const f = router({
      ...allEmpty,
      'dblp.org': () => json(raftDblp),
      'doi.org': () => json(clocksCsl),
    });
    const bib = parseBib(`${RAFT}\n${CLOCKS}`);
    const first = await verifyEntries(bib, { fetch: f.fetch, cache, ...fast });
    const callsAfterFirst = f.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);
    expect([...map.keys()].sort()).toEqual([
      'doi:10.1145/359545.359563',
      'title:in search of an understandable consensus algorithm|2014',
    ]);
    const second = await verifyEntries(bib, { fetch: f.fetch, cache, ...fast });
    expect(f.calls.length).toBe(callsAfterFirst);
    expect(second.map((r) => r.status)).toEqual(first.map((r) => r.status));
  });

  it('uses OpenAlex only when a key is given', async () => {
    const openalex = {
      results: [
        {
          display_name: 'In Search of an Understandable Consensus Algorithm',
          publication_year: 2014,
          type: 'article',
          authorships: [{ author: { display_name: 'Diego Ongaro' } }],
        },
      ],
    };
    const routes = {
      ...allEmpty,
      'dblp.org': () => json(emptyDblp),
      'api.openalex.org': () => json(openalex),
    };
    const without = router(routes);
    const [a] = await verifyEntries(parseBib(RAFT), { fetch: without.fetch, ...fast });
    expect(a?.status).toBe('not-found');
    expect(without.calls.some((c) => c.includes('openalex'))).toBe(false);
    const withKey = router(routes);
    const [b] = await verifyEntries(parseBib(RAFT), {
      fetch: withKey.fetch,
      openalexKey: 'k',
      ...fast,
    });
    expect(b).toMatchObject({ status: 'verified', source: 'openalex' });
  });

  it('passes mailto to CrossRef', async () => {
    const f = router(allEmpty);
    await verifyEntries(parseBib(RAFT), { fetch: f.fetch, mailto: 'me@example.org', ...fast });
    expect(f.calls[0]).toContain('mailto=me%40example.org');
  });
});

describe('refsCheck', () => {
  const results: RefResult[] = [
    { key: 'a', status: 'verified', source: 'doi.org' },
    {
      key: 'chen2024scalable',
      status: 'not-found',
      searched: ['crossref', 'dblp'],
      reason: 'no record with a similar title in CrossRef or dblp',
      location: { file: 'refs.bib', line: 3 },
    },
    {
      key: 'c',
      status: 'mismatch',
      source: 'crossref',
      differences: [{ field: 'year', bib: '1981', record: '1978' }],
      matched: { title: 'T', authors: [], doi: '10.1/x' },
    },
    { key: 'd', status: 'unverifiable', reason: 'web pages are not in scholarly indexes' },
    {
      key: 'e',
      status: 'error',
      reason: 'lookup incomplete: api.crossref.org: timed out after 10000 ms',
    },
  ];

  it('maps statuses to rules and severities', () => {
    const check = refsCheck(results, {
      issues: [{ line: 9, message: 'unexpected `}`', key: 'z' }],
      bibFile: 'refs.bib',
    });
    expect(check.status).toBe('fail');
    expect(check.problems.map((p) => [p.rule, p.severity])).toEqual([
      ['bib-parse-error', 'error'],
      ['reference-not-found', 'error'],
      ['reference-metadata-mismatch', 'warning'],
      ['reference-unverifiable', 'info'],
      ['reference-lookup-failed', 'warning'],
    ]);
    const nf = check.problems[1];
    expect(nf?.message).toBe('`chen2024scalable` was not found in CrossRef or dblp');
    expect(nf?.location).toEqual({ file: 'refs.bib', line: 3 });
    expect(nf?.fix).toMatch(/overfull cite/);
    expect(check.problems[2]?.fix).toContain('overfull cite 10.1/x');
    expect(check.summary).toBe(
      '1 of 5 references verified (1 not found, 1 with differing metadata, 1 could not be checked, 1 not checkable automatically)',
    );
    expect(check.stats).toEqual({
      total: 5,
      verified: 1,
      mismatch: 1,
      notFound: 1,
      unverifiable: 1,
      error: 1,
    });
  });

  it('passes when everything is verified', () => {
    const check = refsCheck([{ key: 'a', status: 'verified' }]);
    expect(check).toMatchObject({
      status: 'pass',
      summary: '1 of 1 references verified',
      problems: [],
    });
  });

  it('every rule used is documented', () => {
    const ids = refsRules.map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'reference-not-found',
        'reference-metadata-mismatch',
        'reference-unverifiable',
        'reference-lookup-failed',
        'bib-parse-error',
        'citation-key-missing',
      ]),
    );
    expect(refsRules.every((r) => r.check === 'references')).toBe(true);
  });
});

describe('missingKeys', () => {
  it('reports cited keys without entries', () => {
    const problems = missingKeys(
      ['ongaro2014search', 'ghost2024', 'Ongaro2014search'],
      parseBib(RAFT),
    );
    expect(problems.map((p) => [p.rule, p.severity, p.data?.key])).toEqual([
      ['citation-key-missing', 'error', 'ghost2024'],
      ['citation-key-missing', 'error', 'Ongaro2014search'],
    ]);
  });
});
