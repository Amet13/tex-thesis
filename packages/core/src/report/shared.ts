import {
  CHECK_IDS,
  type CheckResult,
  type Location,
  type Problem,
  type Report,
  type Severity,
} from '../types.js';

export const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function formatLocation(loc: Location | undefined): string {
  if (!loc) return '';
  if (loc.file) return loc.line ? `${loc.file}:${loc.line}` : loc.file;
  if (loc.page) return `p.${loc.page}`;
  return '';
}

/** Problems from all checks, sorted by severity, check order, then location. */
export function sortedProblems(report: Report): Problem[] {
  const checkIndex = (c: string) => CHECK_IDS.indexOf(c as (typeof CHECK_IDS)[number]);
  return report.checks
    .flatMap((c) => c.problems)
    .map((p, i) => ({ p, i }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.p.severity] - SEVERITY_ORDER[b.p.severity] ||
        checkIndex(a.p.check) - checkIndex(b.p.check) ||
        (a.p.location?.file ?? '').localeCompare(b.p.location?.file ?? '') ||
        (a.p.location?.line ?? 0) - (b.p.location?.line ?? 0) ||
        (a.p.location?.page ?? 0) - (b.p.location?.page ?? 0) ||
        a.i - b.i,
    )
    .map(({ p }) => p);
}

export interface Tally {
  errors: number;
  warnings: number;
  infos: number;
  passed: number;
  skipped: number;
}

export function tally(report: Report): Tally {
  const all = report.checks.flatMap((c) => c.problems);
  return {
    errors: all.filter((p) => p.severity === 'error').length,
    warnings: all.filter((p) => p.severity === 'warning').length,
    infos: all.filter((p) => p.severity === 'info').length,
    passed: report.checks.filter((c) => c.status === 'pass').length,
    skipped: report.checks.filter((c) => c.status === 'skipped').length,
  };
}

/** One-line summary for a check: its own summary, skip reason, or a problem count. */
export function checkLine(c: CheckResult): string {
  if (c.status === 'skipped') return `skipped: ${c.skippedReason ?? 'not run'}`;
  if (c.summary) return c.summary;
  const n = c.problems.filter((p) => p.severity !== 'info').length;
  if (n === 0) return 'no problems';
  return `${n} problem${n === 1 ? '' : 's'}`;
}

export function tallyLine(t: Tally): string {
  const parts = [`${t.errors} to fix`, `${t.warnings} to review`];
  if (t.infos) parts.push(`${t.infos} note${t.infos === 1 ? '' : 's'}`);
  parts.push(`${t.passed} passed`);
  if (t.skipped) parts.push(`${t.skipped} skipped`);
  return parts.join(' · ');
}
