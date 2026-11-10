import type { CheckResult, Problem, Report } from '../types.js';

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

function ordered<T extends object>(obj: T, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

function problem(p: Problem): Partial<Problem> {
  const o = ordered(p, [
    'rule',
    'check',
    'severity',
    'message',
    'location',
    'detail',
    'fix',
    'related',
    'evidence',
    'data',
  ]);
  if (p.location) o.location = ordered(p.location, ['file', 'line', 'page']);
  if (p.data) o.data = sortKeys(p.data) as Record<string, unknown>;
  return o;
}

function check(c: CheckResult): Partial<CheckResult> {
  const o = ordered(c, ['check', 'status', 'summary', 'skippedReason', 'stats', 'problems']);
  if (c.stats) o.stats = sortKeys(c.stats) as Record<string, number>;
  o.problems = c.problems.map((p) => problem(p) as Problem);
  return o;
}

/** Pretty JSON of the `Report`, with a stable key order. */
export function formatJson(report: Report): string {
  const o = ordered(report, ['tool', 'version', 'target', 'assumed', 'status', 'checks']);
  if (report.assumed) o.assumed = sortKeys(report.assumed) as Report['assumed'];
  o.checks = report.checks.map((c) => check(c) as CheckResult);
  return `${JSON.stringify(o, null, 2)}\n`;
}
