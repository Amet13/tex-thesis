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
