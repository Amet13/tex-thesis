import type { CheckStatus, Problem, Report, Severity } from '../types.js';
import {
  checkLine,
  formatLocation,
  neutralizeWorkflowCommands,
  oneLine,
  safeLines,
  sortedProblems,
  tally,
  tallyLine,
} from './shared.js';

export interface HumanOptions {
  color?: boolean;
  verbose?: boolean;
}

type Paint = (s: string) => string;

function palette(color: boolean) {
  const wrap =
    (open: number, close: number): Paint =>
    (s) =>
      color ? `\u001b[${open}m${s}\u001b[${close}m` : s;
  return {
    red: wrap(31, 39),
    yellow: wrap(33, 39),
    green: wrap(32, 39),
    cyan: wrap(36, 39),
    dim: wrap(2, 22),
    bold: wrap(1, 22),
  };
}

const STATUS_GLYPH: Record<CheckStatus, string> = { pass: '✓', warn: '!', fail: '✕', skipped: '–' };
const SEVERITY_GLYPH: Record<Severity, string> = { error: '✕', warning: '!', info: 'i' };

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

/** Terminal report: header, one line per check, sorted problems, tally. No emoji. */
export function formatHuman(report: Report, opts: HumanOptions = {}): string {
  const c = palette(opts.color ?? false);
  const statusPaint: Record<CheckStatus, Paint> = {
    pass: c.green,
    warn: c.yellow,
    fail: c.red,
    skipped: c.dim,
  };
  const sevPaint: Record<Severity, Paint> = { error: c.red, warning: c.yellow, info: c.cyan };
  const lines: string[] = [];
  const statusWord = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' }[report.status];
  const target = report.target ? ` ${oneLine(report.target)}` : '';
  lines.push(`${c.bold(`overfull${target}`)}  ${statusPaint[report.status](c.bold(statusWord))}`);
  const nameWidth = Math.max(...report.checks.map((ch) => ch.check.length), 5) + 2;
  for (const ch of report.checks) {
    const glyph = statusPaint[ch.status](STATUS_GLYPH[ch.status]);
    const text = oneLine(checkLine(ch));
    lines.push(
      `  ${glyph} ${pad(ch.check, nameWidth)}${ch.status === 'skipped' ? c.dim(text) : text}`,
    );
  }
  const problems = sortedProblems(report);
  if (problems.length > 0) {
    lines.push('');
    const locWidth = Math.min(
      28,
      Math.max(...problems.map((p) => oneLine(formatLocation(p.location)).length)),
    );
    for (const p of problems)
      lines.push(...problemLines(p, locWidth, opts.verbose ?? false, c, sevPaint));
  }
  lines.push('');
  lines.push(tallyLine(tally(report)));
  if (!opts.verbose && problems.some((p) => p.fix || p.detail)) {
    lines.push(c.dim('Run with --verbose for fixes, or `overfull explain <rule>`.'));
  }
  return `${neutralizeWorkflowCommands(lines.join('\n'))}\n`;
}

function problemLines(
  p: Problem,
  locWidth: number,
  verbose: boolean,
  c: ReturnType<typeof palette>,
  sevPaint: Record<Severity, Paint>,
): string[] {
  // Every field may carry text from the author's files: keep each on its own line.
  const loc = oneLine(formatLocation(p.location));
  const locCol = locWidth > 0 ? `${pad(loc, locWidth)}  ` : '';
  const related = p.related ? c.dim(` (+${p.related} follow-on)`) : '';
  const out = [
    `  ${sevPaint[p.severity](SEVERITY_GLYPH[p.severity])} ${locCol}${oneLine(p.message)}${related}  ${c.dim(oneLine(p.rule))}`,
  ];
  if (verbose) {
    const indent = ' '.repeat(4 + (locWidth > 0 ? locWidth + 2 : 0));
    if (p.detail) out.push(`${indent}${c.dim('why:')} ${oneLine(p.detail)}`);
    if (p.fix) out.push(`${indent}${c.dim('fix:')} ${oneLine(p.fix)}`);
    if (p.evidence) {
      for (const e of safeLines(p.evidence).slice(0, 4)) out.push(`${indent}${c.dim(`| ${e}`)}`);
    }
  }
  return out;
}
