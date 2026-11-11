/** Semantic Scholar: record mapping, the search request, keys, and failures. */
import { describe, expect, it } from 'vitest';
import { HttpClient, SourceUnavailableError } from '../src/refs/http.js';
import {
  fromSemanticScholar,
  semanticScholarSearch,
  semanticScholarSearchUrl,
} from '../src/refs/sources/semanticscholar.js';
import { handlerFetch, json } from './fixtures/refs/fake-fetch.js';

const client = (fetch: typeof globalThis.fetch, key?: string) =>
  new HttpClient({
    fetch,
    retryDelayMs: 0,
    ...(key ? { semanticScholarKey: key } : {}),
  });

describe('fromSemanticScholar', () => {
  it('maps a conference paper with a DOI', () => {
    const r = fromSemanticScholar({
      paperId: 'abc',
      title: ' Deep Residual Learning for Image Recognition ',
      year: 2016,
      venue: 'CVPR',
      authors: [{ name: 'Kaiming He' }, { name: 'X. Zhang' }, { name: '' }],
      externalIds: { DOI: '10.1109/CVPR.2016.90' },
      publicationTypes: ['Conference'],
      citationCount: 200000,
    });
    expect(r).toEqual({
      source: 'semanticscholar',
      title: 'Deep Residual Learning for Image Recognition',
      authors: [
        { given: 'Kaiming', family: 'He' },
        { given: 'X.', family: 'Zhang' },
      ],
      years: [2016],
      venue: 'CVPR',
      doi: '10.1109/cvpr.2016.90',
      url: 'https://www.semanticscholar.org/paper/abc',
      type: 'proceedings-article',
      citations: 200000,
    });
  });

  it('treats an arXiv "journal article" as a preprint, without the arXiv venue', () => {
    const r = fromSemanticScholar({
      title: 'Attention Is All You Need',
      year: null,
      journal: { name: 'ArXiv' },
      externalIds: { ArXiv: '1706.03762v7' },
      publicationTypes: ['JournalArticle'],
    });
    expect(r).toMatchObject({ type: 'preprint', arxivId: '1706.03762', years: [] });
    expect(r?.venue).toBeUndefined();
  });

  it('drops records without a title, and unknown types', () => {
    expect(fromSemanticScholar({ title: '  ' })).toBeNull();
    expect(fromSemanticScholar({ title: 'X', publicationTypes: ['Review'] })?.type).toBeUndefined();
  });
});

describe('semanticScholarSearch', () => {
  it('asks for five results with the needed fields, and sends the key when set', async () => {
    const seen: { url: string; key: string | null }[] = [];
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(input), key: new Headers(init?.headers).get('x-api-key') });
      return json({ data: [{ title: 'A' }, { title: '' }] });
    }) as typeof globalThis.fetch;
    const records = await semanticScholarSearch(client(fetch, 'k1'), 'A title', 'k1');
    expect(records.map((r) => r.title)).toEqual(['A']);
    const url = new URL(seen[0]?.url ?? '');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('fields')).toContain('externalIds');
    expect(semanticScholarSearchUrl('A title')).toBe(seen[0]?.url);
    expect(seen[0]?.key).toBe('k1');
  });

  it('answers no candidates for an empty result', async () => {
    const f = handlerFetch(() => json({ total: 0 }));
    expect(await semanticScholarSearch(client(f.fetch), 'Nothing')).toEqual([]);
  });

  it('a 429 without a key is a source failure, never "no candidates"', async () => {
    const f = handlerFetch(() =>
      json({ message: 'Too Many Requests' }, 429, { 'retry-after': '0' }),
    );
    await expect(semanticScholarSearch(client(f.fetch), 'A title')).rejects.toBeInstanceOf(
      SourceUnavailableError,
    );
  });
});
