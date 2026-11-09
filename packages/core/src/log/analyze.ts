/**
 * Turns a parsed log into the `build` and `output` checks: groups error cascades
 * under their root cause and folds warnings that share one cause (a stale
 * bibliography, a pending LaTeX rerun) into a single actionable problem.
 */

import { type CheckResult, type Problem, statusOf } from '../types.js';
import { type ExplainContext, explainError } from './explain.js';
import { parseLog } from './parse.js';
import { extension } from './paths.js';
import type { LogError, LogWarning, ParsedLog } from './types.js';

export interface AnalyzeLogOptions {
  /** Absolute project directory; log paths below it become project-relative. */
  root?: string;
  /** Overfull boxes up to this many points are ignored. Default 10. */
  overfullThresholdPt?: number;
}

export interface LogAnalysis {
  build: CheckResult;
  output: CheckResult;
  parsed: ParsedLog;
}

/** Follow-on errors within this many source lines of a root error are folded into it. */
const CASCADE_LINES = 3;
const MAX_EVIDENCE_LINES = 40;
const DEFAULT_OVERFULL_PT = 10;

const code = (text: string): string => `\`${text}\``;
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function location(file?: string, line?: number, page?: number): Problem['location'] | undefined {
  const loc: NonNullable<Problem['location']> = {};
  if (file) loc.file = file;
  if (line !== undefined) loc.line = line;
  if (page !== undefined) loc.page = page;
  return Object.keys(loc).length > 0 ? loc : undefined;
}

function evidence(lines: string[]): string {
  const all = lines.join('\n').split('\n');
  if (all.length <= MAX_EVIDENCE_LINES) return all.join('\n');
  return [
    ...all.slice(0, MAX_EVIDENCE_LINES),
    `… (${all.length - MAX_EVIDENCE_LINES} more lines)`,
  ].join('\n');
}

function compact<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

// ---------------------------------------------------------------------------
// Errors → build (and output) problems

/** Errors that only report that the run stopped; they belong to the error before them. */
function isTerminationNotice(error: LogError): boolean {
  return /^(?:Emergency stop|==> Fatal error occurred|\s*==> Fatal error occurred)/.test(
    error.message.trim(),
  );
}

function atEndDocument(error: LogError): boolean {
  return /^\s*(?:\.\.\.)?\\end\s*\{document\}/.test(error.source?.before ?? '');
}

interface Group {
  root: LogError;
  problem: Problem;
  followers: LogError[];
}

/** Errors that are typically side effects of an earlier error rather than causes of their own. */
const CONSEQUENCE_RULES = new Set([
  'missing-dollar',
  'missing-brace',
  'extra-brace',
  'runaway-argument',
  'environment-mismatch',
  'misplaced-alignment-tab',
  'double-script',
  'illegal-parameter-number',
  'tex-error',
]);

/**
 * A follow-on error is folded into the preceding root when it sits in the same file within
 * `CASCADE_LINES` lines after it and is the same kind of error or a typical side effect.
 */
function isFollower(
  error: LogError,
  rule: string,
  check: Problem['check'],
  group: Group | undefined,
): boolean {
  if (!group) return false;
  if (isTerminationNotice(error)) return true;
  const { root, problem } = group;
  if (atEndDocument(error) && check === problem.check) return true;
  if (error.file !== root.file || error.line === undefined || root.line === undefined) return false;
  if (error.line === root.line) return true;
  if (check !== problem.check) return false;
  if (error.line < root.line || error.line - root.line > CASCADE_LINES) return false;
  const sideEffect =
    CONSEQUENCE_RULES.has(rule) || (rule === 'undefined-control-sequence' && problem.rule !== rule);
  return rule === problem.rule || sideEffect;
}

function errorProblems(parsed: ParsedLog, ctx: ExplainContext): Problem[] {
  const groups: Group[] = [];
  let last: Group | undefined;
  for (const error of parsed.errors) {
    const explanation = explainError(error, ctx);
    if (last && isFollower(error, explanation.rule, explanation.check, last)) {
      last.followers.push(error);
      continue;
    }
    const problem: Problem = compact({
      rule: explanation.rule,
      check: explanation.check,
      severity: 'error',
      message: explanation.message,
      location: location(error.file, error.line),
      detail: explanation.detail,
      fix: explanation.fix,
      data: { ...explanation.data, tex: error.message },
    });
    last = { root: error, problem, followers: [] };
    groups.push(last);
  }
  return groups.map(({ root, problem, followers }) => {
    if (followers.length > 0) problem.related = followers.length;
    // Fatal file errors print their source line only in the follow-up "Emergency stop".
    const lined = followers.find((f) => f.line !== undefined && f.file === root.file);
    // (\usepackage reads ahead one line, so a missing package would point past its line.)
    if (
      root.line === undefined &&
      lined?.line !== undefined &&
      problem.location &&
      problem.rule !== 'missing-package'
    ) {
      problem.location.line = lined.line;
    }
    problem.evidence = evidence([root.raw, ...followers.map((f) => f.raw)]);
    return problem;
  });
}

function fatalWithoutError(parsed: ParsedLog, problems: Problem[]): Problem[] {
  if (problems.some((p) => p.check === 'build') || !(parsed.fatal || parsed.noPages)) return [];
  return [
    {
      rule: 'tex-error',
      check: 'build',
      severity: 'error',
      message: parsed.noPages
        ? 'The build produced no pages'
        : 'The build stopped before finishing',
      detail: parsed.noPages
        ? 'TeX finished without typesetting anything, so there is no PDF.'
        : 'TeX aborted the run; the PDF is missing or incomplete.',
      fix: 'Check that the document has content between `\\begin{document}` and `\\end{document}`, then read the end of the log.',
    },
  ];
}

// ---------------------------------------------------------------------------
// Warnings → output problems

interface WarningsByKind {
  get(kind: LogWarning['kind']): LogWarning[];
}

function indexWarnings(warnings: LogWarning[]): WarningsByKind {
  const map = new Map<string, LogWarning[]>();
  for (const w of warnings) {
    const list = map.get(w.kind);
    if (list) list.push(w);
    else map.set(w.kind, [w]);
  }
  return { get: (kind) => map.get(kind) ?? [] };
}

/** Groups warnings by a data key, keeping first-seen order. */
function groupBy(warnings: LogWarning[], key: string): Map<string, LogWarning[]> {
  const groups = new Map<string, LogWarning[]>();
  for (const w of warnings) {
    const value = String(w.data[key] ?? '');
    const list = groups.get(value);
    if (list) list.push(w);
    else groups.set(value, [w]);
  }
  return groups;
}

function occurrences(list: LogWarning[]): { file?: string; line?: number; page?: number }[] {
  return list.map((w) => compact({ file: w.file, line: w.line, page: w.page }));
}

function undefinedCitations(list: LogWarning[], notInBib: Set<string>): Problem[] {
  return [...groupBy(list, 'key')].map(([key, items]) => {
    const first = items[0] as LogWarning;
    const missing = notInBib.has(key);
    return compact({
      rule: 'undefined-citation',
      check: 'output' as const,
      severity: 'error' as const,
      message: `Citation ${code(key)} is undefined${items.length > 1 ? ` (cited ${items.length} times)` : ''}`,
      location: location(first.file, first.line, first.page),
      detail: missing
        ? `The key ${code(key)} is not in any loaded .bib file, so the PDF shows it in bold or as [?].`
        : `No bibliography entry has the key ${code(key)}, so the PDF shows it in bold or as [?].`,
      fix: `Check the spelling of ${code(key)} against the .bib file, or add the entry (\`overfull cite <doi>\` can fetch it), then rebuild.`,
      evidence: evidence(items.map((w) => w.raw)),
      data: { key, count: items.length, occurrences: occurrences(items) },
    });
  });
}

function undefinedReferences(list: LogWarning[]): Problem[] {
  return [...groupBy(list, 'label')].map(([label, items]) => {
    const first = items[0] as LogWarning;
    return compact({
      rule: 'undefined-reference',
      check: 'output' as const,
      severity: 'error' as const,
      message: `Reference to ${code(label)} is undefined${items.length > 1 ? ` (used ${items.length} times)` : ''}`,
      location: location(first.file, first.line, first.page),
      detail: `There is no ${code(`\\label{${label}}`)}, so the PDF shows ?? where it is referenced.`,
      fix: `Add ${code(`\\label{${label}}`)} after the caption or heading it should point to, or fix the spelling in ${code(`\\ref{${label}}`)}.`,
      evidence: evidence(items.map((w) => w.raw)),
      data: { label, count: items.length, occurrences: occurrences(items) },
    });
  });
}

interface StaleState {
  bibliography: 'missing' | 'stale' | undefined;
  bibTool: 'Biber' | 'BibTeX';
  references: boolean;
}

function staleState(parsed: ParsedLog, w: WarningsByKind): StaleState {
  const noBbl = w.get('no-file').some((x) => extension(String(x.data.file)) === 'bbl');
  const stale = parsed.rerunNeeded.biber || parsed.rerunNeeded.bibtex;
  return {
    bibliography: noBbl ? 'missing' : stale ? 'stale' : undefined,
    bibTool: parsed.rerunNeeded.bibtex && !parsed.rerunNeeded.biber ? 'BibTeX' : 'Biber',
    references: parsed.rerunNeeded.latex,
  };
}

function bibliographyProblem(state: StaleState, citations: LogWarning[], raw: string[]): Problem {
  const keys = [...new Set(citations.map((c) => String(c.data.key)))];
  const tool = state.bibTool;
  const command = tool === 'Biber' ? '`biber main`' : '`bibtex main`';
  const missing = state.bibliography === 'missing';
  const suffix =
    keys.length > 0
      ? ` (${plural(keys.length, 'citation')} ${keys.length === 1 ? 'shows' : 'show'} as [?])`
      : '';
  return compact({
    rule: missing ? 'bibliography-missing' : 'bibliography-stale',
    check: 'output' as const,
    severity: missing || keys.length > 0 ? ('error' as const) : ('warning' as const),
    message: missing
      ? `The bibliography has not been built: ${tool} was not run${suffix}`
      : `The bibliography is out of date: ${tool} needs to run again${suffix}`,
    detail: missing
      ? `There is no .bbl file yet, so every citation is undefined and the bibliography is empty. This is expected after a single LaTeX run.`
      : `The citations changed since ${tool} last ran.`,
    fix: `Build with \`latexmk\` (it runs ${tool} and LaTeX as often as needed), or run ${command} and then LaTeX twice.`,
    related: keys.length > 0 ? keys.length : undefined,
    evidence: evidence(raw),
    data: keys.length > 0 ? { tool, keys } : { tool },
  });
}

function rerunProblem(references: LogWarning[], raw: string[]): Problem {
  const labels = [...new Set(references.map((r) => String(r.data.label)))];
  return compact({
    rule: 'rerun-needed',
    check: 'output' as const,
    severity: labels.length > 0 ? ('error' as const) : ('warning' as const),
    message:
      labels.length > 0
        ? `Cross-references are out of date: rerun LaTeX (${plural(labels.length, 'reference')} ${labels.length === 1 ? 'shows' : 'show'} as ??)`
        : 'Cross-references may be out of date: rerun LaTeX',
    detail:
      'Labels changed during this run, so page numbers and references in the PDF may be wrong until LaTeX runs again.',
    fix: 'Build with `latexmk`, which reruns LaTeX until references settle, or run LaTeX once more.',
    related: labels.length > 0 ? labels.length : undefined,
    evidence: evidence(raw),
    data: labels.length > 0 ? { labels } : undefined,
  });
}

function duplicateLabels(list: LogWarning[]): Problem[] {
  return [...groupBy(list, 'label')].map(([label, items]) => {
    const first = items[0] as LogWarning;
    return compact({
      rule: 'duplicate-label',
      check: 'output' as const,
      severity: 'warning' as const,
      message: `Label ${code(label)} is defined more than once`,
      // LaTeX notices duplicates while reading the .aux file, which says nothing about the source.
      location:
        extension(first.file ?? '') === 'aux'
          ? undefined
          : location(first.file, first.line, first.page),
      detail: `References to ${code(label)} point to whichever definition LaTeX saw last, which may be the wrong one.`,
      fix: `Search for ${code(`\\label{${label}}`)} and give each one a unique name.`,
      evidence: evidence(items.map((w) => w.raw)),
      data: { label },
    });
  });
}

/** Readable text from an overfull box dump such as `[]\OT1/cmr/m/n/10 The con-fig-u-ra-tion`. */
function boxText(raw: string): string {
  const dump = raw.split('\n').slice(1).join('');
  return dump
    .replace(/\\[A-Z0-9]+\/[\w/.-]+(?:\(\d+\))?\/\d+(?:\.\d+)?\s?/g, '')
    .replace(/\[\]/g, ' ')
    .replace(/\$/g, '')
    .replace(/(\w)-(\w)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/** True when an error was reported inside the paragraph of this box (the box is a side effect). */
function overlapsError(box: LogWarning, errors: LogError[]): boolean {
  const lines = box.data.lines as [number, number] | undefined;
  if (!lines) return false;
  return errors.some(
    (e) => e.file === box.file && e.line !== undefined && e.line >= lines[0] && e.line <= lines[1],
  );
}

function overfullBoxes(list: LogWarning[], thresholdPt: number, errors: LogError[]): Problem[] {
  const significant = list.filter(
    (w) => Number(w.data.amountPt ?? 0) > thresholdPt && !overlapsError(w, errors),
  );
  const byFile = new Map<string, LogWarning[]>();
  for (const w of significant) {
    const key = w.file ?? '';
    const group = byFile.get(key);
    if (group) group.push(w);
    else byFile.set(key, [w]);
  }
  return [...byFile.values()].map((items) => {
    const worst = items.reduce((a, b) =>
      Number(b.data.amountPt) > Number(a.data.amountPt) ? b : a,
    );
    const amount = Number(worst.data.amountPt);
    const lines = worst.data.lines as [number, number] | undefined;
    const vertical = worst.data.box === 'vbox';
    const others = items.length - 1;
    const text = vertical ? '' : boxText(worst.raw);
    const where = lines
      ? lines[0] === lines[1]
        ? `line ${lines[0]}`
        : `lines ${lines[0]}–${lines[1]}`
      : '';
    return compact({
      rule: 'overfull-box',
      check: 'output' as const,
      severity: 'warning' as const,
      message: vertical
        ? `Content is ${amount.toFixed(1)}pt too tall for the page${where ? ` (${where})` : ''}`
        : `Text sticks ${amount.toFixed(1)}pt into the margin${where ? ` (${where})` : ''}${others > 0 ? `; ${plural(others, 'more overfull box')} in this file` : ''}`,
      location: location(worst.file, worst.line, worst.page),
      detail: vertical
        ? 'A page or box holds more material than fits vertically.'
        : `TeX could not break the line without exceeding the text width${text ? `: ${code(text)}` : ''}. Long URLs, code, file names and unhyphenated words are the usual cause.`,
      fix: vertical
        ? 'Shrink the float or table, allow it to break across pages, or move material.'
        : 'Rephrase or allow a break: use `\\url{}`/`\\path{}` for URLs and identifiers, `\\-` to suggest hyphenation, or `\\sloppy` for this paragraph. Wide tables and figures: scale them to `\\linewidth`.',
      evidence: evidence([worst.raw]),
      data: compact({ amountPt: amount, box: worst.data.box, lines, others, thresholdPt }),
    });
  });
}

function fontSubstitutions(list: LogWarning[]): Problem[] {
  const groups = new Map<string, LogWarning[]>();
  for (const w of list) {
    const key = `${w.data.from}→${w.data.to}`;
    const group = groups.get(key);
    if (group) group.push(w);
    else groups.set(key, [w]);
  }
  return [...groups.values()].map((items) => {
    const first = items[0] as LogWarning;
    const from = String(first.data.from);
    const to = String(first.data.to);
    const shape = from.split('/').slice(2).join('/');
    return compact({
      rule: 'font-substitution',
      check: 'output' as const,
      severity: 'warning' as const,
      message: `Font shape ${code(from)} is not available; ${code(to)} was used instead`,
      location: location(first.file, first.line, first.page),
      detail: `The font has no ${code(shape)} variant (for example bold small caps), so the PDF shows a different style than the source asks for.`,
      fix: 'Use a font family that has this shape (with pdfLaTeX, `\\usepackage[T1]{fontenc}` gives Computer Modern bold small caps), or avoid combining these styles.',
      evidence: evidence(items.map((w) => w.raw)),
      data: { from, to, count: items.length },
    });
  });
}

function missingGlyphs(list: LogWarning[]): Problem[] {
  const byFont = new Map<string, LogWarning[]>();
  for (const w of list) {
    const font = String(w.data.font);
    const group = byFont.get(font);
    if (group) group.push(w);
    else byFont.set(font, [w]);
  }
  return [...byFont].map(([font, items]) => {
    const chars = [...new Set(items.map((w) => String(w.data.char)))];
    const first = items[0] as LogWarning;
    const fontName = /^\[?([^\]:]+)/.exec(font)?.[1] ?? font;
    return compact({
      rule: 'missing-glyph',
      check: 'output' as const,
      severity: 'error' as const,
      message: `${plural(chars.length, 'character')} missing from the font ${code(fontName)}: ${chars.slice(0, 12).join(' ')}`,
      location: location(first.file, first.line, first.page),
      detail:
        'The font has no glyph for these characters, so they are silently left out of the PDF.',
      fix: 'Switch to a font that covers them (for CJK text: `\\usepackage{xeCJK}` or `luatexja`, or `\\setmainfont{Noto Serif CJK SC}`), or use a fallback font for these characters.',
      evidence: evidence(items.slice(0, 5).map((w) => w.raw)),
      data: { font, chars, count: items.length },
    });
  });
}

function pdfStringTokens(list: LogWarning[]): Problem[] {
  const first = list[0];
  if (!first) return [];
  const tokens = [...new Set(list.map((w) => String(w.data.token)))];
  return [
    compact({
      rule: 'pdf-string-token',
      check: 'output' as const,
      severity: 'info' as const,
      message: `Math or commands in a heading were dropped from the PDF bookmarks (${tokens.map(code).join(', ')})`,
      location: location(first.file, first.line, first.page),
      detail:
        'hyperref turns headings into PDF bookmarks, which are plain text; it removed what it could not convert.',
      fix: 'Give a plain-text alternative: `\\section{\\texorpdfstring{$\\alpha < 1$}{alpha < 1}}`.',
      related: list.length > 1 ? list.length - 1 : undefined,
      evidence: evidence(list.slice(0, 4).map((w) => w.raw)),
      data: { tokens },
    }),
  ];
}

function simpleWarnings(w: WarningsByKind): Problem[] {
  const problems: Problem[] = [];
  for (const float of w.get('float-too-large')) {
    problems.push(
      compact({
        rule: 'float-too-large',
        check: 'output' as const,
        severity: 'warning' as const,
        message: `A figure or table is ${Number(float.data.amountPt).toFixed(1)}pt taller than the page`,
        location: location(float.file, float.line),
        detail: 'The float does not fit on a page, so it runs into the bottom margin.',
        fix: 'Scale it down (`height=0.8\\textheight`), split a long table (`longtable`), or shrink its font.',
        evidence: float.raw,
      }),
    );
  }
  for (const font of w.get('font-feature')) {
    problems.push(
      compact({
        rule: 'font-feature-missing',
        check: 'output' as const,
        severity: 'warning' as const,
        message: `fontspec: ${font.message}`,
        location: location(font.file, font.line),
        detail:
          'The selected font lacks a requested feature or script, so text may look different than intended.',
        fix: 'Choose a font that supports the feature/script, or remove the option from `\\setmainfont`.',
        evidence: font.raw,
      }),
    );
  }
  return problems;
}

function missingIncludes(w: WarningsByKind): Problem[] {
  return w
    .get('no-file')
    .filter((x) => extension(String(x.data.file)) === 'tex')
    .map((x) =>
      compact({
        rule: 'missing-file',
        check: 'output' as const,
        severity: 'error' as const,
        message: `File ${code(String(x.data.file))} not found; its content is missing from the PDF`,
        location: location(x.file),
        detail: '`\\include` skips files it cannot find, so the build continues without that part.',
        fix: 'Check the path and spelling in `\\include{…}` (relative to the main file, case-sensitive).',
        evidence: x.raw,
        data: { file: x.data.file },
      }),
    );
}

function warningProblems(parsed: ParsedLog, buildFailed: boolean, thresholdPt: number): Problem[] {
  const w = indexWarnings(parsed.warnings);
  const state = staleState(parsed, w);
  const problems: Problem[] = [];
  const notInBib = new Set(w.get('bib-entry-not-found').map((x) => String(x.data.key)));

  let citations = w.get('undefined-citation');
  if (state.bibliography) {
    const raw = [...w.get('no-file'), ...w.get('rerun-biber'), ...w.get('rerun-bibtex')]
      .filter((x) => x.kind !== 'no-file' || extension(String(x.data.file)) === 'bbl')
      .map((x) => x.raw);
    // With a failed build latexmk stops before running Biber/BibTeX; the error is the root cause.
    if (!buildFailed) problems.push(bibliographyProblem(state, citations, raw));
    citations = citations.filter((c) => notInBib.has(String(c.data.key)));
  }
  problems.push(...undefinedCitations(citations, notInBib));

  let references = w.get('undefined-reference');
  if (state.references) {
    const raw = [...w.get('labels-changed'), ...w.get('rerun-latex')].map((x) => x.raw);
    if (!buildFailed) problems.push(rerunProblem(references, raw));
    // Intentional: with a failed build these undefined references are dropped, not
    // reported. latexmk stopped early, so they are usually forward references that resolve
    // on the next successful run; reporting them would push the author (or an agent) to
    // "fix" things that are not broken instead of fixing the first error first. A label
    // that is really missing still surfaces once the build error is fixed (the next log,
    // and the PDF "??" check).
    references = [];
  }
  problems.push(...undefinedReferences(references));

  const anyUndefined = w.get('undefined-citation').length + w.get('undefined-reference').length > 0;
  const summary = w.get('undefined-references-summary')[0];
  if (summary && !anyUndefined && !state.bibliography && !state.references) {
    problems.push({
      rule: 'undefined-reference',
      check: 'output',
      severity: 'error',
      message: 'Some references or citations are undefined',
      detail: 'LaTeX reported undefined references without naming them.',
      fix: 'Rebuild with `latexmk`; if the warning stays, check `\\ref`/`\\cite` keys against labels and the .bib file.',
      evidence: summary.raw,
    });
  }

  if (!state.bibliography) {
    for (const empty of w.get('empty-bibliography')) {
      problems.push(
        compact({
          rule: 'empty-bibliography',
          check: 'output' as const,
          severity: 'warning' as const,
          message: 'The bibliography is empty',
          location: location(empty.file, empty.line),
          detail:
            '`\\printbibliography` printed nothing: there are no citations, or no cited key was found in the .bib files.',
          fix: 'Cite sources with `\\cite{…}`, check `\\addbibresource{…}` points at the right .bib file, or use `\\nocite{*}` to list everything.',
          evidence: empty.raw,
        }),
      );
    }
  }

  problems.push(...duplicateLabels(w.get('duplicate-label')));
  problems.push(...overfullBoxes(w.get('overfull'), thresholdPt, parsed.errors));
  problems.push(...fontSubstitutions(w.get('font-substitution')));
  // Characters "missing" from nullfont only follow an earlier font error.
  const glyphs = w.get('missing-glyph').filter((x) => !(buildFailed && x.data.font === 'nullfont'));
  problems.push(...missingGlyphs(glyphs));
  problems.push(...pdfStringTokens(w.get('pdf-string-token')));
  problems.push(...simpleWarnings(w));
  problems.push(...missingIncludes(w));
  return problems;
}

// ---------------------------------------------------------------------------

function packagesOf(parsed: ParsedLog): Set<string> {
  return new Set(
    parsed.files
      .filter((f) => extension(f) === 'sty')
      .map((f) => f.replace(/^.*\//, '').replace(/\.sty$/, '')),
  );
}

function buildSummary(problems: Problem[], parsed: ParsedLog): string {
  const errors = problems.filter((p) => p.severity === 'error').length;
  const pdf = parsed.outputFile
    ? `${parsed.outputFile.name}, ${plural(parsed.outputFile.pages, 'page')}`
    : 'no PDF produced';
  if (errors === 0) return `Build succeeded (${pdf})`;
  return `${plural(errors, 'error')} (${pdf})`;
}

function outputSummary(problems: Problem[]): string {
  if (problems.length === 0) return 'No problems found in the output';
  const counts = new Map<string, number>();
  for (const p of problems) counts.set(p.rule, (counts.get(p.rule) ?? 0) + 1);
  return [...counts].map(([rule, n]) => `${n} × ${rule}`).join(', ');
}

function skipped(check: 'build' | 'output', reason: string): CheckResult {
  return { check, status: 'skipped', problems: [], skippedReason: reason };
}

/** Parses a log and produces the `build` and `output` checks. */
export function analyzeLog(text: string, opts: AnalyzeLogOptions = {}): LogAnalysis {
  const parsed = parseLog(text, { root: opts.root });
  if (text.trim() === '') {
    return {
      build: skipped('build', 'The log file is empty'),
      output: skipped('output', 'The log file is empty'),
      parsed,
    };
  }
  const threshold = opts.overfullThresholdPt ?? DEFAULT_OVERFULL_PT;
  const fromErrors = errorProblems(parsed, { packages: packagesOf(parsed) });
  const buildProblems = [
    ...fromErrors.filter((p) => p.check === 'build'),
    ...fatalWithoutError(parsed, fromErrors),
  ];
  const buildFailed = buildProblems.length > 0;
  const outputProblems = [
    ...fromErrors.filter((p) => p.check === 'output'),
    ...warningProblems(parsed, buildFailed, threshold),
  ];
  const build: CheckResult = {
    check: 'build',
    status: statusOf(buildProblems),
    problems: buildProblems,
    summary: buildSummary(buildProblems, parsed),
    stats: {
      errors: buildProblems.length,
      texErrors: parsed.errors.length,
      warnings: parsed.warnings.length,
      ...(parsed.outputFile ? { pages: parsed.outputFile.pages } : {}),
    },
  };
  const output: CheckResult = {
    check: 'output',
    status: statusOf(outputProblems),
    problems: outputProblems,
    summary: outputSummary(outputProblems),
    stats: {
      errors: outputProblems.filter((p) => p.severity === 'error').length,
      warnings: outputProblems.filter((p) => p.severity === 'warning').length,
    },
  };
  return { build, output, parsed };
}
