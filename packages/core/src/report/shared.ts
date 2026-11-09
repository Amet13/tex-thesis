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

/**
 * Whitespace the GitHub Actions runner trims (.NET `TrimStart`) before it looks
 * for a workflow command: every Unicode space, not just blanks and tabs.
 */
export const RUNNER_WHITESPACE =
  '[\\s\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff\\f\\v]';

/** C0/C1 controls, DEL, and bidirectional overrides/isolates (Trojan Source). */
const UNSAFE_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/**
 * Makes user-derived text (from .tex/.bib/log content) safe for a single output line:
 * line breaks become spaces; other control characters (ESC, NUL, C1 controls such as
 * U+009B CSI) and bidirectional overrides are removed, so the text can neither start a
 * new line (a GitHub workflow command such as `::warning`), emit terminal escape
 * sequences, nor reorder what a reader sees.
 */
export function oneLine(s: string): string {
  return s.replace(/[\r\n\u0085  ]+/g, ' ').replace(UNSAFE_CHARS, '');
}

/** Splits user-derived multi-line text into lines that are each safe (see `oneLine`). */
export function safeLines(s: string): string[] {
  return s.split(/\r\n|[\r\n\u0085  ]/).map(oneLine);
}

const COMMAND_AT_LINE_START = new RegExp(
  `(^|[\\r\\n])(${RUNNER_WHITESPACE}*?)(::|##\\[)`,
  'g',
);

/**
 * Last line of defence for text printed to CI logs: no line may start with `::` (or
 * `##[`), which GitHub Actions would execute as a workflow command. The runner splits
 * lines at CR as well as LF and trims all Unicode whitespace before matching, so a
 * zero-width space (not whitespace to .NET) is put right before the marker.
 */
export function neutralizeWorkflowCommands(text: string): string {
  // Repeat until stable: a match consumes the terminator that may start the next one.
  let prev: string;
  let out = text;
  do {
    prev = out;
    out = out.replace(COMMAND_AT_LINE_START, '$1$2​$3');
  } while (out !== prev);
  return out;
}
