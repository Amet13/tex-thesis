/**
 * `reference-published-version`: the arXiv record of the entry's paper names a published DOI.
 * Recorded arXiv answers are real (fixtures/refs/http-sources.json, 2026-11-10).
 */
import { describe, expect, it } from 'vitest';
import { parseBib } from '../src/bib/index.js';
import { refsCheck, refsRules, verifyEntries } from '../src/refs/index.js';
import { readFixture, recordedFetch } from './fixtures/refs/fake-fetch.js';

const run = async () => {
  const f = recordedFetch();
  const entries = parseBib(readFixture('sources-arxiv-doi.bib'));
  const results = await verifyEntries(entries, {
    fetch: f.fetch,
    arxivIntervalMs: 0,
    retryDelayMs: 0,
  });
  return { f, entries, results };
};

describe('reference-published-version', () => {
  it('is registered as info', () => {
    expect(refsRules.find((r) => r.id === 'reference-published-version')).toMatchObject({
      severity: 'info',
      check: 'references',
    });
  });

  it('names the DOI for four arXiv papers and suggests overfull cite', async () => {
    const { f, entries, results } = await run();
    expect(f.misses).toEqual([]);
    const problems = refsCheck(results, { entries }).problems.filter(
      (p) => p.rule === 'reference-published-version',
    );
    expect(problems.map((p) => [p.data?.key, p.data?.doi])).toEqual([
      ['planck2018vi', '10.1051/0004-6361/201833910'],
      ['atlas2012higgs', '10.1016/j.physletb.2012.08.020'],
      ['cms2012higgs', '10.1016/j.physletb.2012.08.021'],
      ['ligo2016gw150914', '10.1103/physrevlett.116.061102'],
    ]);
    for (const p of problems) {
      expect(p.severity).toBe('info');
      expect(p.fix).toContain(`overfull cite ${p.data?.doi}`);
    }
  });

  it('says nothing for a paper whose arXiv record names no DOI', async () => {
    const { entries, results } = await run();
    const problems = refsCheck(results, { entries }).problems;
    expect(
      problems.some(
        (p) => p.rule === 'reference-published-version' && p.data?.key === 'vaswani2017attention',
      ),
    ).toBe(false);
  });

  it('says nothing when the entry already has the DOI', async () => {
    const { entries, results } = await run();
    const withDoi = entries.map((e) =>
      e.key === 'planck2018vi'
        ? { ...e, fields: { ...e.fields, doi: '10.1051/0004-6361/201833910' } }
        : e,
    );
    const problems = refsCheck(results, { entries: withDoi }).problems;
    expect(
      problems.some(
        (p) => p.rule === 'reference-published-version' && p.data?.key === 'planck2018vi',
      ),
    ).toBe(false);
  });
});
