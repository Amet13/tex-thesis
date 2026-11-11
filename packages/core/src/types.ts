/**
 * Shared result model for every Overfull check.
 *
 * Every check (build log, output, references, accessibility, venue) reports
 * `Problem`s grouped into a `CheckResult`. Reporters (terminal, JSON, Markdown,
 * GitHub annotations) only ever see this model, so a person, a CI job and an
 * AI agent all receive the same facts.
 */

export type Severity = 'error' | 'warning' | 'info';

/** The five checks Overfull runs. Order here is the order reports use. */
export const CHECK_IDS = ['build', 'output', 'references', 'accessibility', 'venue'] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skipped';

export interface Location {
  /** Path relative to the project root, forward slashes. */
  file?: string;
  /** 1-based source line. */
  line?: number;
  /** 1-based PDF page. */
  page?: number;
}

export interface Problem {
  /** Stable kebab-case rule id, e.g. `undefined-control-sequence`. Never renamed once released. */
  rule: string;
  check: CheckId;
  severity: Severity;
  /** One line, plain language, no trailing period needed. */
  message: string;
  location?: Location;
  /** Why it happened. Plain text; inline code in `backticks`. */
  detail?: string;
  /** What to do. Plain text; inline code in `backticks`. */
  fix?: string;
  /** Number of follow-on problems hidden under this one (log cascades). */
  related?: number;
  /** Raw evidence (log lines, bib entry), for humans who want to dig in. */
  evidence?: string;
  /** Machine-readable extras for agents (keys, labels, measurements). */
  data?: Record<string, unknown>;
}

export interface CheckResult {
  check: CheckId;
  status: CheckStatus;
  problems: Problem[];
  /** Short human summary, e.g. "28 of 31 references verified". */
  summary?: string;
  /** Present when status is `skipped`. */
  skippedReason?: string;
  /** Counters for summaries, e.g. { verified: 28, notFound: 1 }. */
  stats?: Record<string, number>;
}

export interface Report {
  tool: 'overfull';
  version: string;
  /** What was checked, e.g. `thesis.pdf`. */
  target?: string;
  /** Present when there was no overfull.yml: what the run assumed. */
  assumed?: {
    main: string;
    /** How the main file was chosen: `--main`, `main.tex`, `detected` (the only or the built document) or `default`. */
    mainSource: string;
    jobname: string;
    profile: string;
    bib: string[];
  };
  /** `skipped`: every check was skipped, so nothing was checked (never a pass). */
  status: CheckStatus;
  checks: CheckResult[];
}

/** Documentation for one rule. Drives `overfull explain`, the website and the agent skills. */
export interface RuleInfo {
  id: string;
  check: CheckId;
  severity: Severity;
  title: string;
  /** One or two sentences: what it means. */
  summary: string;
  /** Default fix advice. */
  fix: string;
  /** Optional minimal LaTeX that triggers the rule (corpus case id, if one exists). */
  corpus?: string;
}

/** Computes a CheckResult status from its problems. */
export function statusOf(problems: Problem[]): Exclude<CheckStatus, 'skipped'> {
  if (problems.some((p) => p.severity === 'error')) return 'fail';
  if (problems.some((p) => p.severity === 'warning')) return 'warn';
  return 'pass';
}

/**
 * Computes the overall report status. Skipped checks are ignored, unless every check
 * was skipped: then nothing was checked and the status is `skipped`, not `pass`.
 */
export function reportStatus(checks: CheckResult[]): Report['status'] {
  if (checks.length > 0 && checks.every((c) => c.status === 'skipped')) return 'skipped';
  if (checks.some((c) => c.status === 'fail')) return 'fail';
  if (checks.some((c) => c.status === 'warn')) return 'warn';
  return 'pass';
}
