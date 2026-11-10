/**
 * ACL Anthology source: identifier parsing, and eight real papers verified from recordings
 * (fixtures/refs/http-sources.json, recorded 2026-11-10 with record-sources.mjs).
 */
import { describe, expect, it } from 'vitest';
import { parseBib } from '../src/bib/index.js';
import {
  identifiersOf,
  lookup,
  parseAclBib,
  parseAclId,
  queryKind,
  verifyEntries,
} from '../src/refs/index.js';
import { readFixture, recordedFetch } from './fixtures/refs/fake-fetch.js';

const opts = () => {
  const f = recordedFetch();
  return { f, o: { fetch: f.fetch, arxivIntervalMs: 0, retryDelayMs: 0 } };
};

describe('ACL Anthology ids', () => {
  it('parses ids, URLs and the ACL DOI', () => {
    for (const [input, id] of [
      ['2020.acl-main.1', '2020.acl-main.1'],
      ['ACL:2020.acl-main.1', '2020.acl-main.1'],
      ['https://aclanthology.org/2020.acl-main.1/', '2020.acl-main.1'],
      ['https://aclanthology.org/2020.acl-main.1.pdf', '2020.acl-main.1'],
      ['https://www.aclanthology.org/2020.iwclul-1.4.bib', '2020.iwclul-1.4'],
      ['aclanthology.org/2021.findings-emnlp.100', '2021.findings-emnlp.100'],
      ['https://aclweb.org/anthology/P19-1001.pdf', 'P19-1001'],
      ['D19-1001', 'D19-1001'],
      ['W12-3903', 'W12-3903'],
      ['https://doi.org/10.18653/v1/2020.acl-main.1', '2020.acl-main.1'],
      ['10.18653/v1/N18-3011', 'N18-3011'],
    ] as const) {
      expect(parseAclId(input), input).toBe(id);
    }
  });

  it('rejects what is not an Anthology id', () => {
    for (const s of [
      'Attention Is All You Need',
      '2020.acl',
      '1706.03762',
      '10.1145/359545.359563',
      'https://example.org/2020.acl-main.1',
      '../2020.acl-main.1',
      '2020.acl-main.1/../../x',
      '',
    ]) {
      expect(parseAclId(s), s).toBeNull();
    }
  });

  it('is classified by cite and lookup', () => {
    expect(queryKind('2020.acl-main.1')).toEqual({ kind: 'acl', value: '2020.acl-main.1' });
    expect(queryKind('https://aclanthology.org/D19-1001/')).toEqual({
      kind: 'acl',
      value: 'D19-1001',
    });
    // arXiv ids and DOIs keep their own kinds.
    expect(queryKind('arXiv:1706.03762').kind).toBe('arxiv');
    expect(queryKind('10.18653/v1/2020.acl-main.1').kind).toBe('doi');
  });

  it('takes the id from an entry url or ACL DOI', () => {
    const [byUrl, byDoi, none] = parseBib(`
@inproceedings{a, title={T}, url={https://aclanthology.org/2020.acl-main.1/}}
@inproceedings{b, title={T}, doi={10.18653/v1/D19-1001}}
@inproceedings{c, title={T}, url={https://example.org/paper.pdf}}`);
    expect(identifiersOf(byUrl as never).aclId).toBe('2020.acl-main.1');
    expect(identifiersOf(byDoi as never)).toMatchObject({
      doi: '10.18653/v1/d19-1001',
      aclId: 'D19-1001',
    });
    expect(identifiersOf(none as never).aclId).toBeUndefined();
  });
});

describe('ACL Anthology BibTeX', () => {
  it('normalizes a real entry (TeX braces and accents removed)', () => {
    const r = parseAclBib(`@inproceedings{gelderloos-etal-2020-learning,
    title = "Learning to Understand Child-directed and Adult-directed Speech",
    author = "Gelderloos, Lieke  and
      Chrupa{\\l}a, Grzegorz  and
      Alishahi, Afra",
    booktitle = "Proceedings of the 58th Annual Meeting of the {A}ssociation for {C}omputational {L}inguistics",
    year = "2020",
    url = "https://aclanthology.org/2020.acl-main.1/",
    doi = "10.18653/v1/2020.acl-main.1",
}`);
    expect(r).toMatchObject({
      source: 'acl',
      title: 'Learning to Understand Child-directed and Adult-directed Speech',
      years: [2020],
      doi: '10.18653/v1/2020.acl-main.1',
      type: 'proceedings-article',
      venue:
        'Proceedings of the 58th Annual Meeting of the Association for Computational Linguistics',
    });
    expect(r?.authors.map((a) => a.family)).toEqual(['Gelderloos', 'Chrupała', 'Alishahi']);
  });

  it('returns null for text that is not an entry', () => {
    expect(parseAclBib('<html>not found</html>')).toBeNull();
  });
});

describe('ACL Anthology: eight real papers from recordings', () => {
  it('verifies each through its Anthology id, from the acl source', async () => {
    const { f, o } = opts();
    const entries = parseBib(readFixture('sources-acl.bib')).filter(
      (e) => e.key !== 'missingid2020',
    );
    const results = await verifyEntries(entries, o);
    expect(f.misses).toEqual([]);
    expect(results).toHaveLength(8);
    for (const r of results) {
      expect(r, r.key).toMatchObject({ status: 'verified', source: 'acl' });
      expect(r.query).toMatch(/^acl:/);
    }
    // Only the Anthology was asked: one request per paper.
    expect(f.calls.every((u) => new URL(u).host === 'aclanthology.org')).toBe(true);
    expect(f.calls).toHaveLength(8);
  });

  it('an id the Anthology does not have never makes a real paper not-found', async () => {
    const { f, o } = opts();
    const entries = parseBib(readFixture('sources-acl.bib')).filter(
      (e) => e.key === 'missingid2020',
    );
    const [r] = await verifyEntries(entries, o);
    expect(f.misses).toEqual([]);
    expect(f.calls[0]).toBe('https://aclanthology.org/2020.acl-main.99999.bib');
    // The title is real: the search that follows finds it.
    expect(r?.status).toBe('verified');
    expect(r?.source).not.toBe('acl');
  });

  it('is skipped when the allow-list leaves it out (the browser check)', async () => {
    const { f, o } = opts();
    const entries = parseBib(readFixture('sources-acl.bib')).slice(0, 1);
    await verifyEntries(entries, { ...o, sources: ['crossref', 'doi.org'] }).catch(() => []);
    expect(f.calls.some((u) => u.includes('aclanthology.org'))).toBe(false);
  });
});

describe('overfull cite and lookup with ACL ids', () => {
  it('looks up an id and an aclanthology.org URL', async () => {
    const { f, o } = opts();
    const a = await lookup('2020.acl-main.1', o);
    const b = await lookup('https://aclanthology.org/D19-1001/', o);
    expect(f.misses).toEqual([]);
    expect(a).toMatchObject({ source: 'acl', confidence: 1 });
    expect(a?.entry.fields.title).toBe(
      'Learning to Understand Child-directed and Adult-directed Speech',
    );
    expect(a?.entry.fields.doi).toBe('10.18653/v1/2020.acl-main.1');
    expect(a?.entry.type).toBe('inproceedings');
    expect(b?.entry.fields.title).toBe(
      'Attending to Future Tokens for Bidirectional Sequence Generation',
    );
  });

  it('an old-style id without a DOI keeps the Anthology URL', async () => {
    const { o } = opts();
    const r = await lookup('W12-3903', o);
    expect(r?.entry.fields.title).toBe(
      'The Study of Effect of Length in Morphological Segmentation of Agglutinative Languages',
    );
    expect(r?.entry.fields.url ?? r?.entry.fields.doi).toBeTruthy();
  });

  it('an unknown id gives null', async () => {
    const { o } = opts();
    expect(await lookup('2020.acl-main.99999', o)).toBeNull();
  });
});
