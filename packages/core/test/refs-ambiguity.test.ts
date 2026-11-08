/** Title lookups must never silently pick one of several works with the same title. */
import { describe, expect, it } from 'vitest';
import { pickTitleMatch } from '../src/refs/lookup.js';
import type { WorkRecord } from '../src/refs/types.js';

const rec = (over: Partial<WorkRecord>): WorkRecord => ({
  source: 'crossref',
  title: 'Literate Programming',
  authors: [{ family: 'Knuth', given: 'Donald E.' }],
  years: [1984],
  type: 'journal-article',
  ...over,
});

const knuth = rec({ doi: '10.1093/comjnl/27.2.97', venue: 'The Computer Journal' });
const klein = rec({
  authors: [{ family: 'Klein', given: 'Andreas' }],
  years: [2013],
  type: 'book-chapter',
  doi: '10.1007/978-1-4471-5079-4_20',
});

describe('pickTitleMatch ambiguity', () => {
  it('a short unhinted title is ambiguous even with one match', () => {
    const r = pickTitleMatch('Literate programming', [klein]);
    expect(r && 'ambiguous' in r).toBe(true);
  });

  it('a short title with an author hint resolves to that author', () => {
    const r = pickTitleMatch('Literate programming', [knuth, klein], { author: 'Knuth' });
    expect(r && 'record' in r && r.record.doi).toBe('10.1093/comjnl/27.2.97');
  });

  it('a year hint filters candidates', () => {
    const r = pickTitleMatch('Literate programming', [knuth, klein], { year: 2013 });
    expect(r && 'record' in r && r.record.doi).toBe('10.1007/978-1-4471-5079-4_20');
  });

  it('two contemporaneous published works with one title are ambiguous', () => {
    const a = rec({ title: 'Consensus in the Cloud: Paxos Systems Demystified', years: [2016] });
    const b = rec({
      title: 'Consensus in the Cloud: Paxos Systems Demystified',
      authors: [{ family: 'Ailijiang' }],
      years: [2016],
      doi: '10.1/x',
    });
    const r = pickTitleMatch('Consensus in the Cloud: Paxos Systems Demystified', [a, b]);
    expect(r && 'ambiguous' in r && r.ambiguous.length).toBe(2);
  });

  it('later same-title chapters do not make the original ambiguous', () => {
    const original = rec({
      title: 'Language Models are Few-Shot Learners',
      authors: [{ family: 'Brown' }],
      years: [2020],
      source: 'arxiv',
      type: 'arxiv',
    });
    const reuse = rec({
      title: 'Language Models are Few-Shot Learners',
      authors: [{ family: 'Malakar' }],
      years: [2026],
      type: 'book-chapter',
    });
    const r = pickTitleMatch('Language Models are Few-Shot Learners', [original, reuse]);
    expect(r && 'record' in r && r.record.authors[0]?.family).toBe('Brown');
  });

  it('a hint that matches nothing returns null', () => {
    expect(pickTitleMatch('Literate programming', [knuth], { author: 'Turing' })).toBeNull();
  });
});
