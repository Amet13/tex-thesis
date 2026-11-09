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
  /**
   * Set when the entry's own DOI resolves to a different, identified work (rule
   * `reference-doi-wrong-work`): `title` is that other work's title.
   */
  wrongWork?: { field: 'doi'; id: string; title: string };
  /**
   * With `requireProvenance`: the entry is not verified and was not added with
   * `overfull cite` (no `x-overfull` field). Reported as `reference-unproven`.
   */
  unproven?: boolean;
  /** What was looked up, e.g. `doi:10.1145/359545.359563` or `title:in search of…|2014`. */
  query?: string;
  /** Sources that could not answer (network error, bot wall, rate limit), for `error`. */
  failed?: RefSource[];
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
  /**
   * Enables OpenAlex as a last-resort title search. Without a key OpenAlex is still
   * asked (keyless, per-IP daily budget) when dblp could not answer.
   */
  openalexKey?: string;
  cache?: RefCache;
  /**
   * How long cached answers stay valid, in days. A number sets both; defaults:
   * negative answers (DOI missing, no arXiv paper, empty search) 30, records 180.
   */
  cacheMaxAgeDays?: number | { negative?: number; positive?: number };
  /** Parallel entries (default 4). */
  concurrency?: number;
  /** Per-request timeout in ms (default 10000). */
  timeoutMs?: number;
  offline?: boolean;
  /**
   * Allow-list of indexes to query (default: all). The browser check passes
   * `['crossref', 'doi.org']` because arXiv and dblp send no CORS headers. A required
   * source left out here does not block `not-found`; the reason names what was skipped.
   */
  sources?: RefSource[];
  /**
   * Guardrail against hand-written entries (config `references.requireCite`): an entry
   * that is not `verified` must carry `x-overfull = {cite …}` from `overfull cite`, or it
   * is reported as `reference-unproven` (error). Websites, software and standards, which
   * `overfull cite` cannot add, are exempt.
   */
  requireProvenance?: boolean;
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
