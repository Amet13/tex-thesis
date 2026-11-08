import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  accessibilityCheck,
  analyzeLog,
  CHECK_IDS,
  type CheckId,
  type CheckResult,
  citedKeys,
  type BibEntry,
  type BibParseIssue,
  missingKeys,
  type PdfFacts,
  type Problem,
  pdfOutputProblems,
  parseBibWithIssues,
  type Report,
  refsCheck,
  reportStatus,
  resolveProfile,
  statusOf,
  UnknownProfileError,
  type VeraPdfResult,
  venueCheck,
  verifyEntries,
} from '@overfull/core';
import { FileCache } from './cache.js';
import { type Config, loadConfig } from './config.js';
import { UsageError } from './io.js';
import { readPdfFacts } from './pdf.js';
import { listFiles, readAux, readIfExists, readTexFiles } from './project.js';
import { VERSION } from './version.js';
import { runVeraPdf } from './verapdf.js';

export interface CheckOptions {
  /** Project directory (default: process.cwd()). */
  cwd?: string;
  /** Path to overfull.yml (default: <cwd>/overfull.yml if present). */
  config?: string;
  checks?: CheckId[];
  profile?: string;
  pdf?: string;
  log?: string;
  aux?: string;
  bib?: string[];
  offline?: boolean;
  mailto?: string;
  /** Run veraPDF when installed (default true). */
  verapdf?: boolean;
  /** Use .overfull/cache/refs.json (default true). */
  cache?: boolean;
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
}

const skipped = (check: CheckId, reason: string): CheckResult => ({
  check,
  status: 'skipped',
  problems: [],
  skippedReason: reason,
});

interface Inputs {
  config: Config;
  root: string;
  logPath: string;
  pdfPath: string;
  log?: string;
  aux?: string;
  facts?: PdfFacts;
  factsError?: string;
}

async function gather(opts: CheckOptions, config: Config, needPdf: boolean): Promise<Inputs> {
  const root = config.root;
  const logPath = opts.log ?? `${config.jobname}.log`;
  const pdfPath = opts.pdf ?? `${config.jobname}.pdf`;
  const inputs: Inputs = { config, root, logPath, pdfPath };
  const log = readIfExists(join(root, logPath));
  if (log !== undefined) inputs.log = log;
  const aux = opts.aux ? readIfExists(join(root, opts.aux)) : readAux(root, config.jobname);
  if (aux !== undefined) inputs.aux = aux;
  if (needPdf && existsSync(join(root, pdfPath))) {
    try {
      inputs.facts = await readPdfFacts(join(root, pdfPath));
    } catch (err) {
      inputs.factsError = err instanceof Error ? err.message : String(err);
    }
  }
  return inputs;
}

function missingPdfReason(inp: Inputs): string {
  if (inp.factsError) return `Could not read ${inp.pdfPath}: ${inp.factsError}`;
  return `No ${inp.pdfPath} — run \`overfull build\` first`;
}

/** Drops PDF "??"/"[?]" findings the log already explains, to avoid double counting. */
export function mergeOutput(output: CheckResult, pdfProblems: Problem[]): CheckResult {
  const has = (re: RegExp) => output.problems.some((p) => re.test(p.rule));
  const extra = pdfProblems.filter((p) =>
    p.rule === 'pdf-unresolved-reference' ? !has(/undefined-reference|reference-undefined/) : !has(/undefined-citation|citation-undefined/),
  );
  if (extra.length === 0) return output;
  const problems = [...output.problems, ...extra];
  return { ...output, status: statusOf(problems), problems };
}

function buildAndOutput(inp: Inputs, wanted: Set<CheckId>): CheckResult[] {
  const out: CheckResult[] = [];
  if (inp.log === undefined) {
    const reason = `No ${inp.logPath} — run \`overfull build\` first`;
    if (wanted.has('build')) out.push(skipped('build', reason));
    if (wanted.has('output')) {
      if (inp.facts) {
        const problems = pdfOutputProblems(inp.facts);
        out.push({
          check: 'output',
          status: statusOf(problems),
          problems,
          summary: problems.length ? `${problems.length} problem(s) in the PDF text (no log)` : 'No "??" or "[?]" in the PDF (no log)',
        });
      } else out.push(skipped('output', reason));
    }
    return out;
  }
  const { build, output } = analyzeLog(inp.log, { root: inp.root });
  if (wanted.has('build')) out.push(build);
  if (wanted.has('output')) out.push(inp.facts ? mergeOutput(output, pdfOutputProblems(inp.facts)) : output);
  return out;
}

async function references(inp: Inputs, opts: CheckOptions): Promise<CheckResult> {
  const { config, root } = inp;
  const bibFiles = opts.bib ?? config.bib;
  if (bibFiles.length === 0) return skipped('references', 'No .bib file found (set `bib:` in overfull.yml)');
  const entries: BibEntry[] = [];
  const parseProblems: Problem[] = [];
  const missingFiles: string[] = [];
  for (const file of bibFiles) {
    const text = readIfExists(join(root, file));
    if (text === undefined) {
      missingFiles.push(file);
      continue;
    }
    const { entries: es, issues } = parseBibWithIssues(text) as { entries: BibEntry[]; issues: BibParseIssue[] };
    for (const e of es) entries.push({ ...e, file });
    for (const i of issues) {
      parseProblems.push({
        rule: 'bib-parse-error',
        check: 'references',
        severity: /^(duplicate field|undefined macro)/.test(i.message) ? 'warning' : 'error',
        message: i.message,
        location: { file, line: i.line },
        ...(i.key ? { data: { key: i.key } } : {}),
      });
    }
  }
  if (missingFiles.length === bibFiles.length) {
    return skipped('references', `Bibliography not found: ${missingFiles.join(', ')}`);
  }
  const bcf = readIfExists(join(root, `${config.jobname}.bcf`));
  const citeSource = [inp.aux, bcf].filter(Boolean).join('\n');
  const cited = citeSource ? citedKeys(citeSource) : undefined;
  const citeAll = cited?.includes('*') ?? false;
  const keys = cited?.filter((k) => k !== '*');
  const toVerify = !keys || citeAll ? entries : entries.filter((e) => keys.includes(e.key));
  const extra = [...parseProblems, ...(keys ? missingKeys(keys, entries) : [])];
  for (const f of missingFiles) {
    extra.push({
      rule: 'bib-file-missing',
      check: 'references',
      severity: 'error',
      message: `Bibliography file not found: ${f}`,
      fix: 'Fix the path in `bib:` (overfull.yml) or in `\\addbibresource`',
    });
  }
  const env = opts.env ?? process.env;
  const cache = opts.cache === false ? undefined : new FileCache(join(root, '.overfull', 'cache', 'refs.json'));
  const mailto = opts.mailto ?? config.references.mailto ?? env.OVERFULL_MAILTO;
  const openalexKey = env.OPENALEX_API_KEY;
  const results = await verifyEntries(toVerify, {
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(mailto ? { mailto } : {}),
    ...(openalexKey ? { openalexKey } : {}),
    ...(cache ? { cache } : {}),
    offline: opts.offline ?? false,
    ignore: config.references.ignore,
  });
  cache?.save();
  const result = refsCheck(results, { entries: toVerify, extra });
  if (!keys) {
    result.summary = `${result.summary ?? ''} — all entries checked (no .aux to tell which are cited)`.trim();
  }
  if (result.status === 'skipped' && result.problems.some((p) => p.severity !== 'info')) {
    // Offline: lookups skipped, but missing keys and parse errors still count.
    return { ...result, status: statusOf(result.problems) };
  }
  return result;
}

async function accessibility(inp: Inputs, opts: CheckOptions): Promise<CheckResult> {
  const level = inp.config.profile.accessibility ?? 'recommended';
  if (level === 'off') return skipped('accessibility', `Accessibility is off for profile ${inp.config.profile.id}`);
  if (!inp.facts) return skipped('accessibility', missingPdfReason(inp));
  let verapdf: VeraPdfResult | null | undefined;
  if (opts.verapdf !== false) verapdf = await runVeraPdf(join(inp.root, inp.pdfPath), opts.env);
  return accessibilityCheck(inp.facts, { verapdf, level });
}

function venue(inp: Inputs): CheckResult {
  const { config, root } = inp;
  const files = listFiles(root);
  const texFiles = readTexFiles(root, files);
  const result = venueCheck(config.profile, {
    ...(inp.facts ? { facts: inp.facts } : {}),
    ...(inp.aux !== undefined ? { aux: inp.aux } : {}),
    ...(inp.log !== undefined ? { log: inp.log } : {}),
    texFiles,
    files,
    main: config.main,
  });
  if (result.status === 'skipped' && !inp.facts) return skipped('venue', missingPdfReason(inp));
  return result;
}

/** Runs the selected checks on a project and returns the Report. Used by `overfull check` and the Action. */
export async function runCheck(opts: CheckOptions = {}): Promise<Report> {
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;
  const config = loadConfig(cwd, opts.config, env);
  if (opts.profile) {
    try {
      config.profile = resolveProfile({ ...config.venue, extends: opts.profile });
    } catch (err) {
      if (err instanceof UnknownProfileError) throw new UsageError(err.message);
      throw err;
    }
  }
  const selected = opts.checks ?? config.checks;
  const wanted = new Set(selected);
  const needPdf = ['output', 'accessibility', 'venue'].some((c) => wanted.has(c as CheckId));
  const inp = await gather({ ...opts, env }, config, needPdf);
  const results: CheckResult[] = [...buildAndOutput(inp, wanted)];
  if (wanted.has('references')) results.push(await references(inp, { ...opts, env }));
  if (wanted.has('accessibility')) results.push(await accessibility(inp, { ...opts, env }));
  if (wanted.has('venue')) results.push(venue(inp));
  results.sort((a, b) => CHECK_IDS.indexOf(a.check) - CHECK_IDS.indexOf(b.check));
  const target = existsSync(join(config.root, inp.pdfPath)) ? inp.pdfPath : config.main;
  return { tool: 'overfull', version: VERSION, target, status: reportStatus(results), checks: results };
}

/** Exit code for a report: 1 when it fails the `failOn` threshold. */
export function exitCodeFor(report: Report, failOn: 'error' | 'warning' | 'never'): number {
  if (failOn === 'never') return 0;
  if (report.status === 'fail') return 1;
  if (failOn === 'warning' && report.status === 'warn') return 1;
  return 0;
}

