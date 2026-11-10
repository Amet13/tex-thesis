import { describe, expect, it } from 'vitest';
import { parseBib } from '../src/bib/index.js';
import { lookup } from '../src/refs/index.js';
import { handlerFetch, json } from './fixtures/refs/fake-fetch.js';

const fast = { arxivIntervalMs: 0, retryDelayMs: 0 };
const atom = (body: string) =>
  new Response(body, { headers: { 'content-type': 'application/atom+xml' } });
const _one = (bib: string) => parseBib(bib)[0] as NonNullable<ReturnType<typeof parseBib>[0]>;

describe('A6: title lookups are fast and honest', () => {
  const empty = (u: URL): Response => {
    if (u.host === 'api.crossref.org') return json({ message: { items: [] } });
    if (u.host === 'dblp.org') return json({ result: { hits: { '@total': '0' } } });
    return atom('<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
  };

  it('does not retry an OpenAlex 429 whose body says the daily budget is used up', async () => {
    let openalexCalls = 0;
    const f = handlerFetch((u) => {
      if (u.host === 'api.openalex.org') {
        openalexCalls++;
        return new Response('{"error":"Rate limit exceeded: daily budget"}', { status: 429 });
      }
      return empty(u);
    });
    const outcomes: { failures: { source: string; reason: string }[] }[] = [];
    await lookup('A sufficiently long made up title for testing', {
      fetch: f.fetch,
      ...fast,
      openalexKey: 'k',
      onSearch: (o) => outcomes.push(o),
    });
    expect(openalexCalls).toBe(1);
    expect(outcomes[0]?.failures.find((x) => x.source === 'openalex')?.reason).toMatch(/daily/);
  });

  it('stops asking further sources once the time budget is used up', async () => {
    const f = handlerFetch(empty);
    const outcomes: { searched: string[]; failures: { source: string }[] }[] = [];
    await expect(
      lookup('A sufficiently long made up title for testing', {
        fetch: f.fetch,
        ...fast,
        titleBudgetMs: -1,
        onSearch: (o) => outcomes.push(o),
      }),
    ).rejects.toThrow(/time budget/);
    expect(f.calls).toEqual([]);
    expect(outcomes[0]?.searched).toEqual([]);
    expect(outcomes[0]?.failures.map((x) => x.source)).toContain('crossref');
  });

  it('an OpenAlex record without a venue becomes @misc, title casing kept', async () => {
    const f = handlerFetch((u) =>
      u.host === 'api.openalex.org'
        ? json({
            results: [
              {
                display_name: 'Graph Neural Networks for Tiny Orchards in GPU Clusters',
                publication_year: 2024,
                type: 'article',
                authorships: [{ author: { display_name: 'Ada Lovelace' } }],
                primary_location: { source: null },
              },
            ],
          })
        : empty(u),
    );
    const r = await lookup('Graph Neural Networks for Tiny Orchards in GPU Clusters', {
      fetch: f.fetch,
      ...fast,
      openalexKey: 'k',
    });
    expect(r?.entry.type).toBe('misc');
    expect(r?.entry.fields.title).toBe('Graph Neural Networks for Tiny Orchards in GPU Clusters');
  });
});

describe('A5: lookup reports what really answered', () => {
  it('a dblp bot wall (HTTP 202 HTML) is a failure, not a searched source', async () => {
    const f = handlerFetch((u) => {
      if (u.host === 'dblp.org')
        return new Response('<html>Making sure you are not a bot!</html>', { status: 202 });
      if (u.host === 'api.crossref.org') return json({ message: { items: [] } });
      return atom('<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    });
    let seen: { searched: string[]; failures: { source: string }[] } | undefined;
    await lookup('A sufficiently long made up title for testing', {
      fetch: f.fetch,
      ...fast,
      sources: ['crossref', 'dblp', 'arxiv'],
      onSearch: (o) => {
        seen = o;
      },
    });
    expect(seen?.searched).toEqual(['crossref', 'arxiv']);
    expect(seen?.failures.map((x) => x.source)).toEqual(['dblp']);
  });
});
