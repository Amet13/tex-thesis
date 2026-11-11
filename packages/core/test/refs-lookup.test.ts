/** lookup() on recorded responses (fixtures/refs/http.json, queries in queries.mjs). */
import { describe, expect, it } from 'vitest';
import { formatBibEntry } from '../src/bib/index.js';
import { lookup, type RefsOptions, verifyEntries } from '../src/refs/index.js';
import { handlerFetch, recordedFetch } from './fixtures/refs/fake-fetch.js';

function opts(): { o: RefsOptions; misses: string[] } {
  const f = recordedFetch();
  return { o: { fetch: f.fetch, arxivIntervalMs: 0, retryDelayMs: 0 }, misses: f.misses };
}

describe('lookup', () => {
  it('DOI URL → publisher BibTeX, normalized, with a generated key', async () => {
    const { o, misses } = opts();
    const r = await lookup('https://doi.org/10.1145/359545.359563', o);
    expect(misses).toEqual([]);
    expect(r).toMatchObject({ source: 'doi.org', confidence: 1 });
    expect(r?.entry.key).toBe('lamport1978time');
    expect(r?.entry.type).toBe('article');
    expect(r?.entry.fields).toMatchObject({
      author: 'Lamport, Leslie',
      title: 'Time, clocks, and the ordering of events in a distributed system',
      year: '1978',
      doi: '10.1145/359545.359563',
      pages: '558--565',
    });
    expect(r?.entry.fields.issn).toBeUndefined();
    const text = formatBibEntry(r?.entry as NonNullable<typeof r>['entry']);
    expect(text.startsWith('@article{lamport1978time,\n  author ')).toBe(true);
  });

  it('bare DOI', async () => {
    const { o } = opts();
    expect((await lookup('10.1038/171737a0', o))?.entry.key).toBe('watson1953molecular');
  });

  it('a DOI that does not exist → null', async () => {
    const { o } = opts();
    expect(await lookup('doi:10.1145/3587712.3587799', o)).toBeNull();
  });

  it('arXiv ids → @misc with eprint', async () => {
    const { o, misses } = opts();
    const a = await lookup('arXiv:1706.03762', o);
    expect(a).toMatchObject({ source: 'arxiv', confidence: 1 });
    expect(a?.entry).toMatchObject({
      key: 'vaswani2017attention',
      type: 'misc',
      fields: {
        title: 'Attention Is All You Need',
        year: '2017',
        eprint: '1706.03762',
        archiveprefix: 'arXiv',
      },
    });
    expect(a?.entry.fields.author?.startsWith('Vaswani, Ashish and Shazeer, Noam')).toBe(true);
    const b = await lookup('2302.13971v2', o);
    expect(b?.entry.key).toBe('touvron2023llama');
    expect(await lookup('arXiv:2403.99871', o)).toBeNull();
    expect(misses).toEqual([]);
  });

  it('titles: returns the original work, not spam copies or same-title chapters', async () => {
    const { o, misses } = opts();
    const attention = await lookup('Attention Is All You Need', o);
    expect(attention?.entry.fields.eprint).toBe('1706.03762');
    const resnet = await lookup('Deep Residual Learning for Image Recognition', o);
    expect(resnet?.entry.fields.doi).toBe('10.1109/cvpr.2016.90');
    expect(resnet?.entry.key).toBe('he2016deep');
    const gpt3 = await lookup('Language Models are Few-Shot Learners', o);
    expect(gpt3?.entry.key).toBe('brown2020language');
    expect(gpt3?.confidence).toBeGreaterThanOrEqual(0.8);
    expect(misses).toEqual([]);
  });

  it('weak or unindexed titles → null, never a wrong paper', async () => {
    const { o, misses } = opts();
    expect(
      await lookup('Scalable consensus for distributed machine learning systems', o),
    ).toBeNull();
    expect(misses).toEqual([]);
  });

  it('dblp unreachable: the keyless OpenAlex fallback finds the paper', async () => {
    const { o, misses } = opts();
    const r = await lookup('In Search of an Understandable Consensus Algorithm', o);
    expect(r).toMatchObject({ source: 'openalex', entry: { key: 'ongaro2014search' } });
    expect(misses).toEqual([]);
  });

  it('a looked-up entry verifies', async () => {
    const { o } = opts();
    const r = await lookup('10.1038/171737a0', o);
    const [v] = await verifyEntries([r?.entry as NonNullable<typeof r>['entry']], o);
    expect(v?.status).toBe('verified');
  });

  it('offline → null without requests; unreachable → throws', async () => {
    const f = handlerFetch(() => {
      throw new TypeError('fetch failed');
    });
    expect(await lookup('Attention Is All You Need', { fetch: f.fetch, offline: true })).toBeNull();
    expect(f.calls).toHaveLength(0);
    await expect(
      lookup('Attention Is All You Need', { fetch: f.fetch, retryDelayMs: 0 }),
    ).rejects.toThrow(/lookup failed/);
  });
});

describe('lookup: published version of an arXiv preprint', () => {
  const feed = (doi: string) =>
    new Response(
      `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
<entry><id>http://arxiv.org/abs/1807.06209v4</id><published>2018-07-17T17:59:58Z</published>
<title>Planck 2018 results. VI. Cosmological parameters</title><author><name>Planck Collaboration</name></author>
${doi ? `<arxiv:doi>${doi}</arxiv:doi>` : ''}</entry></feed>`,
      { headers: { 'content-type': 'application/atom+xml' } },
    );
  const bibtex = `@article{x, title = {Planck 2018 results: VI. Cosmological parameters},
  author = {{Planck Collaboration}}, journal = {Astronomy \\& Astrophysics}, volume = {641},
  pages = {A6}, year = {2020}, doi = {10.1051/0004-6361/201833910}}`;
  const csl = JSON.stringify({
    DOI: '10.1051/0004-6361/201833910',
    type: 'journal-article',
    title: 'Planck 2018 results: VI. Cosmological parameters',
    author: [{ literal: 'Planck Collaboration' }],
    issued: { 'date-parts': [[2020]] },
    'container-title': 'Astronomy & Astrophysics',
  });
  const fetchWith = (doi: string) =>
    handlerFetch((u, accept) => {
      if (u.host === 'export.arxiv.org') return feed(doi);
      if (u.host === 'doi.org')
        return accept.includes('bibtex')
          ? new Response(bibtex, { headers: { 'content-type': 'application/x-bibtex' } })
          : new Response(csl, {
              headers: { 'content-type': 'application/vnd.citationstyles.csl+json' },
            });
      throw new TypeError(`fetch failed: ${u.host}`);
    });

  it('writes the published article and keeps the arXiv id', async () => {
    const f = fetchWith('10.1051/0004-6361/201833910');
    const r = await lookup('arXiv:1807.06209', { fetch: f.fetch, arxivIntervalMs: 0 });
    expect(r?.source).toBe('arxiv');
    expect(r?.entry.type).toBe('article');
    expect(r?.entry.fields).toMatchObject({
      doi: '10.1051/0004-6361/201833910',
      journal: 'Astronomy \\& Astrophysics',
      eprint: '1807.06209',
      archiveprefix: 'arXiv',
    });
  });

  it('keeps the preprint when arXiv names no published DOI', async () => {
    const f = fetchWith('');
    const r = await lookup('arXiv:1807.06209', { fetch: f.fetch, arxivIntervalMs: 0 });
    expect(r?.entry.fields.doi).toBeUndefined();
    expect(r?.entry.fields.eprint).toBe('1807.06209');
    expect(f.calls.some((c) => new URL(c).hostname === 'doi.org')).toBe(false);
  });
});
