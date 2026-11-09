import { type CheckResult, type Problem, type Severity, statusOf } from '../types.js';
import type { CheckLevel, PdfFacts, VeraPdfResult } from './types.js';

export interface AccessibilityOptions {
  /** Parsed veraPDF result; `null` means veraPDF is not available (adds an info). */
  verapdf?: VeraPdfResult | null;
  level?: CheckLevel;
}

/** Rule id for a veraPDF clause: `8.2.5.26` → `verapdf-8-2-5-26`. */
export function veraPdfRuleId(clause: string): string {
  const slug = clause
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug ? `verapdf-${slug}` : 'verapdf';
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * True when alt text is absent or just an image file name, which LaTeX's
 * tagging code inserts as a placeholder when `alt=` is not given.
 */
export function isMissingAlt(alt: string | undefined): boolean {
  if (!alt?.trim()) return true;
  return /^[\w./\\-]+\.(pdf|png|jpe?g|eps|svg|gif|tiff?|webp|bmp)$/i.test(alt.trim());
}

function figureProblems(facts: PdfFacts, sev: Severity): Problem[] {
  const byPage = new Map<number, { count: number; placeholder: number }>();
  for (const f of facts.figures) {
    if (!isMissingAlt(f.alt)) continue;
    const e = byPage.get(f.page) ?? { count: 0, placeholder: 0 };
    e.count++;
    if (f.alt) e.placeholder++;
    byPage.set(f.page, e);
  }
  return [...byPage.entries()].map(([page, { count, placeholder }]) => ({
    rule: 'figure-missing-alt',
    check: 'accessibility',
    severity: sev,
    message: `${plural(count, 'figure')} without alt text${placeholder ? ' (LaTeX used the file name)' : ''}`,
    location: { page },
    fix: 'Add `alt={...}` to the `\\includegraphics` on this page',
    data: { count },
  }));
}

function fontProblems(facts: PdfFacts, sev: Severity): Problem[] {
  const missing = (facts.fonts ?? []).filter((f) => !f.embedded);
  if (missing.length === 0) return [];
  const names = [...new Set(missing.map((f) => f.name || '(unnamed)'))];
  return [
    {
      rule: 'font-not-embedded',
      check: 'accessibility',
      severity: sev,
      message: `${plural(names.length, 'font')} not embedded: ${names.slice(0, 5).join(', ')}${names.length > 5 ? ', …' : ''}`,
      fix: 'Embed all fonts: compile with LuaLaTeX and re-export figures (PDF/EPS) with fonts embedded',
      data: { fonts: names },
    },
  ];
}

function veraPdfProblems(v: VeraPdfResult, sev: Severity): Problem[] {
  if (v.error) {
    return [
      {
        rule: 'verapdf-error',
        check: 'accessibility',
        severity: 'warning',
        message: `veraPDF could not validate the PDF: ${v.error}`,
        fix: 'Run `verapdf --flavour ua2 <file.pdf>` by hand to see the full error',
      },
    ];
  }
  const groups = new Map<string, Problem>();
  for (const f of v.failures) {
    const rule = veraPdfRuleId(f.clause);
    const prev = groups.get(rule);
    if (prev) {
      const data = prev.data as { count: number; tests: number[] };
      data.count += f.failedChecks;
      if (f.testNumber !== undefined) data.tests.push(f.testNumber);
      prev.message = `${f.specification} §${f.clause}: ${prev.detail ?? ''} (${plural(data.count, 'failed check')})`;
      continue;
    }
    const desc = f.description.replace(/\s+/g, ' ').trim();
    const problem: Problem = {
      rule,
      check: 'accessibility',
      severity: sev,
      message: `${f.specification} §${f.clause}: ${desc} (${plural(f.failedChecks, 'failed check')})`,
      detail: desc,
      fix: 'See `overfull explain verapdf`; the clause names the PDF/UA requirement that failed',
      data: {
        specification: f.specification,
        clause: f.clause,
        count: f.failedChecks,
        tests: f.testNumber === undefined ? [] : [f.testNumber],
      },
    };
    if (f.contexts.length) problem.evidence = f.contexts.join('\n');
    groups.set(rule, problem);
  }
  if (!v.compliant && groups.size === 0) {
    return [
      {
        rule: 'verapdf',
        check: 'accessibility',
        severity: 'warning',
        message: 'veraPDF reported the file non-compliant but listed no failed rules',
        fix: 'Run `verapdf --flavour ua2 --format text <file.pdf>` by hand to see why validation failed',
        data: { compliant: false },
      },
    ];
  }
  return [...groups.values()];
}

/**
 * Accessibility check from PDF facts (and veraPDF, when available).
 * `level`: `required` → errors, `recommended` → warnings, `off` → skipped.
 */
export function accessibilityCheck(facts: PdfFacts, opts: AccessibilityOptions = {}): CheckResult {
  const level = opts.level ?? 'required';
  if (level === 'off') {
    return {
      check: 'accessibility',
      status: 'skipped',
      problems: [],
      skippedReason: 'Accessibility is off for this venue profile',
    };
  }
  const sev: Severity = level === 'required' ? 'error' : 'warning';
  const problems: Problem[] = [];
  if (!facts.tagged) {
    problems.push({
      rule: 'pdf-not-tagged',
      check: 'accessibility',
      severity: sev,
      message: 'PDF is not tagged (no structure for screen readers)',
      fix: 'Add `\\DocumentMetadata{lang=en-US, pdfstandard=ua-2, tagging=on}` before `\\documentclass` and build with LuaLaTeX',
    });
  }
  if (!facts.language) {
    problems.push({
      rule: 'pdf-missing-language',
      check: 'accessibility',
      severity: sev,
      message: 'Document language is not set',
      fix: 'Set `lang=en-US` (or your language) in `\\DocumentMetadata{...}`',
    });
  }
  if (!facts.title) {
    problems.push({
      rule: 'pdf-missing-title',
      check: 'accessibility',
      severity: sev,
      message: 'PDF has no title in its metadata',
      fix: 'Set `\\hypersetup{pdftitle={...}, pdfdisplaydoctitle=true}`',
    });
  } else if (facts.displayDocTitle === false) {
    problems.push({
      rule: 'pdf-missing-title',
      check: 'accessibility',
      severity: sev,
      message: 'Viewers will show the file name instead of the title (DisplayDocTitle is off)',
      fix: 'Set `\\hypersetup{pdfdisplaydoctitle=true}`',
      data: { title: facts.title },
    });
  }
  problems.push(...figureProblems(facts, sev));
  problems.push(...fontProblems(facts, sev));
  if (facts.pdfua === undefined) {
    problems.push({
      rule: 'pdfua-not-claimed',
      check: 'accessibility',
      severity: 'info',
      message: 'PDF does not claim PDF/UA conformance',
      fix: 'Add `pdfstandard=ua-2` to `\\DocumentMetadata{...}`',
    });
  }
  if (opts.verapdf === null) {
    problems.push({
      rule: 'verapdf-not-run',
      check: 'accessibility',
      severity: 'info',
      message: 'veraPDF not found, full PDF/UA validation skipped',
      fix: 'Install veraPDF or run the check in the Overfull Docker image',
    });
  } else if (opts.verapdf) {
    problems.push(...veraPdfProblems(opts.verapdf, sev));
  }
  const counted = problems.filter((p) => p.severity !== 'info');
  const stats: Record<string, number> = {
    figures: facts.figures.length,
    figuresWithAlt: facts.figures.filter((f) => !isMissingAlt(f.alt)).length,
  };
  if (opts.verapdf && !opts.verapdf.error) stats.verapdfFailedRules = opts.verapdf.failures.length;
  let summary: string;
  if (counted.length === 0) {
    summary =
      opts.verapdf && !opts.verapdf.error && opts.verapdf.compliant
        ? 'Tagged, PDF/UA valid (veraPDF)'
        : 'Tagged, language and title set';
  } else {
    summary = `${plural(counted.length, 'accessibility problem')}`;
  }
  return { check: 'accessibility', status: statusOf(problems), problems, summary, stats };
}
