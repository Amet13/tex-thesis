// Scoring for the reference-check benchmark. Pure functions: no network, no files.
//
// An item is { key, class, status, seconds?, wrongWork? }:
//   class   x-bench label of the entry: real | invented | wrong-metadata | wrong-doi
//   status  what the check answered: verified | mismatch | not-found | unverifiable | error
//   wrongWork  set by the check when the entry's own DOI resolves to a different work
import { proportion, quantile } from '../../evals/lib/stats.mjs';

export const STATUSES = ['verified', 'mismatch', 'not-found', 'unverifiable', 'error'];
export const FABRICATED = ['invented', 'wrong-metadata', 'wrong-doi'];
export const CLASSES = ['real', ...FABRICATED];

/** A fabricated entry counts as detected when the check reports it: not found, a mismatch, or a DOI of another work. */
export function isDetected(item) {
  return item.status === 'not-found' || item.status === 'mismatch' || Boolean(item.wrongWork);
}

export function score(items) {
  const counts = Object.fromEntries(
    CLASSES.map((c) => [c, { total: 0, ...Object.fromEntries(STATUSES.map((s) => [s, 0])) }]),
  );
  for (const it of items) {
    const row = counts[it.class];
    if (!row) throw new Error(`unknown class "${it.class}" for ${it.key}`);
    if (!STATUSES.includes(it.status))
      throw new Error(`unknown status "${it.status}" for ${it.key}`);
    row.total++;
    row[it.status]++;
  }
  const real = items.filter((i) => i.class === 'real');
  const detection = {};
  for (const c of FABRICATED) {
    const rows = items.filter((i) => i.class === c);
    const detected = rows.filter(isDetected);
    detection[c] = {
      ...proportion(detected.length, rows.length),
      // Entries the check passed as verified: the failures that matter.
      verified: rows.filter((i) => i.status === 'verified' && !i.wrongWork).length,
      // Entries it could not decide (no scholarly source answered, or the type is not checkable).
      undecided: rows.filter((i) => i.status === 'unverifiable' || i.status === 'error').length,
    };
  }
  const secs = items.map((i) => i.seconds).filter((s) => typeof s === 'number');
  return {
    counts,
    metrics: {
      // Real works the check called "not found". The number that matters most.
      falseNotFoundOnReal: proportion(
        real.filter((i) => i.status === 'not-found').length,
        real.length,
      ),
      // Real works that were found but flagged as a mismatch.
      falseMismatchOnReal: proportion(
        real.filter((i) => i.status === 'mismatch').length,
        real.length,
      ),
      // Real works the check could not decide because an index was unreachable.
      lookupIncompleteOnReal: proportion(
        real.filter((i) => i.status === 'error').length,
        real.length,
      ),
      detection,
      unverifiable: {
        real: proportion(real.filter((i) => i.status === 'unverifiable').length, real.length),
        all: proportion(items.filter((i) => i.status === 'unverifiable').length, items.length),
      },
      secondsPerEntry: {
        n: secs.length,
        median: quantile(secs, 0.5),
        p95: quantile(secs, 0.95),
        total: secs.reduce((a, b) => a + b, 0),
      },
    },
  };
}
