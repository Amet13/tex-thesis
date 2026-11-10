/**
 * Europe PMC source: PMID / PMCID parsing, ids in .bib fields, and real works verified from
 * recordings (fixtures/refs/http-sources.json, recorded 2026-11-10 with record-sources.mjs).
 */
import { describe, expect, it } from 'vitest';
import { parseBib } from '../src/bib/index.js';
import {
  identifiersOf,
  lookup,
  parsePmcid,
  parsePmid,
  queryKind,
  verifyEntries,
} from '../src/refs/index.js';
import { readFixture, recordedFetch } from './fixtures/refs/fake-fetch.js';

const opts = () => {
  const f = recordedFetch();
  return { f, o: { fetch: f.fetch, arxivIntervalMs: 0, retryDelayMs: 0 } };
};

describe('PubMed and PubMed Central ids', () => {
  it('parses PMIDs', () => {
    expect(parsePmid('PMID:19872477')).toBe('19872477');
    expect(parsePmid('pmid 19872477')).toBe('19872477');
    expect(parsePmid('https://pubmed.ncbi.nlm.nih.gov/22745249/')).toBe('22745249');
    expect(parsePmid('https://www.ncbi.nlm.nih.gov/pubmed/22745249')).toBe('22745249');
    // A bare number is not claimed: it could be anything.
    expect(parsePmid('19872477')).toBeNull();
    expect(parsePmid('PMID:abc')).toBeNull();
    expect(parsePmid('PMID:1234567890')).toBeNull();
  });

  it('parses PMCIDs', () => {
    expect(parsePmcid('PMC5598109')).toBe('PMC5598109');
    expect(parsePmcid('pmc5598109')).toBe('PMC5598109');
    expect(parsePmcid('https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5598109/')).toBe('PMC5598109');
    expect(parsePmcid('https://pmc.ncbi.nlm.nih.gov/articles/PMC5598109/')).toBe('PMC5598109');
    expect(parsePmcid('https://europepmc.org/article/PMC/PMC5598109')).toBe('PMC5598109');
    expect(parsePmcid('PMC')).toBeNull();
    expect(parsePmcid('https://example.org/PMC5598109')).toBeNull();
  });

  it('is classified by cite and lookup', () => {
    expect(queryKind('PMID:19872477')).toEqual({ kind: 'pmid', value: '19872477' });
    expect(queryKind('PMC5598109')).toEqual({ kind: 'pmcid', value: 'PMC5598109' });
    expect(queryKind('Attention Is All You Need').kind).toBe('title');
  });

  it('takes ids from pmid, pmcid, eprint and url fields', () => {
    const entries = parseBib(`
@article{a, title={T}, pmid={19872477}}
@article{b, title={T}, pmcid={PMC5598109}}
@article{c, title={T}, eprint={22745249}, eprinttype={pubmed}}
@article{d, title={T}, url={https://pubmed.ncbi.nlm.nih.gov/11237011/}}
@article{e, title={T}, url={https://www.ncbi.nlm.nih.gov/pmc/articles/PMC2323736/}}
@article{f, title={T}, eprint={1706.03762}, archiveprefix={arXiv}}`);
    const ids = entries.map((e) => identifiersOf(e));
    expect(ids[0]?.pmid).toBe('19872477');
    expect(ids[1]?.pmcid).toBe('PMC5598109');
    expect(ids[2]?.pmid).toBe('22745249');
    expect(ids[3]?.pmid).toBe('11237011');
    expect(ids[4]?.pmcid).toBe('PMC2323736');
    expect(ids[5]).toEqual({ arxivId: '1706.03762' });
  });
});

describe('Europe PMC: real works from recordings', () => {
  it('verifies six works through their PubMed or PubMed Central id', async () => {
    const { f, o } = opts();
    const entries = parseBib(readFixture('sources-pubmed.bib')).filter(
      (e) => !['wrongpmid2016', 'missingpmid2021'].includes(e.key),
    );
    const results = await verifyEntries(entries, o);
    expect(f.misses).toEqual([]);
    expect(results).toHaveLength(6);
    for (const r of results)
      expect(r, r.key).toMatchObject({ status: 'verified', source: 'europepmc' });
    expect(results.map((r) => r.query)).toEqual([
      'pmid:19872477',
      'pmid:11237011',
      'pmid:22745249',
      'pmid:26819042',
      'pmid:34265844',
      'pmcid:PMC5598109',
    ]);
    expect(f.calls.every((u) => new URL(u).host === 'www.ebi.ac.uk')).toBe(true);
  });

  it('a PubMed id that belongs to another paper is a metadata mismatch, not a verified entry', async () => {
    const { o } = opts();
    const entries = parseBib(readFixture('sources-pubmed.bib')).filter(
      (e) => e.key === 'wrongpmid2016',
    );
    const [r] = await verifyEntries(entries, o);
    expect(r?.status).toBe('mismatch');
    expect(r?.source).toBe('europepmc');
    expect(r?.matched?.title).toMatch(/human genome/i);
    expect(r?.differences?.map((d) => d.field)).toContain('title');
    // No rule for "wrong work" exists for PubMed ids: only the DOI and arXiv rules.
    expect(r?.wrongWork).toBeUndefined();
  });

  it('a PubMed id Europe PMC does not have does not make a real paper not-found', async () => {
    const { f, o } = opts();
    const entries = parseBib(readFixture('sources-pubmed.bib')).filter(
      (e) => e.key === 'missingpmid2021',
    );
    const [r] = await verifyEntries(entries, o);
    expect(f.misses).toEqual([]);
    expect(r?.status).toBe('verified');
    expect(r?.searched).toContain('europepmc');
  });

  it('searches by title as a fallback and verifies three real papers', async () => {
    const { f, o } = opts();
    const entries = parseBib(readFixture('sources-title.bib'));
    const results = await verifyEntries(entries, { ...o, sources: ['europepmc'] });
    expect(f.misses).toEqual([]);
    const by = Object.fromEntries(results.map((r) => [r.key, r]));
    for (const k of ['jumper2021highly', 'silver2016mastering', 'lander2001initial']) {
      expect(by[k], k).toMatchObject({ status: 'verified', source: 'europepmc' });
    }
    // Not a biomedical work, and the usual indexes were left out: unverifiable, never not-found.
    expect(by.vaswani2017attention?.status).toBe('unverifiable');
    expect(by.zhang2023certificates?.status).toBe('unverifiable');
    expect(results.some((r) => r.status === 'not-found')).toBe(false);
  });

  it('looks up a PMID, a PMCID and a PubMed URL', async () => {
    const { f, o } = opts();
    const a = await lookup('PMID:19872477', o);
    const b = await lookup('PMC5598109', o);
    const c = await lookup('https://pubmed.ncbi.nlm.nih.gov/22745249/', o);
    expect(f.misses).toEqual([]);
    expect(a?.source).toBe('europepmc');
    expect(a?.entry.fields.year).toBe('1929');
    expect(b?.entry.fields.title).toMatch(/Craniofacial form is altered/);
    expect(c?.entry.fields.title).toMatch(/Programmable Dual-RNA/i);
    expect(c?.entry.fields.doi).toBe('10.1126/science.1225829');
  });
});
