import { describe, expect, it } from 'vitest';
import { toMarkdown } from '../report.mjs';
import { isDetected, score } from '../score.mjs';

const item = (key: string, cls: string, status: string, seconds = 1, extra = {}) => ({
  key,
  class: cls,
  status,
  seconds,
  ...extra,
});

// 10 real works: 7 verified, 1 not-found, 1 unverifiable, 1 error.
const real = [
  ...Array.from({ length: 7 }, (_, i) => item(`r${i}`, 'real', 'verified', 1)),
  item('r7', 'real', 'not-found', 2),
  item('r8', 'real', 'unverifiable', 3),
  item('r9', 'real', 'error', 4),
];
const fabricated = [
  // invented: 3 not-found, 1 verified (a miss), 1 error
  item('i0', 'invented', 'not-found'),
  item('i1', 'invented', 'not-found'),
  item('i2', 'invented', 'not-found'),
  item('i3', 'invented', 'verified'),
  item('i4', 'invented', 'error'),
  // wrong-metadata: 2 mismatch, 2 verified
  item('m0', 'wrong-metadata', 'mismatch'),
  item('m1', 'wrong-metadata', 'mismatch'),
  item('m2', 'wrong-metadata', 'verified'),
  item('m3', 'wrong-metadata', 'verified'),
  // wrong-doi: one carries wrongWork on a "verified-looking" status, one mismatch, one unverifiable
  item('d0', 'wrong-doi', 'mismatch', 1, { wrongWork: { field: 'doi', id: '10.1/x', title: 't' } }),
  item('d1', 'wrong-doi', 'verified', 1, { wrongWork: { field: 'doi', id: '10.1/y', title: 't' } }),
  item('d2', 'wrong-doi', 'unverifiable'),
];

describe('score', () => {
  const s = score([...real, ...fabricated]);

  it('counts class by status', () => {
    expect(s.counts.real).toMatchObject({
      total: 10,
      verified: 7,
      'not-found': 1,
      unverifiable: 1,
      error: 1,
      mismatch: 0,
    });
    expect(s.counts.invented).toMatchObject({ total: 5, 'not-found': 3, verified: 1, error: 1 });
    expect(s.counts['wrong-doi']).toMatchObject({
      total: 3,
      mismatch: 1,
      verified: 1,
      unverifiable: 1,
    });
  });

  it('reports the false not-found rate with its denominator', () => {
    expect(s.metrics.falseNotFoundOnReal).toMatchObject({ k: 1, n: 10, rate: 0.1 });
    expect(s.metrics.falseNotFoundOnReal.low).toBeCloseTo(0.0179, 3);
    expect(s.metrics.falseNotFoundOnReal.high).toBeCloseTo(0.4042, 3);
    expect(s.metrics.lookupIncompleteOnReal).toMatchObject({ k: 1, n: 10 });
  });

  it('computes detection per fabricated class', () => {
    expect(s.metrics.detection.invented).toMatchObject({
      k: 3,
      n: 5,
      rate: 0.6,
      verified: 1,
      undecided: 1,
    });
    expect(s.metrics.detection['wrong-metadata']).toMatchObject({
      k: 2,
      n: 4,
      rate: 0.5,
      verified: 2,
      undecided: 0,
    });
    // wrongWork counts as detected even when the status alone would not; it is not counted as "verified".
    expect(s.metrics.detection['wrong-doi']).toMatchObject({
      k: 2,
      n: 3,
      verified: 0,
      undecided: 1,
    });
  });

  it('computes the share unverifiable over real and over all entries', () => {
    expect(s.metrics.unverifiable.real).toMatchObject({ k: 1, n: 10, rate: 0.1 });
    expect(s.metrics.unverifiable.all).toMatchObject({ k: 2, n: 22 });
  });

  it('computes median, p95 and total seconds per entry', () => {
    // 19 entries took 1 s; the others took 2, 3 and 4 s: total 19 + 9 = 28.
    expect(s.metrics.secondsPerEntry.n).toBe(22);
    expect(s.metrics.secondsPerEntry.total).toBe(28);
    expect(s.metrics.secondsPerEntry.median).toBe(1);
    // p95 sits at position 21 * 0.95 = 19.95 of the sorted timings: 2 + 0.95 * (3 - 2).
    expect(s.metrics.secondsPerEntry.p95).toBeCloseTo(2.95, 10);
  });

  it('rejects unknown classes and statuses', () => {
    expect(() => score([item('x', 'fake', 'verified')])).toThrow(/unknown class/);
    expect(() => score([item('x', 'real', 'fake')])).toThrow(/unknown status/);
  });

  it('isDetected', () => {
    expect(isDetected(item('a', 'invented', 'not-found'))).toBe(true);
    expect(isDetected(item('a', 'invented', 'mismatch'))).toBe(true);
    expect(isDetected(item('a', 'invented', 'verified'))).toBe(false);
    expect(isDetected(item('a', 'invented', 'error'))).toBe(false);
  });

  it('handles an empty class without dividing by zero', () => {
    const t = score(real);
    expect(t.metrics.detection.invented).toMatchObject({ k: 0, n: 0, rate: null });
  });
});

describe('toMarkdown', () => {
  it('renders a table with the counts', () => {
    const s = score([...real, ...fabricated]);
    const md = toMarkdown({
      date: '2026-01-01T00:00:00.000Z',
      overfullVersion: '0.0.0',
      mode: 'live',
      partial: false,
      datasets: { real: { entries: 10 }, fabricated: { entries: 12 } },
      sources: [{ host: 'api.crossref.org', requests: 5, failures: 1, skippedByBreaker: 0 }],
      entries: [{ key: 'r7', class: 'real', status: 'not-found', reason: 'no record' }],
      ...s,
    });
    expect(md).toContain('| real | 10 | 7 | 0 | 1 | 1 | 1 |');
    expect(md).toContain('False "not found" on real works | 10.0%');
    expect(md).toContain('`r7`');
  });
});
