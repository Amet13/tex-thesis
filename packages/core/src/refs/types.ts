import type { BibEntry } from '../bib/parse.js';
import type { Location } from '../types.js';

export type RefStatus = 'verified' | 'mismatch' | 'not-found' | 'unverifiable' | 'error';

/** Where a record came from. */
export type RefSource =
  | 'doi.org'
  | 'crossref'
  | 'dblp'
  | 'arxiv'
  | 'openalex'
  | 'semanticscholar'
  | 'acl'
  | 'europepmc';

export interface MatchedRecord {
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  doi?: string;
  url?: string;
  type?: string;
}

/** One retraction or withdrawal recorded in CrossRef's `updated-by` field of a work. */
export interface RetractionNotice {
  /** CrossRef's update type: `retraction` or `withdrawal`. */
  kind: 'retraction' | 'withdrawal';
  /** DOI of the work this notice belongs to. */
  doi: string;
  /** DOI of the notice itself, when CrossRef gives one. */
  noticeDoi?: string;
  /** `YYYY-MM-DD` of the notice, when CrossRef gives it. */
  date?: string;
  /** Who asserted it: CrossRef's `source`, e.g. `retraction-watch` or `publisher`. */
  assertedBy?: string;
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
   * Set when the entry's own DOI (rule `reference-doi-wrong-work`) or arXiv id
   * (rule `reference-arxiv-wrong-work`) resolves to a different, identified work:
   * `title` is that other work's title.
   */
  wrongWork?: { field: 'doi' | 'eprint'; id: string; title: string };
  /**
   * With `requireProvenance`: the entry is not verified and was not added with
   * `overfull cite` (no `x-overfull` field). Reported as `reference-unproven`.
   */
  unproven?: boolean;
  /** What was looked up, e.g. `doi:10.1145/359545.359563` or `title:in search of…|2014`. */
  query?: string;
  /** Sources that could not answer (network error, bot wall, rate limit), for `error`. */
  failed?: RefSource[];
  /** Last error per source that could not answer (for `error`, and for `unverifiable` after a partial lookup). */
  failures?: { source: RefSource; reason: string }[];
  /** Sources that answered definitively (searched and found / did not find). */
  searched?: RefSource[];
  /**
   * CrossRef (publisher and Retraction Watch data) records the matched work as retracted or
   * withdrawn (rule `reference-retracted`). Set only for a work matched by DOI.
   */
  retraction?: RetractionNotice;
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
  /**
   * Optional Semantic Scholar API key (sent as `x-api-key`). Without one Semantic Scholar
   * still answers, from a rate limit shared by all keyless users; with one, requests to it
   * are spaced 1.1 s apart (the key's limit is 1 request per second).
   */
  semanticScholarKey?: string;
  cache?: RefCache;
  /**
   * How long cached answers stay valid, in days. A number sets both; defaults:
   * negative answers (DOI missing, no arXiv paper, empty search) 1, records 30.
   * Transport errors (timeouts, 5xx, bot walls) are never cached.
   */
  cacheMaxAgeDays?: number | { negative?: number; positive?: number };
  /**
   * Ignore stored answers and ask the indexes again (CLI `--refresh`). New answers
   * are still written to the cache.
   */
  refresh?: boolean;
  /** Called after each entry is verified (not for skipped or offline runs): `done` of `total`. */
  onProgress?: (done: number, total: number) => void;
  /** Parallel entries (default 4). */
  concurrency?: number;
  /** Total time per request in ms (default 10000); the first byte must arrive within 4000. */
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
  /**
   * Ask CrossRef whether matched works are retracted or withdrawn (rule `reference-retracted`):
   * one extra request per 40 DOIs after the entries are verified, answers kept 1 day. Off by
   * default, so library users see no new request. A failed request leaves results unchanged.
   */
  checkRetractions?: boolean;
  /** Citation keys not to check. */
  ignore?: string[];
  signal?: AbortSignal;
  /** Minimum spacing between arXiv API requests in ms (default 3000, as arXiv asks). */
  arxivIntervalMs?: number;
  /** Base delay before the single retry on 429/5xx when no Retry-After is given (default 1000). */
  retryDelayMs?: number;
  /** Disambiguates title lookups: an author surname and/or publication year. */
  hint?: LookupHint;
  /** `lookup` of a title: total time budget across sources in ms (default 10000). */
  titleBudgetMs?: number;
  /**
   * `lookup` reports which indexes really answered and which failed (a bot
   * wall or rate limit is a failure even when HTTP succeeded), once, at the end.
   */
  onSearch?: (outcome: {
    searched: RefSource[];
    failures: { source: RefSource; reason: string }[];
  }) => void;
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
