import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  accessibilityCheck,
  analyzeLog,
  type BibEntry,
  type BibParseIssue,
  CHECK_IDS,
  type CheckId,
  type CheckResult,
  citedKeys,
  citesAll,
  missingKeys,
  type PdfFacts,
  type Problem,
  parseBibWithIssues,
  pdfOutputProblems,
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
import { FileCache, refsCachePath, trackedByGit } from './cache.js';
import { type Config, loadConfig } from './config.js';
import { UsageError } from './io.js';
import { readPdfFacts } from './pdf.js';
import { listFiles, readAux, readIfExists, readTexFiles } from './project.js';
import { insideRoot } from './safety.js';
import { dockerAvailable, dockerImagePresent, which } from './tools.js';
import { type DockerTools, runVeraPdf } from './verapdf.js';
import { VERSION } from './version.js';

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
  /** Cache reference lookups (default true): in the user cache dir, or `.overfull/cache` with `references.cache: project`. */
  cache?: boolean;
  /**
   * Where veraPDF and pdffonts run when not installed locally: `auto` (default)
   * uses the Overfull image if Docker has it, `docker` always may (pulling it),
   * `local` never uses Docker.
   */
  engine?: 'auto' | 'local' | 'docker';
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
  bcf?: string;
  facts?: PdfFacts;
  factsError?: string;
  docker?: DockerTools;
}

/** A project-relative display path with forward slashes. */
const rel = (root: string, abs: string) => relative(root, abs).split('\\').join('/') || '.';

/** The image to run veraPDF/pdffonts in when they are not installed, or undefined. */
async function dockerTools(opts: CheckOptions, config: Config): Promise<DockerTools | undefined> {
  const engine = opts.engine ?? 'auto';
  if (engine === 'local') return undefined;
  const env = opts.env ?? process.env;
  if (which('verapdf', env) && which('pdffonts', env)) return undefined;
  if (!(await dockerAvailable(env))) return undefined;
  if (engine === 'auto' && !(await dockerImagePresent(config.build.image))) return undefined;
  return { image: config.build.image, root: config.root };
}

async function gather(opts: CheckOptions, config: Config, needPdf: boolean): Promise<Inputs> {
  const root = config.root;
  const out = config.build.outDir;
  const aux = config.build.auxDir;
  // Paths from options (CLI flags, Action inputs) must stay inside the project.
  const logAbs = opts.log
    ? insideRoot(root, opts.log, 'Log file')
    : insideRoot(root, join(aux, `${config.jobname}.log`), 'Log file');
  const pdfAbs = opts.pdf
    ? insideRoot(root, opts.pdf, 'PDF')
    : insideRoot(root, join(out, `${config.jobname}.pdf`), 'PDF');
  const inputs: Inputs = { config, root, logPath: rel(root, logAbs), pdfPath: rel(root, pdfAbs) };
  const log = readIfExists(logAbs);
  if (log !== undefined) inputs.log = log;
  const auxText = opts.aux
    ? readIfExists(insideRoot(root, opts.aux, 'Aux file'))
    : readAux(root, config.jobname, aux);
  if (auxText !== undefined) inputs.aux = auxText;
  const bcf = readIfExists(insideRoot(root, join(aux, `${config.jobname}.bcf`), 'Bcf file'));
  if (bcf !== undefined) inputs.bcf = bcf;
  if (needPdf && existsSync(pdfAbs)) {
    if (opts.verapdf !== false && (opts.checks ?? config.checks).includes('accessibility'))
      inputs.docker = await dockerTools(opts, config);
    try {
      inputs.facts = await readPdfFacts(pdfAbs, inputs.docker ? { docker: inputs.docker } : {});
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
    p.rule === 'pdf-unresolved-reference'
      ? !has(/undefined-reference|reference-undefined/)
      : !has(/undefined-citation|citation-undefined/),
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
          summary: problems.length
            ? `${problems.length} problem(s) in the PDF text (no log)`
            : 'No "??" or "[?]" in the PDF (no log)',
        });
      } else out.push(skipped('output', reason));
    }
    return out;
  }
  const { build, output } = analyzeLog(inp.log, { root: inp.root });
  if (wanted.has('build')) out.push(build);
  if (wanted.has('output'))
    out.push(inp.facts ? mergeOutput(output, pdfOutputProblems(inp.facts)) : output);
  return out;
}

async function references(inp: Inputs, opts: CheckOptions): Promise<CheckResult> {
  const { config, root } = inp;
  const bibFiles = opts.bib ?? config.bib;
  if (bibFiles.length === 0)
    return skipped('references', 'No .bib file found (set `bib:` in overfull.yml)');
  const entries: BibEntry[] = [];
  const parseProblems: Problem[] = [];
  const missingFiles: string[] = [];
  for (const file of bibFiles) {
    const text = readIfExists(insideRoot(root, file, 'Bibliography file'));
    if (text === undefined) {
      missingFiles.push(file);
      continue;
    }
    const { entries: es, issues } = parseBibWithIssues(text) as {
      entries: BibEntry[];
      issues: BibParseIssue[];
    };
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
  // Read .aux and .bcf separately: each has its own syntax.
  const sources = [inp.aux, inp.bcf].filter((x): x is string => Boolean(x));
  const keys = sources.length ? [...new Set(sources.flatMap((t) => citedKeys(t)))] : undefined;
  // \nocite{*}: every entry is cited, so every entry is verified.
  const citeAll = sources.some((t) => citesAll(t));
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
  let cache: FileCache | undefined;
  if (opts.cache !== false) {
    const path = refsCachePath(root, config.references.cache, env);
    const inCi = env.CI === 'true' || env.GITHUB_ACTIONS === 'true';
    if (
      config.references.cache === 'project' &&
      inCi &&
      existsSync(path) &&
      trackedByGit(root, path)
    ) {
      // A cache committed in a pull request must not make references "verified".
      extra.push({
        rule: 'refs-cache-ignored',
        check: 'references',
        severity: 'info',
        message: `Ignored ${rel(root, path)}: it is tracked by git, and in CI a committed cache is not trusted`,
        fix: 'Remove it from git (`git rm --cached .overfull/cache/refs.json`) and ignore `.overfull/`',
      });
    } else cache = new FileCache(path);
  }
  const mailto = opts.mailto ?? config.references.mailto ?? env.OVERFULL_MAILTO;
  const openalexKey = env.OPENALEX_API_KEY;
  const refsOptions: Parameters<typeof verifyEntries>[1] & { requireProvenance?: boolean } = {
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(mailto ? { mailto } : {}),
    ...(openalexKey ? { openalexKey } : {}),
    ...(cache ? { cache } : {}),
    offline: opts.offline ?? false,
    ignore: config.references.ignore,
    ...(config.references.requireCite ? { requireProvenance: true } : {}),
  };
  const results = await verifyEntries(toVerify, refsOptions);
  cache?.save();
  const result = refsCheck(results, { entries: toVerify, extra });
  if (!keys) {
    result.summary =
      `${result.summary ?? ''} — all entries checked (no .aux to tell which are cited)`.trim();
  }
  if (result.status === 'skipped' && result.problems.some((p) => p.severity !== 'info')) {
    // Offline: lookups skipped, but missing keys and parse errors still count.
    return { ...result, status: statusOf(result.problems) };
  }
  return result;
}

async function accessibility(inp: Inputs, opts: CheckOptions): Promise<CheckResult> {
  const level = inp.config.profile.accessibility ?? 'recommended';
  if (level === 'off')
    return skipped('accessibility', `Accessibility is off for profile ${inp.config.profile.id}`);
  if (!inp.facts) return skipped('accessibility', missingPdfReason(inp));
  let verapdf: VeraPdfResult | null | undefined;
  if (opts.verapdf !== false)
    verapdf = await runVeraPdf(join(inp.root, inp.pdfPath), opts.env, {
      ...(inp.facts.pdfua !== undefined ? { pdfuaPart: inp.facts.pdfua } : {}),
      ...(inp.docker ? { docker: inp.docker } : {}),
    });
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
  return {
    tool: 'overfull',
    version: VERSION,
    target,
    status: reportStatus(results),
    checks: results,
  };
}

/** Exit code for a report: 1 when it fails the `failOn` threshold. */
export function exitCodeFor(report: Report, failOn: 'error' | 'warning' | 'never'): number {
  if (failOn === 'never') return 0;
  if (report.status === 'fail') return 1;
  if (failOn === 'warning' && report.status === 'warn') return 1;
  return 0;
}
