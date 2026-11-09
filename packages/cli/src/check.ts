import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  accessibilityCheck,
  analyzeLog,
  attributeBibliography,
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
  sortProblems,
  statusOf,
  type TexFile,
  UnknownProfileError,
  type VeraPdfResult,
  venueCheck,
  verifyEntries,
} from '@overfull/core';
import { FileCache, MemoryCache, refsCachePath, symlinkOnPath } from './cache.js';
import { type Config, DEFAULT_IMAGE, loadConfig } from './config.js';
import { UsageError } from './io.js';
import { readPdfFacts } from './pdf.js';
import { listFiles, readAux, readIfExists, readTexFiles, requireRegularFile } from './project.js';
import { insideRoot, insideRootOrUndefined, isCI, safeImage } from './safety.js';
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
  /**
   * Image for veraPDF/pdffonts in Docker. Default $OVERFULL_IMAGE, else the
   * Overfull image; `build.image` in overfull.yml is ignored by `check`.
   */
  image?: string;
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
  /** Project sources, read once on first use (venue, accessibility, citation locations). */
  sources?: { files: string[]; texFiles: TexFile[]; skipped: { path: string; reason: string }[] };
}

function sourcesOf(inp: Inputs): NonNullable<Inputs['sources']> {
  if (!inp.sources) {
    const files = listFiles(inp.root);
    const skipped: { path: string; reason: string }[] = [];
    inp.sources = { files, texFiles: readTexFiles(inp.root, files, skipped), skipped };
  }
  return inp.sources;
}

/** A project-relative display path with forward slashes. */
const rel = (root: string, abs: string) => relative(root, abs).split('\\').join('/') || '.';

/**
 * The image `check` may run veraPDF/pdffonts in: `--image`, else $OVERFULL_IMAGE,
 * else the default. Never `build.image` from overfull.yml: the project is
 * untrusted input to `check`, and must not choose code to run.
 */
export function checkImage(opts: Pick<CheckOptions, 'image' | 'env'>): string {
  const env = opts.env ?? process.env;
  if (opts.image) return safeImage(opts.image, '--image');
  if (env.OVERFULL_IMAGE) return safeImage(env.OVERFULL_IMAGE, 'OVERFULL_IMAGE');
  return DEFAULT_IMAGE;
}

/** The image to run veraPDF/pdffonts in when they are not installed, or undefined. */
async function dockerTools(opts: CheckOptions, config: Config): Promise<DockerTools | undefined> {
  const engine = opts.engine ?? 'auto';
  if (engine === 'local') return undefined;
  const env = opts.env ?? process.env;
  if (which('verapdf', env, { allowBatch: true }) && which('pdffonts', env)) return undefined;
  if (!(await dockerAvailable(env))) return undefined;
  const image = checkImage(opts);
  if (engine === 'auto' && !(await dockerImagePresent(image))) return undefined;
  return { image, root: config.root };
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
  if (needPdf && existsSync(pdfAbs)) requireRegularFile(pdfAbs);
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

/**
 * Points errors from typeset bibliography entries at the .bib entry (see core's
 * attributeBibliography). Reads `<jobname>.bbl` and the configured .bib files.
 */
export function bibliographyAttribution(
  config: Config,
  bib: string[] = config.bib,
): (problems: Problem[]) => Problem[] {
  const root = config.root;
  const bblRel = join(config.build.auxDir, `${config.jobname}.bbl`).split('\\').join('/');
  const bblAbs = insideRootOrUndefined(root, bblRel);
  let bblText: string | undefined;
  try {
    bblText = bblAbs ? readIfExists(bblAbs) : undefined;
  } catch {
    bblText = undefined;
  }
  if (bblText === undefined) return (p) => p;
  const bibs: { file: string; text: string }[] = [];
  for (const file of bib) {
    const abs = insideRootOrUndefined(root, file);
    try {
      const text = abs ? readIfExists(abs) : undefined;
      if (text !== undefined) bibs.push({ file, text });
    } catch {
      /* not a file: skip */
    }
  }
  const bbl = { path: bblRel.replace(/^\.\//, ''), text: bblText };
  return (problems) => attributeBibliography(problems, { bbl, bibs });
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
  const analyzed = analyzeLog(inp.log, { root: inp.root });
  const attribute = bibliographyAttribution(inp.config);
  const build = { ...analyzed.build, problems: attribute(analyzed.build.problems) };
  const output = { ...analyzed.output, problems: attribute(analyzed.output.problems) };
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
  // Paths the user gave (--bib, `bib:`) must be inside the project; paths found
  // inside the main file are only skipped, with a note, when they are not.
  const discovered = !opts.bib && config.bibDiscovered;
  const outside: string[] = [];
  for (const file of bibFiles) {
    const abs = discovered
      ? insideRootOrUndefined(root, file)
      : insideRoot(root, file, 'Bibliography file');
    if (abs === undefined) {
      outside.push(file);
      continue;
    }
    const text = readIfExists(abs);
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
  const outsideProblems: Problem[] = outside.map((f) => ({
    rule: 'bib-outside-project',
    check: 'references',
    severity: 'warning',
    message: `References in ${f} were not checked: it is outside the project directory`,
    fix: 'Pass it explicitly with `--bib` from a directory that contains it, or move it into the project.',
    data: { file: f },
  }));
  if (missingFiles.length + outside.length === bibFiles.length) {
    if (!outside.length)
      return skipped('references', `Bibliography not found: ${missingFiles.join(', ')}`);
    return {
      check: 'references',
      status: 'warn',
      problems: outsideProblems,
      summary: `No bibliography inside the project was checked${missingFiles.length ? ` (not found: ${missingFiles.join(', ')})` : ''}`,
    };
  }
  // Read .aux and .bcf separately: each has its own syntax.
  const sources = [inp.aux, inp.bcf].filter((x): x is string => Boolean(x));
  const keys = sources.length ? [...new Set(sources.flatMap((t) => citedKeys(t)))] : undefined;
  // \nocite{*}: every entry is cited, so every entry is verified.
  const citeAll = sources.some((t) => citesAll(t));
  const toVerify = !keys || citeAll ? entries : entries.filter((e) => keys.includes(e.key));
  const extra = [
    ...outsideProblems,
    ...parseProblems,
    ...(keys ? missingKeys(keys, entries, sourcesOf(inp).texFiles) : []),
  ];
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
  let cache: FileCache | MemoryCache | undefined;
  if (opts.cache !== false) {
    const path = refsCachePath(root, config.references.cache, env);
    const project = config.references.cache === 'project';
    const link = project ? symlinkOnPath(root, path) : undefined;
    if (project && isCI(env)) {
      // A project-located cache is repository content: in CI (a pull request, an
      // artifact, a tarball without .git) it must never mark references as verified.
      cache = new MemoryCache();
      if (existsSync(path) || link) {
        extra.push({
          rule: 'refs-cache-ignored',
          check: 'references',
          severity: 'info',
          message: `Ignored ${rel(root, path)}: in CI a reference cache inside the project is not trusted`,
          fix: 'Nothing to do in CI. Keep `.overfull/` out of git (add it to .gitignore).',
        });
      }
    } else if (link) {
      cache = new MemoryCache();
      extra.push({
        rule: 'refs-cache-ignored',
        check: 'references',
        severity: 'info',
        message: `Ignored ${rel(root, path)}: ${rel(root, link)} is a symlink, so the cache may be a file from the repository`,
        fix: 'Replace the symlink with a real directory, or drop `references.cache: project`.',
      });
    } else cache = new FileCache(path);
  }
  const mailto = opts.mailto ?? config.references.mailto ?? env.OVERFULL_MAILTO;
  const openalexKey = env.OPENALEX_API_KEY;
  const refsOptions: Parameters<typeof verifyEntries>[1] = {
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
  const result = refsCheck(results, {
    entries: toVerify,
    extra,
    requireProvenance: config.references.requireCite,
  });
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
  return accessibilityCheck(inp.facts, { verapdf, level, texFiles: sourcesOf(inp).texFiles });
}

function venue(inp: Inputs): CheckResult {
  const { config } = inp;
  const { files, texFiles, skipped: skippedFiles } = sourcesOf(inp);
  const result = venueCheck(config.profile, {
    ...(inp.facts ? { facts: inp.facts } : {}),
    ...(inp.aux !== undefined ? { aux: inp.aux } : {}),
    ...(inp.log !== undefined ? { log: inp.log } : {}),
    texFiles,
    files,
    main: config.main,
  });
  if (result.status === 'skipped' && !inp.facts) return skipped('venue', missingPdfReason(inp));
  if (skippedFiles.length) {
    result.problems.push(
      ...skippedFiles.map(
        (f): Problem => ({
          rule: 'tex-file-skipped',
          check: 'venue',
          severity: 'info',
          message: `${f.path} was not read: ${f.reason}`,
          location: { file: f.path },
        }),
      ),
    );
  }
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
  for (const r of results) r.problems = sortProblems(r.problems);
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
