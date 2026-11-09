/**
 * Calibration benchmark on recorded real responses (fixtures/refs/http.json,
 * recorded with record.mjs on 2026-11-08). During recording dblp.org answered
 * every request with a bot challenge, so these numbers are for "dblp
 * unavailable": entries only dblp could confirm come out as `error`
 * (lookup incomplete), never as `not-found`, unless the keyless OpenAlex
 * fallback (responses topped up on 2026-11-09) confirms them.
 */
import { describe, expect, it } from 'vitest';
import { parseBib } from '../src/bib/index.js';
import { type RefResult, refsCheck, verifyEntries } from '../src/refs/index.js';
import { readFixture, recordedFetch } from './fixtures/refs/fake-fetch.js';

async function run(file: string): Promise<{ results: RefResult[]; misses: string[] }> {
  const f = recordedFetch();
  const results = await verifyEntries(parseBib(readFixture(file)), {
    fetch: f.fetch,
    arxivIntervalMs: 0,
    retryDelayMs: 0,
  });
  return { results, misses: f.misses };
}

const byStatus = (results: RefResult[]) =>
  Object.fromEntries(
    ['verified', 'mismatch', 'not-found', 'unverifiable', 'error'].map((s) => [
      s,
      results.filter((r) => r.status === s).map((r) => r.key),
    ]),
  );

describe('real references (51 entries)', () => {
  it('has a false not-found rate below 2% (measured: 0%)', async () => {
    const { results, misses } = await run('real.bib');
    expect(misses).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(40);
    const s = byStatus(results);
    expect(s['not-found']).toEqual([]);
    expect(s['not-found']?.length ?? 0).toBeLessThan(results.length * 0.02);
    // dblp was unreachable; the keyless OpenAlex fallback confirms these instead.
    const get = (k: string) => results.find((r) => r.key === k);
    for (const k of ['lamport2001paxos', 'ongaro2014search', 'krizhevsky2012imagenet']) {
      expect(get(k), k).toMatchObject({ status: 'verified', source: 'openalex' });
    }
    // Only dblp indexes this one (no DOI, not on arXiv, not found by OpenAlex either).
    expect(s.error).toEqual(['goodfellow2014generative']);
    expect(s.mismatch).toEqual([]);
    expect(s.unverifiable).toEqual([
      'knuth1997art',
      'ongaro2014consensus',
      'rfc9110nodoi',
      'numpy',
      'ctan',
      'nakamoto2008bitcoin',
    ]);
    expect(s.verified).toHaveLength(44);
  });

  it('verifies the hard cases', async () => {
    const { results } = await run('real.bib');
    const get = (k: string) => results.find((r) => r.key === k);
    // arXiv id; NeurIPS paper without DOI (CrossRef only has 2025 spam copies).
    expect(get('vaswani2017attention')).toMatchObject({ status: 'verified', source: 'arxiv' });
    expect(get('vaswani2017attentionnoid')).toMatchObject({ status: 'verified', source: 'arxiv' });
    // CrossRef's exact-title hit is a 2026 book chapter by someone else; arXiv has the paper.
    expect(get('brown2020language')).toMatchObject({ status: 'verified', source: 'arxiv' });
    // TeX accents and German titles.
    expect(get('godel1931formal')?.status).toBe('verified');
    expect(get('erdos1947remarksnodoi')?.status).toBe('verified');
    // Subtitle missing from the bib title.
    expect(get('kahneman1979prospect')?.status).toBe('verified');
    // Corporate author.
    expect(get('atlas2012observation')?.status).toBe('verified');
    // Old-style arXiv id; arXiv id in `journal`.
    expect(get('perelman2002entropy')).toMatchObject({ status: 'verified', source: 'arxiv' });
    expect(get('mikolov2013efficient')).toMatchObject({ status: 'verified', source: 'arxiv' });
    // Cited 1936, printed 1937: verified with a note.
    expect(get('turing1936computable')).toMatchObject({
      status: 'verified',
      differences: [{ field: 'year', bib: '1936', record: '1937' }],
    });
    // RFC with its DOI verifies; without, it is not checkable.
    expect(get('rfc9110')?.status).toBe('verified');
  });

  it('produces a check with an honest summary', async () => {
    const { results } = await run('real.bib');
    const check = refsCheck(results);
    expect(check.status).toBe('warn');
    expect(check.summary).toMatch(/^44 of 51 references verified/);
    expect(check.problems.some((p) => p.severity === 'error')).toBe(false);
  });
});

describe('fabricated references (17 entries)', () => {
  it('never verifies a fabricated reference', async () => {
    const { results, misses } = await run('fabricated.bib');
    expect(misses).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(15);
    const s = byStatus(results);
    expect(s.verified).toEqual([]);
    expect(s.unverifiable).toEqual([]);
    // Detected (not-found or mismatch): 13 of 17 = 76%. The other 4 have no DOI or arXiv id
    // and only dblp could rule them out, so they are reported as lookup failures (warning).
    expect([...(s['not-found'] ?? []), ...(s.mismatch ?? [])]).toHaveLength(13);
    expect(s.mismatch).toEqual(['lamport2003byzantine', 'mendes2020protein']);
    expect(s.error).toEqual([
      'liu2023sparse',
      'wang2024graph',
      'hughes2018lattice',
      'brown2021scaling',
    ]);
  });

  it('explains a DOI that belongs to another paper', async () => {
    const { results } = await run('fabricated.bib');
    const r = results.find((x) => x.key === 'mendes2020protein');
    expect(r?.differences?.[0]).toMatchObject({ field: 'doi', bib: '10.1126/science.1225829' });
    expect(r?.matched?.title).toMatch(/Programmable Dual-RNA/);
  });
});

describe('real papers with metadata errors', () => {
  it('reports every one as a mismatch with the right field', async () => {
    const { results, misses } = await run('errors.bib');
    expect(misses).toEqual([]);
    const fields = Object.fromEntries(
      results.map((r) => [
        r.key,
        `${r.status}:${(r.differences ?? []).map((d) => d.field).join(',')}`,
      ]),
    );
    expect(fields).toEqual({
      lamport1981time: 'mismatch:year',
      franklin1953molecular: 'mismatch:author',
      he2013deep: 'mismatch:year',
      weaver1948mathematical: 'mismatch:author',
      devlin2019wrongdoi: 'mismatch:doi,author,year',
      hassabis2021highly: 'mismatch:author',
      hochreiter2001long: 'mismatch:year',
    });
  });
});
