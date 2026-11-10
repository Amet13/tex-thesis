/**
 * A host that hangs or answers 5xx is skipped after two failures, sources for one
 * entry are asked concurrently, and a progress callback reports finished entries.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseBib } from '../src/bib/index.js';
import { verifyEntries } from '../src/refs/index.js';

const emptyCrossref = { message: { items: [] } };
const emptyDblp = { result: { hits: { '@total': '0' } } };
const emptyAtom = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>';

const entries = (n: number) =>
  parseBib(
    Array.from(
      { length: n },
      (_, i) =>
        `@article{k${i}, author = {Nobody, Ann}, title = {Unique Title Number ${i} About Gardens}, journal = {J}, year = {2020}}`,
    ).join('\n'),
  );

type Behaviour = 'ok' | 'hang' | '503';

function fakeFetch(behaviour: Partial<Record<string, Behaviour>>) {
  const calls: string[] = [];
  const f = ((input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    calls.push(u.host);
    const how = behaviour[u.host] ?? 'ok';
    if (how === 'hang') {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }
    if (how === '503') return Promise.resolve(new Response('down', { status: 503 }));
    if (u.host === 'api.crossref.org') return Promise.resolve(Response.json(emptyCrossref));
    if (u.host === 'dblp.org') return Promise.resolve(Response.json(emptyDblp));
    return Promise.resolve(
      new Response(emptyAtom, { headers: { 'content-type': 'application/atom+xml' } }),
    );
  }) as typeof fetch;
  return { fetch: f, calls };
}

async function settle<T>(p: Promise<T>, limitMs: number): Promise<{ value: T; elapsed: number }> {
  const start = Date.now();
  let done = false;
  const wrapped = p.then((v) => {
    done = true;
    return v;
  });
  while (!done && Date.now() - start <= limitMs) await vi.advanceTimersByTimeAsync(100);
  return { value: await wrapped, elapsed: Date.now() - start };
}

afterEach(() => vi.useRealTimers());

describe('per-host circuit breaker', () => {
  it('asks a hanging host at most twice and finishes 30 entries in under 12 s of fake time', async () => {
    vi.useFakeTimers();
    const f = fakeFetch({ 'dblp.org': 'hang' });
    const { value, elapsed } = await settle(
      verifyEntries(entries(30), { fetch: f.fetch, arxivIntervalMs: 0, retryDelayMs: 0 }),
      60_000,
    );
    expect(value).toHaveLength(30);
    expect(elapsed).toBeLessThan(12_000);
    expect(f.calls.filter((h) => h === 'dblp.org').length).toBeLessThanOrEqual(2);
    // A source outage is never an error for the document: entries are `error` (lookup
    // incomplete), not `not-found`.
    expect(value.every((r) => r.status === 'error')).toBe(true);
    expect(value[0]?.reason).toContain('timed out after 4000 ms');
    expect(value[29]?.reason).toContain('skipped for the rest of this run');
  });

  it('stops asking a host that answers 5xx after two answers', async () => {
    const f = fakeFetch({ 'dblp.org': '503' });
    const results = await verifyEntries(entries(30), {
      fetch: f.fetch,
      arxivIntervalMs: 0,
      retryDelayMs: 0,
    });
    expect(results.every((r) => r.status === 'error')).toBe(true);
    expect(f.calls.filter((h) => h === 'dblp.org').length).toBeLessThanOrEqual(2);
  });

  it('keeps asking a healthy host', async () => {
    const f = fakeFetch({});
    const results = await verifyEntries(entries(10), {
      fetch: f.fetch,
      arxivIntervalMs: 0,
      retryDelayMs: 0,
    });
    expect(results.every((r) => r.status === 'not-found')).toBe(true);
    expect(f.calls.filter((h) => h === 'dblp.org')).toHaveLength(10);
  });

  it('cuts a response that stalls before the first byte at 4 s, not 10 s', async () => {
    vi.useFakeTimers();
    const f = fakeFetch({ 'api.crossref.org': 'hang' });
    const { elapsed } = await settle(
      verifyEntries(entries(1), { fetch: f.fetch, arxivIntervalMs: 0, retryDelayMs: 0 }),
      60_000,
    );
    expect(elapsed).toBeLessThan(5000);
  });
});

describe('concurrent sources and progress', () => {
  it('starts CrossRef and dblp before either answers', async () => {
    const started: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const f = (async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      started.push(u.host);
      await gate;
      return u.host === 'api.crossref.org'
        ? Response.json(emptyCrossref)
        : u.host === 'dblp.org'
          ? Response.json(emptyDblp)
          : new Response(emptyAtom);
    }) as typeof fetch;
    const p = verifyEntries(entries(1), { fetch: f, arxivIntervalMs: 0, concurrency: 1 });
    await new Promise((r) => setTimeout(r, 20));
    // The probe gate lets one request per unproven host through; two hosts in parallel.
    expect(started.sort()).toEqual(['api.crossref.org', 'dblp.org']);
    release();
    await p;
  });

  it('reports progress once per entry', async () => {
    const f = fakeFetch({});
    const seen: [number, number][] = [];
    await verifyEntries(entries(5), {
      fetch: f.fetch,
      arxivIntervalMs: 0,
      onProgress: (done, total) => seen.push([done, total]),
    });
    expect(seen).toEqual([1, 2, 3, 4, 5].map((n) => [n, 5]));
  });
});
