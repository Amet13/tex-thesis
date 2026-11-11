/**
 * Compares one bib entry with one index record and decides whether the record
 * confirms the entry (verified), contradicts it (mismatch) or is unrelated.
 *
 * Thresholds (tuned on test/fixtures/refs): a title is a strong match at
 * Dice ≥ 0.9 (or a main-title/subtitle match); 0.75–0.9 with the same authors
 * and year is "similar but different".
 */

import { parseNames } from '../bib/names.js';
import type { BibEntry } from '../bib/parse.js';
import { foldName, namesMatch, stripMarkup, titleSimilarity } from './normalize.js';
import type { RefDifference, WorkRecord } from './types.js';

export const STRONG_TITLE = 0.9;
const SIMILAR_TITLE = 0.75;
/** Below this, a record reached through the entry's own DOI is a different work. */
const DIFFERENT_WORK_TITLE = 0.6;

export interface BibFacts {
  title?: string;
  /** Folded surnames of personal authors (corporate authors excluded). */
  surnames: string[];
  /** First listed author is personal (not `{ATLAS Collaboration}`). */
  firstIsPersonal: boolean;
  authorText?: string;
  year?: number;
}

export type Verdict = 'verified' | 'mismatch' | 'none';

export interface Assessment {
  record: WorkRecord;
  verdict: Verdict;
  titleScore: number;
  /** Fraction of the shorter author list found in the other; null when not comparable. */
  authorOverlap: number | null;
  yearDiff: number | null;
  /** For mismatch: what differs. For verified: minor notes (year off by one). */
  differences: RefDifference[];
  /** The entry's own DOI resolves to an unrelated work. */
  differentWork: boolean;
  score: number;
}

export function bibYear(entry: BibEntry): number | undefined {
  const m = /\b(1[5-9]\d\d|20\d\d)\b/.exec(entry.fields.year ?? entry.fields.date ?? '');
  return m ? Number(m[1]) : undefined;
}

export function bibFacts(entry: BibEntry): BibFacts {
  const people = parseNames(entry.fields.author ?? entry.fields.editor);
  const facts: BibFacts = {
    surnames: people.filter((p) => !p.corporate).map((p) => foldName(p.family)),
    firstIsPersonal: people.length > 0 && !people[0]?.corporate,
  };
  if (entry.fields.title) facts.title = entry.fields.title;
  const authorText = entry.fields.author ?? entry.fields.editor;
  if (authorText) facts.authorText = authorText;
  const year = bibYear(entry);
  if (year !== undefined) facts.year = year;
  return facts;
}

function recordNameMatches(surname: string, a: WorkRecord['authors'][number]): boolean {
  // Given/family swaps are common for East Asian names; accept either.
  return (
    namesMatch(surname, foldName(a.family)) || (!!a.given && namesMatch(surname, foldName(a.given)))
  );
}

function authorOverlap(facts: BibFacts, record: WorkRecord): number | null {
  if (!facts.surnames.length || !record.authors.length) return null;
  const matched = facts.surnames.filter((s) => record.authors.some((a) => recordNameMatches(s, a)));
  return matched.length / Math.min(facts.surnames.length, record.authors.length);
}

/** The bib's first author is among the record's first two authors (equal-contribution swaps). */
function firstAuthorOk(facts: BibFacts, record: WorkRecord): boolean | null {
  const first = facts.surnames[0];
  if (!facts.firstIsPersonal || !first || !record.authors.length) return null;
  return record.authors.slice(0, 2).some((a) => recordNameMatches(first, a));
}

function yearDiff(facts: BibFacts, record: WorkRecord): number | null {
  if (facts.year === undefined || !record.years.length) return null;
  return Math.min(...record.years.map((y) => Math.abs(y - (facts.year as number))));
}

function recordAuthorText(record: WorkRecord, max = 3): string {
  const names = record.authors
    .slice(0, max)
    .map((a) => (a.given ? `${a.given} ${a.family}` : a.family));
  return names.join(', ') + (record.authors.length > max ? ', …' : '');
}

function closestYear(facts: BibFacts, record: WorkRecord): number | undefined {
  if (facts.year === undefined) return record.years[0];
  return [...record.years].sort(
    (a, b) => Math.abs(a - (facts.year as number)) - Math.abs(b - (facts.year as number)),
  )[0];
}

interface Signals {
  titleScore: number;
  overlap: number | null;
  firstOk: boolean | null;
  years: number | null;
}

function differencesFor(facts: BibFacts, record: WorkRecord, s: Signals): RefDifference[] {
  const diffs: RefDifference[] = [];
  if (s.titleScore < STRONG_TITLE && facts.title) {
    diffs.push({ field: 'title', bib: facts.title, record: stripMarkup(record.title) });
  }
  if (s.overlap === 0 || s.firstOk === false) {
    diffs.push({ field: 'author', bib: facts.authorText ?? '', record: recordAuthorText(record) });
  }
  if (s.years !== null && s.years > 1) {
    diffs.push({
      field: 'year',
      bib: String(facts.year),
      record: String(closestYear(facts, record)),
    });
  }
  return diffs;
}

function verdictFor(s: Signals, identified: boolean): { verdict: Verdict; differentWork: boolean } {
  const authorsConflict = s.overlap === 0 || s.firstOk === false;
  const yearConflict = s.years !== null && s.years > 1;
  if (s.titleScore >= STRONG_TITLE) {
    // Same title, other authors *and* another year: a different work that shares the title.
    if (!identified && authorsConflict && yearConflict)
      return { verdict: 'none', differentWork: false };
    return {
      verdict: authorsConflict || yearConflict ? 'mismatch' : 'verified',
      differentWork: false,
    };
  }
  const sameAuthors = s.overlap !== null && s.overlap > 0 && s.firstOk !== false;
  if (s.titleScore >= SIMILAR_TITLE && sameAuthors && !yearConflict) {
    return { verdict: 'mismatch', differentWork: false };
  }
  if (!identified) return { verdict: 'none', differentWork: false };
  // Reached through the entry's own DOI / arXiv id: the record *is* what the entry points to.
  const differentWork = s.titleScore < DIFFERENT_WORK_TITLE || !sameAuthors;
  return { verdict: 'mismatch', differentWork };
}

/**
 * Assesses one record against an entry. `identified` means the record was
 * reached through the entry's own DOI or arXiv id rather than a search.
 */
/** Record types that are often later re-deposits (posted copies, components), never the original. */
const REDEPOSIT_TYPES = new Set(['posted-content', 'preprint', 'other', 'component', 'dataset']);

/**
 * A posted copy that appeared after the entry's year says nothing about the
 * original publication (e.g. a 2025 re-deposit of a 2017 paper). Using it would
 * report a bogus "year differs", so a search hit like that is ignored.
 */
function isLaterRedeposit(facts: BibFacts, record: WorkRecord, identified: boolean): boolean {
  if (identified || facts.year === undefined || !record.years.length) return false;
  return REDEPOSIT_TYPES.has(record.type ?? '') && Math.min(...record.years) > facts.year + 1;
}

export function assess(facts: BibFacts, record: WorkRecord, identified: boolean): Assessment {
  if (isLaterRedeposit(facts, record, identified)) {
    return {
      record,
      verdict: 'none',
      titleScore: 0,
      authorOverlap: null,
      yearDiff: null,
      differences: [],
      differentWork: false,
      score: 0,
    };
  }
  const signals: Signals = {
    titleScore: facts.title ? titleSimilarity(facts.title, record.title) : identified ? 1 : 0,
    overlap: authorOverlap(facts, record),
    firstOk: firstAuthorOk(facts, record),
    years: yearDiff(facts, record),
  };
  const { verdict, differentWork } = verdictFor(signals, identified);
  let differences: RefDifference[] = [];
  if (verdict === 'mismatch') differences = differencesFor(facts, record, signals);
  else if (verdict === 'verified' && signals.years === 1) {
    differences = [
      { field: 'year', bib: String(facts.year), record: String(closestYear(facts, record)) },
    ];
  }
  const score =
    signals.titleScore +
    0.3 * (signals.overlap ?? 0.5) -
    0.05 * Math.min(signals.years ?? 0, 10) +
    (record.doi ? 0.01 : 0);
  return {
    record,
    verdict,
    titleScore: signals.titleScore,
    authorOverlap: signals.overlap,
    yearDiff: signals.years,
    differences,
    differentWork,
    score,
  };
}

/** Best assessment: any verified beats any mismatch; ties broken by score. */
export function bestAssessment(list: Assessment[]): Assessment | undefined {
  const rank = (a: Assessment) => (a.verdict === 'verified' ? 2 : a.verdict === 'mismatch' ? 1 : 0);
  return [...list]
    .filter((a) => a.verdict !== 'none')
    .sort((a, b) => rank(b) - rank(a) || b.score - a.score)[0];
}
