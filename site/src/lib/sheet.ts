/**
 * Renders an Overfull Report as a report sheet (HTML string). Used at
 * build time for the landing page sample and in the browser on /check/, so
 * both look identical. Everything user-supplied is escaped.
 */
import type { CheckResult, Problem, Report, Severity } from '@overfull/core';

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escapes text and turns `backticks` into <code>. */
export function inline(s: unknown): string {
  return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
}

const CHECK_NAMES: Record<string, string> = {
  build: 'Build',
  output: 'Output',
  references: 'References',
  accessibility: 'Accessibility',
  venue: 'Venue',
};

const STAMP: Record<Report['status'], string> = {
  pass: 'OK to print',
  warn: 'OK with corrections',
  fail: 'Revised proof required',
  skipped: 'Nothing to proof',
};

const STATUS_WORD: Record<string, string> = {
  pass: 'pass',
  warn: 'warn',
  fail: 'fail',
  skipped: 'skipped',
};
const SEV_WORD: Record<Severity, string> = { error: 'error', warning: 'warning', info: 'note' };

export function locationText(p: Problem): string {
  const l = p.location;
  if (!l) return '';
  const parts: string[] = [];
  if (l.file) parts.push(l.line ? `${l.file}:${l.line}` : l.file);
  else if (l.line) parts.push(`line ${l.line}`);
  if (l.page) parts.push(`p. ${l.page}`);
  return parts.join(' · ');
}

function problemHtml(p: Problem, opts: SheetOptions): string {
  const loc = locationText(p);
  const ruleLink = opts.ruleHref
    ? `<a href="${esc(opts.ruleHref(p.rule))}">${esc(p.rule)}</a>`
    : esc(p.rule);
  return `<li class="sheet-problem sev-${esc(p.severity)}">
  <div class="sheet-problem-head">
    <span class="sev-tag">${SEV_WORD[p.severity] ?? esc(p.severity)}</span>
    <span class="sheet-msg">${inline(p.message)}${p.related ? ` <span class="sheet-related">+${p.related} follow-on</span>` : ''}</span>
  </div>
  <div class="sheet-meta">${loc ? `<span class="sheet-loc">${esc(loc)}</span>` : ''}<span class="sheet-rule">${ruleLink}</span></div>
  ${p.detail ? `<p class="sheet-detail">${inline(p.detail)}</p>` : ''}
  ${p.fix ? `<p class="sheet-fix"><span class="caret" aria-hidden="true">‸</span><span class="sr-only">Fix: </span>${inline(p.fix)}</p>` : ''}
  ${p.evidence ? `<details class="sheet-evidence"><summary>Evidence</summary><pre tabindex="0"><code>${esc(p.evidence)}</code></pre></details>` : ''}
</li>`;
}

function counts(c: CheckResult): string {
  const e = c.problems.filter((p) => p.severity === 'error').length;
  const w = c.problems.filter((p) => p.severity === 'warning').length;
  const i = c.problems.filter((p) => p.severity === 'info').length;
  const bits: string[] = [];
  if (e) bits.push(`${e} error${e > 1 ? 's' : ''}`);
  if (w) bits.push(`${w} warning${w > 1 ? 's' : ''}`);
  if (i) bits.push(`${i} note${i > 1 ? 's' : ''}`);
  return bits.join(', ');
}

export interface SheetOptions {
  /** Link rule ids to their documentation page. */
  ruleHref?: (rule: string) => string;
  /** Heading level for check names (default 3). */
  headingLevel?: 2 | 3 | 4;
  /** Problems shown per check before folding the rest (default: all). */
  limit?: number;
}

export function renderSheet(report: Report, opts: SheetOptions = {}): string {
  const h = `h${opts.headingLevel ?? 3}`;
  const checks = report.checks
    .map((c, i) => {
      const order = ['build', 'output', 'references', 'accessibility', 'venue'].indexOf(c.check);
      const num = order >= 0 ? order + 1 : i + 1;
      const summary =
        c.status === 'skipped'
          ? (c.skippedReason ?? 'Skipped')
          : (c.summary ?? (counts(c) || 'No problems found'));
      const sorted = [...c.problems].sort((a, b) => sevRank(a.severity) - sevRank(b.severity));
      const shown = opts.limit ? sorted.slice(0, opts.limit) : sorted;
      const rest = sorted.length - shown.length;
      return `<section class="sheet-check st-${esc(c.status)}" aria-labelledby="sheet-${esc(c.check)}">
  <div class="sheet-check-head">
    <span class="sheet-num" aria-hidden="true">${num}</span>
    <${h} id="sheet-${esc(c.check)}" class="sheet-check-name">${esc(CHECK_NAMES[c.check] ?? c.check)}</${h}>
    <span class="sheet-status"><span class="sr-only">Status: </span>${STATUS_WORD[c.status] ?? esc(c.status)}</span>
    <span class="sheet-summary">${inline(summary)}</span>
  </div>
  ${shown.length ? `<ul class="sheet-problems">${shown.map((p) => problemHtml(p, opts)).join('')}</ul>` : ''}
  ${rest > 0 ? `<p class="sheet-more">${rest} more in the full report.</p>` : ''}
</section>`;
    })
    .join('\n');
  return `<div class="sheet" data-status="${esc(report.status)}">
  <header class="sheet-head">
    <div class="sheet-title">
      <span class="sheet-kicker">Overfull report</span>
      <span class="sheet-target">${esc(report.target ?? 'untitled')}</span>
    </div>
    <div class="sheet-stamp stamp-${esc(report.status)}"><span class="sr-only">Overall: </span>${esc(STAMP[report.status])}</div>
    <div class="sheet-tool">overfull ${esc(report.version)}</div>
  </header>
  ${checks}
</div>`;
}

function sevRank(s: Severity): number {
  return s === 'error' ? 0 : s === 'warning' ? 1 : 2;
}
