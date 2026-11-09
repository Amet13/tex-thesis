import { type CheckResult, type Problem, type Severity, statusOf } from '../types.js';
import { findCommands, lineCounter, stripComments } from '../venue/tex.js';
import type { TexFile } from '../venue/types.js';
import { veraPdfClauseInfo } from './rules.js';
import type { CheckLevel, PdfFacts, VeraPdfResult } from './types.js';

export interface AccessibilityOptions {
  /** Parsed veraPDF result; `null` means veraPDF is not available (adds an info). */
  verapdf?: VeraPdfResult | null;
  level?: CheckLevel;
  /**
   * LaTeX sources: `\includegraphics` and `tikzpicture` without `alt=` are reported
   * with file and line (rule `figure-missing-alt`).
   */
  texFiles?: TexFile[];
  /**
   * The build check failed: veraPDF findings are then demoted to info (a broken build
   * produces them; fix the build first).
   */
  buildFailed?: boolean;
  /**
   * With `verapdf: null`: whether veraPDF could have been run here (the CLI with
   * Docker available), and the advice to show. `verapdf-not-run` is a warning only
   * when the level is `required` and `couldRun` is true; otherwise (browser, the
   * GitHub Action, no Docker) it is info.
   */
  verapdfNotRun?: { couldRun?: boolean; message?: string; fix?: string };
}

/** First line of main.tex that makes LaTeX produce a tagged PDF/UA-2 file. */
export const DOCUMENT_METADATA_LINE =
  '\\DocumentMetadata{lang=en, pdfstandard=ua-2, pdfversion=2.0, tagging=on}';

const FIGURE_ALT_FIX =
  'Describe what the figure shows: `\\includegraphics[alt={...}]{file}`, or `\\begin{tikzpicture}[alt={...}]` for TikZ; use `artifact` instead of `alt` for purely decorative images';

/** True when a key list such as `width=3cm, alt={A bar chart}` sets `alt` or `artifact`. */
function hasAltKey(options: string | undefined): boolean {
  return options !== undefined && /(?:^|[,\s])(?:alt\s*=|artifact\b)/.test(options);
}

/**
 * Source scan: `\includegraphics` and `tikzpicture` environments without `alt=` (or
 * `artifact`), with file and line. Comments are ignored.
 */
export function figureAltSourceProblems(texFiles: TexFile[], severity: Severity): Problem[] {
  const problems: Problem[] = [];
  for (const use of findCommands(texFiles, ['includegraphics'])) {
    if (hasAltKey(use.optional)) continue;
    problems.push({
      rule: 'figure-missing-alt',
      check: 'accessibility',
      severity,
      message: `\`\\includegraphics{${use.arg.trim()}}\` has no alt text`,
      location: { file: use.file, line: use.line },
      fix: FIGURE_ALT_FIX,
      data: { kind: 'includegraphics', file: use.arg.trim() },
    });
  }
  const begin = /\\begin\s*\{tikzpicture\}/g;
  for (const f of texFiles) {
    const src = stripComments(f.content);
    const lineAt = lineCounter(src);
    begin.lastIndex = 0;
    for (let m = begin.exec(src); m; m = begin.exec(src)) {
      let i = m.index + m[0].length;
      while (src[i] === ' ' || src[i] === '\n') i++;
      let options: string | undefined;
      if (src[i] === '[') {
        const close = src.slice(i, i + 4096).indexOf(']');
        if (close > 0) options = src.slice(i + 1, i + close);
      }
      if (hasAltKey(options)) continue;
      problems.push({
        rule: 'figure-missing-alt',
        check: 'accessibility',
        severity,
        message: '`tikzpicture` has no alt text',
        location: { file: f.path, line: lineAt(m.index) },
        fix: FIGURE_ALT_FIX,
        data: { kind: 'tikzpicture' },
      });
    }
  }
  return problems;
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
    fix: `On this page: ${FIGURE_ALT_FIX}`,
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

function pagesText(pages: number[]): string {
  if (!pages.length) return '';
  const shown = pages.slice(0, 8).join(', ');
  return ` on ${pages.length === 1 ? 'page' : 'pages'} ${shown}${pages.length > 8 ? ', …' : ''}`;
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
  interface Group {
    problem: Problem;
    spec: string;
    clause: string;
    desc: string;
    count: number;
    tests: number[];
    pages: Set<number>;
  }
  const groups = new Map<string, Group>();
  for (const f of v.failures) {
    const rule = veraPdfRuleId(f.clause);
    const prev = groups.get(rule);
    if (prev) {
      prev.count += f.failedChecks;
      if (f.testNumber !== undefined) prev.tests.push(f.testNumber);
      for (const p of f.pages ?? []) prev.pages.add(p);
      if (f.contexts.length && !prev.problem.evidence)
        prev.problem.evidence = f.contexts.join('\n');
      continue;
    }
    const desc = f.description.replace(/\s+/g, ' ').trim();
    const info = veraPdfClauseInfo(f.clause);
    const problem: Problem = {
      rule,
      check: 'accessibility',
      severity: sev,
      message: '',
      detail: info ? `${desc}. ${info.summary}` : desc,
      fix: info
        ? `${info.fix} (\`overfull explain ${rule}\`)`
        : 'See `overfull explain verapdf`; the clause names the PDF/UA requirement that failed',
    };
    if (f.contexts.length) problem.evidence = f.contexts.join('\n');
    groups.set(rule, {
      problem,
      spec: f.specification,
      clause: f.clause,
      desc,
      count: f.failedChecks,
      tests: f.testNumber === undefined ? [] : [f.testNumber],
      pages: new Set(f.pages ?? []),
    });
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
  return [...groups.values()].map((g) => {
    const pages = [...g.pages].sort((a, b) => a - b);
    const p = g.problem;
    p.message = `${g.spec} §${g.clause}: ${g.desc} (${plural(g.count, 'failed check')}${pagesText(pages)})`;
    if (pages.length) p.location = { page: pages[0] as number };
    p.data = {
      specification: g.spec,
      clause: g.clause,
      count: g.count,
      tests: g.tests,
      ...(pages.length ? { pages } : {}),
    };
    return p;
  });
}

/**
 * Root-cause grouping: an untagged PDF fails most veraPDF clauses for that one reason,
 * so the clause failures are folded into `pdf-not-tagged` (counted in `related`,
 * listed in evidence). A failed build demotes them to info instead.
 */
function groupVeraPdf(problems: Problem[], vera: Problem[], buildFailed: boolean): Problem[] {
  const clauses = vera.filter((p) => p.rule.startsWith('verapdf-') && p.rule !== 'verapdf-error');
  const untagged = problems.find((p) => p.rule === 'pdf-not-tagged');
  if (untagged && clauses.length) {
    const failedChecks = clauses.reduce((n, p) => n + Number(p.data?.count ?? 1), 0);
    untagged.related = (untagged.related ?? 0) + clauses.length;
    untagged.message = `${untagged.message}; this also causes ${plural(clauses.length, 'veraPDF failure')} (${plural(failedChecks, 'failed check')})`;
    untagged.evidence = clauses.map((p) => p.message).join('\n');
    untagged.data = {
      ...(untagged.data ?? {}),
      verapdf: clauses.map((p) => ({ rule: p.rule, ...(p.data ?? {}) })),
    };
    return vera.filter((p) => !clauses.includes(p));
  }
  if (buildFailed) {
    return vera.map((p) =>
      clauses.includes(p)
        ? {
            ...p,
            severity: 'info' as const,
            message: `${p.message} — fix build errors first; a broken build produces these`,
            fix: `Fix build errors first; a broken build produces these. ${p.fix ?? ''}`.trim(),
          }
        : p,
    );
  }
  return vera;
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
      fix: `Add \`${DOCUMENT_METADATA_LINE}\` as the first line of main.tex and build with LuaLaTeX`,
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
  // The source scan names file and line; it replaces the per-page PDF count when it
  // finds anything.
  const fromSource = opts.texFiles?.length ? figureAltSourceProblems(opts.texFiles, sev) : [];
  problems.push(...(fromSource.length ? fromSource : figureProblems(facts, sev)));
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
    // A warning only where it could have run (the CLI with Docker) and the profile
    // requires an accessible PDF; in the browser or the Action it is a note.
    const nr = opts.verapdfNotRun ?? {};
    problems.push({
      rule: 'verapdf-not-run',
      check: 'accessibility',
      severity: level === 'required' && nr.couldRun ? 'warning' : 'info',
      message: nr.message ?? 'veraPDF not found, full PDF/UA validation skipped',
      fix:
        nr.fix ??
        'Install veraPDF (https://verapdf.org) and put `verapdf` on PATH, or run `overfull check --engine docker` (uses the Overfull image), or run the check inside the Overfull Docker image',
    });
  } else if (opts.verapdf) {
    problems.push(
      ...groupVeraPdf(problems, veraPdfProblems(opts.verapdf, sev), opts.buildFailed === true),
    );
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
