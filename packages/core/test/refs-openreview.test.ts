/**
 * OpenReview links: recognised, never looked up (OpenReview asks automated clients for a
 * browser challenge), and a paper known only from OpenReview is not reported as not found.
 */
import { describe, expect, it } from 'vitest';
import { parseBib } from '../src/bib/index.js';
import { verifyEntries } from '../src/refs/index.js';
import { identifiersOf, parseOpenReviewId } from '../src/refs/kind.js';
import { handlerFetch, json } from './fixtures/refs/fake-fetch.js';

describe('OpenReview links', () => {
  it('parses forum and pdf links, and nothing else', () => {
    expect(parseOpenReviewId('https://openreview.net/forum?id=4g8BlKqjhGW')).toBe('4g8BlKqjhGW');
    expect(parseOpenReviewId('\\url{https://openreview.net/pdf?id=abc_DEF-12}')).toBe('abc_DEF-12');
    expect(parseOpenReviewId('https://openreview.net.example.com/forum?id=4g8BlKqjhGW')).toBeNull();
    expect(parseOpenReviewId('https://example.com/forum?id=4g8BlKqjhGW')).toBeNull();
    expect(parseOpenReviewId('https://openreview.net/group?id=ICLR.cc')).toBeNull();
    expect(parseOpenReviewId('not a url')).toBeNull();
  });

  it('is an identifier of the entry', () => {
    const [e] = parseBib(
      '@inproceedings{k, title={T}, url={https://openreview.net/forum?id=4g8BlKqjhGW}}',
    );
    expect(e && identifiersOf(e).openreviewId).toBe('4g8BlKqjhGW');
  });

  it('a paper found nowhere but with an OpenReview link is unverifiable, not not-found', async () => {
    const f = handlerFetch((u) => {
      if (u.hostname === 'openreview.net') throw new Error('OpenReview must not be asked');
      if (u.hostname === 'api.crossref.org') return json({ message: { items: [] } });
      if (u.hostname === 'dblp.org') return json({ result: { hits: { hit: [] } } });
      if (u.hostname === 'export.arxiv.org')
        return new Response('<feed xmlns="http://www.w3.org/2005/Atom"></feed>', {
          headers: { 'content-type': 'application/atom+xml' },
        });
      return json({ data: [], resultList: { result: [] } });
    });
    const entries = parseBib(
      `@inproceedings{k, author={Doe, Jane}, title={A Very Recent Paper Under Review At A Venue}, year={2026}, booktitle={ICLR}, url={https://openreview.net/forum?id=4g8BlKqjhGW}}
@inproceedings{n, author={Doe, Jane}, title={A Very Recent Paper Under Review At A Venue Too}, year={2026}, booktitle={ICLR}}`,
    );
    const [withLink, without] = await verifyEntries(entries, {
      fetch: f.fetch,
      arxivIntervalMs: 0,
      retryDelayMs: 0,
    });
    expect(withLink?.status).toBe('unverifiable');
    expect(withLink?.reason).toMatch(/OpenReview/);
    expect(without?.status).toBe('not-found');
  });
});
