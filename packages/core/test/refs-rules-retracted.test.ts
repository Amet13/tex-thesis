/**
 * `reference-retracted`: CrossRef's `updated-by` data (src/refs/retraction.ts). The recorded
 * answers are real (fixtures/refs/http-sources.json, 2026-11-10): one retraction and two
 * withdrawals, found through CrossRef's own `update-type` filters, and two works without notice.
 */
import { describe, expect, it } from 'vitest';
import { parseBib } from '../src/bib/index.js';
import { refsCheck, refsRules, retractionOf, verifyEntries } from '../src/refs/index.js';
import { handlerFetch, json, readFixture, recordedFetch } from './fixtures/refs/fake-fetch.js';

const run = async (extra = {}) => {
  const f = recordedFetch();
  const entries = parseBib(readFixture('sources-retracted.bib'));
  const results = await verifyEntries(entries, {
    fetch: f.fetch,
    arxivIntervalMs: 0,
    retryDelayMs: 0,
    checkRetractions: true,
    ...extra,
  });
  return { f, entries, results };
};

describe('reference-retracted', () => {
  it('is registered as an error with a summary and a fix', () => {
    const rule = refsRules.find((r) => r.id === 'reference-retracted');
    expect(rule).toMatchObject({ severity: 'error', check: 'references' });
    expect(rule?.summary).toMatch(/CrossRef/);
    expect(rule?.fix.length).toBeGreaterThan(20);
  });

  it('flags a retraction and two withdrawals, and nothing else', async () => {
    const { f, results } = await run();
    expect(f.misses).toEqual([]);
    const by = Object.fromEntries(results.map((r) => [r.key, r]));
    expect(by.retracted2019linc?.retraction).toMatchObject({
      kind: 'retraction',
      doi: '10.1177/1758835919874651',
      noticeDoi: '10.1177/17588359211061903',
      date: '2021-12-15',
      assertedBy: 'retraction-watch',
    });
    expect(by.masud2018labyrinth?.retraction).toMatchObject({
      kind: 'withdrawal',
      doi: '10.2514/6.2018-2123',
      assertedBy: 'publisher',
    });
    expect(by.njei2011adefovir?.retraction?.kind).toBe('withdrawal');
    expect(by.lamport1978time?.retraction).toBeUndefined();
    expect(by.watson1953molecular?.retraction).toBeUndefined();
    // The lookup outcome itself is unchanged.
    for (const r of results) expect(r.status).toBe('verified');
  });

  it('checks every DOI in one CrossRef request', async () => {
    const { f } = await run();
    const batch = f.calls.filter((u) => new URL(u).searchParams.get('select') === 'DOI,updated-by');
    expect(batch).toHaveLength(1);
    expect(new URL(batch[0] as string).searchParams.get('filter')?.split(',')).toHaveLength(5);
  });

  it('reports one error problem per flagged entry, with the notice', async () => {
    const { entries, results } = await run();
    const check = refsCheck(results, { entries });
    const problems = check.problems.filter((p) => p.rule === 'reference-retracted');
    expect(problems.map((p) => p.data?.key)).toEqual([
      'retracted2019linc',
      'masud2018labyrinth',
      'njei2011adefovir',
    ]);
    for (const p of problems) expect(p.severity).toBe('error');
    expect(problems[0]?.message).toBe(
      '`retracted2019linc` is recorded as retracted (DOI 10.1177/1758835919874651)',
    );
    expect(problems[0]?.detail).toContain('Retraction Watch');
    expect(problems[0]?.detail).toContain('https://doi.org/10.1177/17588359211061903');
    expect(problems[1]?.message).toContain('withdrawn');
    expect(check.status).toBe('fail');
    expect(JSON.stringify(problems)).not.toMatch(/fake/i);
  });

  it('asks nothing extra unless checkRetractions is set', async () => {
    const f = recordedFetch();
    const entries = parseBib(readFixture('sources-retracted.bib'));
    const results = await verifyEntries(entries, {
      fetch: f.fetch,
      arxivIntervalMs: 0,
      retryDelayMs: 0,
    });
    expect(f.calls.some((u) => u.includes('updated-by'))).toBe(false);
    expect(results.every((r) => r.retraction === undefined)).toBe(true);
  });

  it('leaves results alone when CrossRef cannot answer', async () => {
    const entries = parseBib(readFixture('sources-retracted.bib')).slice(0, 2);
    const f = recordedFetch();
    const flaky = ((url: string | URL | Request, init?: RequestInit) =>
      String(url).includes('updated-by')
        ? Promise.resolve(new Response('busy', { status: 503 }))
        : f.fetch(url, init)) as typeof fetch;
    const results = await verifyEntries(entries, {
      fetch: flaky,
      arxivIntervalMs: 0,
      retryDelayMs: 0,
      checkRetractions: true,
    });
    expect(results.map((r) => r.status)).toEqual(['verified', 'verified']);
    expect(results.every((r) => r.retraction === undefined)).toBe(true);
  });

  it('keeps a clean answer for one day only', async () => {
    const store = new Map<string, unknown>();
    const cache = {
      get: (k: string) => store.get(k),
      set: (k: string, v: unknown) => void store.set(k, v),
    };
    let asked = 0;
    const f = handlerFetch((u) => {
      if (u.searchParams.get('select') === 'DOI,updated-by') {
        asked++;
        return json({ message: { items: [{ DOI: '10.1234/x' }] } });
      }
      return json({
        DOI: '10.1234/x',
        type: 'journal-article',
        title: 'A Study of Careful Measurement in Practice',
        author: [{ given: 'A', family: 'Writer' }],
        issued: { 'date-parts': [[2020]] },
      });
    });
    const entries = parseBib(
      '@article{k, author={Writer, A.}, title={A Study of Careful Measurement in Practice}, year={2020}, doi={10.1234/x}}',
    );
    const o = { fetch: f.fetch, cache, checkRetractions: true, retryDelayMs: 0 };
    await verifyEntries(entries, o);
    await verifyEntries(entries, o);
    expect(asked).toBe(1);
    const stored = store.get('retraction:10.1234/x') as { cachedAt: number };
    stored.cachedAt = Date.now() - 2 * 24 * 3600 * 1000;
    await verifyEntries(entries, o);
    expect(asked).toBe(2);
  });
});

describe('retractionOf', () => {
  it('prefers a retraction over a withdrawal and ignores other update types', () => {
    expect(
      retractionOf({
        DOI: '10.1/A',
        'updated-by': [
          { type: 'correction', DOI: '10.1/c' },
          { type: 'withdrawal', DOI: '10.1/w', source: 'publisher' },
          { type: 'retraction', DOI: '10.1/r', source: 'retraction-watch' },
        ],
      }),
    ).toEqual({
      kind: 'retraction',
      doi: '10.1/a',
      noticeDoi: '10.1/r',
      assertedBy: 'retraction-watch',
    });
    expect(
      retractionOf({ DOI: '10.1/a', 'updated-by': [{ type: 'expression_of_concern' }] }),
    ).toBeUndefined();
    expect(retractionOf({ DOI: '10.1/a' })).toBeUndefined();
  });
});
