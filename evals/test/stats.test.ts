import { describe, expect, it } from 'vitest';
import { proportion, quantile, wilson } from '../lib/stats.mjs';

describe('wilson', () => {
  it('matches the textbook values', () => {
    // 8 of 10, 95%: 0.4902 to 0.9433 (Wilson 1927; checked against R binom::binom.wilson).
    const ci = wilson(8, 10);
    expect(ci?.low).toBeCloseTo(0.4902, 3);
    expect(ci?.high).toBeCloseTo(0.9433, 3);
  });
  it('has a nonzero upper bound at 0 successes and a nonzero lower bound at n', () => {
    const none = wilson(0, 3);
    expect(none?.low).toBeCloseTo(0, 10);
    expect(none?.high).toBeCloseTo(0.5614, 3);
    const all = wilson(3, 3);
    expect(all?.high).toBeCloseTo(1, 10);
    expect(all?.low).toBeCloseTo(0.4385, 3);
  });
  it('narrows with more trials', () => {
    const a = wilson(5, 10);
    const b = wilson(50, 100);
    expect((b?.high ?? 0) - (b?.low ?? 0)).toBeLessThan((a?.high ?? 0) - (a?.low ?? 0));
  });
  it('is null without trials', () => {
    expect(wilson(0, 0)).toBeNull();
    expect(proportion(0, 0)).toEqual({ k: 0, n: 0, rate: null, low: null, high: null });
  });
  it('proportion carries count, denominator and rate', () => {
    const p = proportion(1, 4);
    expect(p).toMatchObject({ k: 1, n: 4, rate: 0.25 });
    expect(p.low).toBeLessThan(0.25);
    expect(p.high).toBeGreaterThan(0.25);
  });
});

describe('quantile', () => {
  it('interpolates', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([10], 0.95)).toBe(10);
    expect(quantile([1, 2, 3, 4, 5], 0.95)).toBeCloseTo(4.8, 10);
    expect(quantile([], 0.5)).toBeNull();
  });
});
