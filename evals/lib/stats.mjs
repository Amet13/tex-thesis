// Small statistics helpers shared by the evals and the reference benchmark.

const Z95 = 1.959963984540054;

/**
 * Wilson score interval for k successes in n trials (default 95%).
 * Returns null when n is 0. Bounds are proportions in [0, 1].
 */
export function wilson(k, n, z = Z95) {
  if (!(n > 0)) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

/** A count with its denominator, its rate and the Wilson interval. */
export function proportion(k, n) {
  const ci = wilson(k, n);
  return { k, n, rate: n > 0 ? k / n : null, low: ci?.low ?? null, high: ci?.high ?? null };
}

/** Quantile by linear interpolation between order statistics (the usual "type 7"). */
export function quantile(values, q) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
