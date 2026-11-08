import type { BibEntry } from '../bib/parse.js';
import type { Location } from '../types.js';

export type RefStatus = 'verified' | 'mismatch' | 'not-found' | 'unverifiable' | 'error';

/** Where a record came from. */
export type RefSource = 'doi.org' | 'crossref' | 'dblp' | 'arxiv' | 'openalex';

export interface MatchedRecord {
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  doi?: string;
  url?: string;
  type?: string;
}

export interface RefDifference {
  field: 'title' | 'author' | 'year' | 'doi' | 'eprint';
  bib: string;
  record: string;
}

export interface RefResult {
  key: string;
  status: RefStatus;
  source?: RefSource;
  matched?: MatchedRecord;
  /** For `mismatch`; for `verified`, minor notes (year off by one). */
  differences?: RefDifference[];
  reason?: string;
  /** What was looked up, e.g. `doi:10.1145/359545.359563` or `title:in search of…|2014`. */
  query?: string;
  /** Sources that answered definitively (searched and found / did not find). */
  searched?: RefSource[];
  location?: Location;
}

/** Any key/value store; values are JSON-serializable. May be async. */
export interface RefCache {
  get(key: string): unknown | Promise<unknown>;
  set(key: string, value: unknown): void | Promise<void>;
}

export interface RefsOptions {
  /** Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** Contact address for CrossRef's polite pool. */
  mailto?: string;
  /** Enables OpenAlex as a last-resort title search. */
  openalexKey?: string;
  cache?: RefCache;
  /** Parallel entries (default 4). */
  concurrency?: number;
  /** Per-request timeout in ms (default 10000). */
  timeoutMs?: number;
  offline?: boolean;
  /** Citation keys not to check. */
  ignore?: string[];
  signal?: AbortSignal;
  /** Minimum spacing between arXiv API requests in ms (default 3000, as arXiv asks). */
  arxivIntervalMs?: number;
  /** Base delay before the single retry on 429/5xx when no Retry-After is given (default 1000). */
  retryDelayMs?: number;
  /** Disambiguates title lookups: an author surname and/or publication year. */
  hint?: LookupHint;
}

export interface LookupHint {
  /** Any author's surname (or full name; the last word is used). */
  author?: string;
  year?: number;
}

/** One possible work for an ambiguous title query. */
export interface LookupCandidate {
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;
  source: RefSource;
}

export interface LookupResult {
  entry: BibEntry;
  source: RefSource;
  /** 0–1. */
  confidence: number;
}

/** A normalized record from any index. JSON-serializable (cached). */
export interface WorkRecord {
  source: RefSource;
  title: string;
  authors: { given?: string; family: string }[];
  /** Every year the record carries (print, online, issued, preprint v1, latest version). */
  years: number[];
  venue?: string;
  doi?: string;
  url?: string;
  /** Index-specific type (`journal-article`, `proceedings-article`, `arxiv`, `Conference and Workshop Papers`…). */
  type?: string;
  arxivId?: string;
  citations?: number;
}
