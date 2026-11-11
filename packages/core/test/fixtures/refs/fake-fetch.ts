/**
 * Fixture-backed fetch for reference tests. Replays responses recorded by
 * record.mjs (http.json). Unknown URLs are collected in `misses` and answered
 * with a network error, so a test can assert that nothing was missing.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Recorded {
  status: number;
  contentType: string;
  body: string;
  retryAfter?: string;
}

interface Store {
  requests: Record<string, Recorded>;
  hostFallbacks: Record<string, Recorded>;
}

const here = dirname(fileURLToPath(import.meta.url));

function fixturePath(name: string): string {
  return join(here, name);
}

export function readFixture(name: string): string {
  return readFileSync(fixturePath(name), 'utf8');
}

let store: Store | undefined;
/**
 * http.json (record.mjs) plus http-sources.json (record-sources.mjs: ACL Anthology, Europe PMC,
 * Semantic Scholar, CrossRef retraction data), merged. The second file is optional.
 */
function loadStore(): Store {
  if (store) return store;
  const main = JSON.parse(readFixture('http.json')) as Store;
  let extra: Partial<Store> = {};
  try {
    extra = JSON.parse(readFixture('http-sources.json')) as Partial<Store>;
  } catch {
    // not recorded yet
  }
  store = {
    requests: { ...main.requests, ...(extra.requests ?? {}) },
    hostFallbacks: { ...main.hostFallbacks, ...(extra.hostFallbacks ?? {}) },
  };
  return store;
}

/** Same normalization as record.mjs: Accept + URL without mailto/api_key. */
export function fixtureKey(url: string, accept: string): string {
  const u = new URL(url);
  u.searchParams.delete('mailto');
  u.searchParams.delete('api_key');
  return `${accept} ${u.toString()}`;
}

function toResponse(r: Recorded): Response {
  const headers: Record<string, string> = { 'content-type': r.contentType };
  if (r.retryAfter) headers['retry-after'] = r.retryAfter;
  return new Response(r.status === 204 ? null : r.body, { status: r.status, headers });
}

export interface FakeFetch {
  fetch: typeof fetch;
  calls: string[];
  misses: string[];
}

function acceptOf(init?: RequestInit): string {
  const h = init?.headers as Record<string, string> | undefined;
  return h?.Accept ?? '*/*';
}

/** Replays recorded responses. */
export function recordedFetch(): FakeFetch {
  const { requests, hostFallbacks } = loadStore();
  const calls: string[] = [];
  const misses: string[] = [];
  const fn = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const key = fixtureKey(url, acceptOf(init));
    const hit = requests[key] ?? hostFallbacks[new URL(url).host];
    if (!hit) {
      misses.push(key);
      throw new TypeError(`fetch failed (no fixture for ${key})`);
    }
    return toResponse(hit);
  };
  return { fetch: fn as typeof fetch, calls, misses };
}

type Handler = (url: URL, accept: string) => Response | Promise<Response>;

/** A fetch answering from a handler function (synthetic scenarios). */
export function handlerFetch(handler: Handler): FakeFetch & { maxInFlight: () => number } {
  const calls: string[] = [];
  let inFlight = 0;
  let max = 0;
  const fn = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    inFlight++;
    max = Math.max(max, inFlight);
    try {
      await new Promise((r) => setTimeout(r, 5));
      return await handler(new URL(url), acceptOf(init));
    } finally {
      inFlight--;
    }
  };
  return { fetch: fn as typeof fetch, calls, misses: [], maxInFlight: () => max };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
