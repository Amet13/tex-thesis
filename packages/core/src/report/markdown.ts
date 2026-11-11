import type { Problem, Report } from '../types.js';
import {
  checkLine,
  formatLocation,
  neutralizeWorkflowCommands,
  nothingCheckedLine,
  oneLine,
  sortedProblems,
  tally,
  tallyLine,
} from './shared.js';

const STATUS_TEXT = { pass: 'pass', warn: 'warn', fail: 'fail', skipped: 'skipped' } as const;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escapes plain text for Markdown (and HTML), collapsing newlines. */
export function escapeMarkdown(s: string): string {
  return escapeHtml(oneLine(s)).replace(/([\\`*_{}[\]|~#])/g, '\\$1');
}

/** Renders text whose `backtick` spans are code: code becomes <code>, the rest is escaped. */
function inline(s: string): string {
  return oneLine(s)
    .split('`')
    .map((part, i) =>
      i % 2 === 1
        ? `<code>${escapeHtml(part).replace(/\|/g, '&#124;')}</code>`
        : escapeMarkdown(part),
    )
    .join('');
}

function problemItem(p: Problem): string {
  const loc = formatLocation(p.location);
  const head = `- **${p.severity}**${loc ? ` <code>${escapeHtml(oneLine(loc))}</code>` : ''} ${escapeMarkdown(p.message)} <sub>${escapeHtml(oneLine(p.rule))}</sub>`;
  const sub: string[] = [];
  if (p.detail) sub.push(`  - Why: ${inline(p.detail)}`);
  if (p.fix) sub.push(`  - Fix: ${inline(p.fix)}`);
  return [head, ...sub].join('\n');
}

/** Markdown for GitHub job summaries and PR comments. */
export function formatMarkdown(report: Report): string {
  const out: string[] = [];
  const target = report.target ? ` — ${escapeMarkdown(report.target)}` : '';
  const word = report.status === 'skipped' ? 'NOTHING CHECKED' : report.status.toUpperCase();
  out.push(`## Overfull preflight: ${word}${target}`, '');
  const why = nothingCheckedLine(report);
  if (why) out.push(inline(why), '');
  out.push('| Check | Status | Summary |', '| --- | --- | --- |');
  for (const c of report.checks) {
    out.push(`| ${c.check} | ${STATUS_TEXT[c.status]} | ${inline(checkLine(c))} |`);
  }
  out.push('', tallyLine(tally(report)), '');
  const problems = sortedProblems(report);
  for (const c of report.checks) {
    const mine = problems.filter((p) => p.check === c.check);
    if (mine.length === 0) continue;
    const open = mine.some((p) => p.severity === 'error') ? ' open' : '';
    out.push(
      `<details${open}><summary><b>${c.check}</b>: ${mine.length} item${mine.length === 1 ? '' : 's'}</summary>`,
      '',
    );
    for (const p of mine) out.push(problemItem(p));
    out.push('', '</details>', '');
  }
  return `${neutralizeWorkflowCommands(out.join('\n').trimEnd())}\n`;
}
