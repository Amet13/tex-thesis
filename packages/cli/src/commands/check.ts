import { type Dirent, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  formatHuman,
  formatJson,
  formatMarkdown,
  formatSarif,
  githubAnnotations,
} from '@overfull/core';
import { list, type Parsed, parse, str } from '../args.js';
import { exitCodeFor, runCheck, sarifFallbackFile } from '../check.js';
import { parseChecks } from '../config.js';
import { type Io, progressLine, UsageError, useColor } from '../io.js';
import { isCI } from '../safety.js';

export const checkHelp = `Usage: overfull check [file...] [options]

Check the built document: build log, PDF output, references, accessibility, venue rules.
Reads <jobname>.log / .pdf / .aux and the .bib files named in overfull.yml.
Without overfull.yml, the main file is main.tex, or the only .tex file here with
a \\documentclass; check says what it assumed.

Files (optional): a .tex file is the main file; .bib, .log, .pdf and .aux files
are the same as --bib, --log, --pdf and --aux. Only .bib files: check references only.
  overfull check paper.tex
  overfull check refs.bib

Options:
  --main file         Main .tex file (default from overfull.yml, else detected)
  --checks a,b        Only these checks (build, output, references, accessibility, venue)
  --profile name      Venue profile: generic, thesis, paper, arxiv, double-blind
  --offline           Do not look references up online
  --refresh           Ignore cached reference answers and look everything up again
                      (the new answers are still cached)
  --fail-on level     error (default), warning or never
  --json              Print the report as JSON (stable, for agents and scripts)
  --markdown          Print a Markdown summary (GitHub job summary / PR comment)
  --annotations       Print GitHub workflow annotations
  --sarif             Print a SARIF 2.1.0 log (GitHub code scanning upload)
  --verbose, -v       Show why and how to fix each problem
  --watch             Check again whenever the log, PDF, .aux or a .bib file changes
                      (references are looked up again only when a .bib changed);
                      stop with Ctrl-C. Human output only.
  --pdf file          PDF to check (default <jobname>.pdf)
  --log file          Build log (default <jobname>.log)
  --aux file          .aux file (default <jobname>.aux)
  --bib a.bib,b.bib   Bibliography files (default from overfull.yml or main.tex)
  --mailto address    Contact address for CrossRef's polite pool
  --no-verapdf        Do not run veraPDF even if installed
  --engine e          Where veraPDF/pdffonts run if not installed: auto (default: the
                      Overfull image when Docker already has it), docker, or local
  --image name        Image for veraPDF/pdffonts (default $OVERFULL_IMAGE, else the
                      Overfull image). build.image in overfull.yml is not used by check:
                      check never runs code chosen by the project.
  --config file       Config file (default overfull.yml)
  -h, --help          Show this help

Exit codes: 0 pass (or warnings without --fail-on warning), 1 fail, 2 usage error.
`;

interface FileArgs {
  main?: string;
  pdf?: string;
  log?: string;
  aux?: string;
  bib: string[];
  onlyBib: boolean;
}

/** Sorts positional files by extension and merges them with the --main/--pdf/--log/--aux/--bib flags. */
function classifyFiles(positionals: string[], values: Parsed['values']): FileArgs {
  const out: FileArgs = {
    bib: list(values.bib) ?? [],
    onlyBib: false,
  };
  for (const k of ['main', 'pdf', 'log', 'aux'] as const) {
    const v = str(values[k]);
    if (v) out[k] = v;
  }
  const positionalBib: string[] = [];
  let others = 0;
  for (const p of positionals) {
    const ext = /\.([A-Za-z0-9]+)$/.exec(p)?.[1]?.toLowerCase();
    if (ext === 'bib') {
      positionalBib.push(p);
      continue;
    }
    const key =
      ext === 'tex' ? 'main' : ext === 'pdf' || ext === 'log' || ext === 'aux' ? ext : undefined;
    if (!key)
      throw new UsageError(
        `Cannot check "${p}": expected a .tex, .bib, .log, .pdf or .aux file.\nRun \`overfull check --help\` for usage.`,
      );
    if (out[key])
      throw new UsageError(
        `Two ${key === 'main' ? 'main .tex' : `.${key}`} files given (${out[key]} and ${p}). Check one at a time.`,
      );
    out[key] = p;
    others++;
  }
  out.bib.push(...positionalBib);
  out.onlyBib =
    positionalBib.length > 0 &&
    others === 0 &&
    !values.main &&
    !values.pdf &&
    !values.log &&
    !values.aux;
  return out;
}

export async function checkCommand(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parse(
    args,
    {
      checks: { type: 'string' },
      profile: { type: 'string' },
      offline: { type: 'boolean' },
      refresh: { type: 'boolean' },
      'fail-on': { type: 'string' },
      json: { type: 'boolean' },
      markdown: { type: 'boolean' },
      annotations: { type: 'boolean' },
      sarif: { type: 'boolean' },
      verbose: { type: 'boolean', short: 'v' },
      watch: { type: 'boolean' },
      main: { type: 'string' },
      pdf: { type: 'string' },
      log: { type: 'string' },
      aux: { type: 'string' },
      bib: { type: 'string' },
      mailto: { type: 'string' },
      'no-verapdf': { type: 'boolean' },
      engine: { type: 'string' },
      image: { type: 'string' },
      config: { type: 'string' },
    },
    'check',
  );
  if (values.help) {
    io.stdout(checkHelp);
    return 0;
  }
  const failOn = str(values['fail-on']) ?? 'error';
  if (!['error', 'warning', 'never'].includes(failOn)) {
    throw new UsageError(`--fail-on must be error, warning or never, got "${failOn}"`);
  }
  const formats = ['json', 'markdown', 'annotations', 'sarif'].filter((f) => values[f]);
  if (formats.length > 1)
    throw new UsageError(
      `Choose one output format, not ${formats.map((f) => `--${f}`).join(' and ')}`,
    );
  const engine = str(values.engine) ?? 'auto';
  if (!['auto', 'local', 'docker'].includes(engine))
    throw new UsageError(`--engine must be auto, local or docker, got "${engine}"`);
  const files = classifyFiles(positionals, values);
  const checksArg = list(values.checks) ?? (files.onlyBib ? ['references'] : undefined);
  const machine = Boolean(values.json || values.markdown || values.annotations || values.sarif);
  if (values.watch && machine)
    throw new UsageError(
      '--watch prints the human report; leave out --json, --markdown, --annotations and --sarif',
    );
  const progress = machine || isCI(io.env) ? undefined : progressLine(io, 'references');
  const runOnce = async (offline: boolean) => {
    const report = await runCheck({
      cwd: io.cwd,
      env: io.env,
      ...(io.fetch ? { fetch: io.fetch } : {}),
      ...(str(values.config) ? { config: str(values.config) } : {}),
      ...(checksArg ? { checks: parseChecks(checksArg, '--checks', '--checks') } : {}),
      ...(str(values.profile) ? { profile: str(values.profile) } : {}),
      ...(files.main ? { main: files.main } : {}),
      ...(files.pdf ? { pdf: files.pdf } : {}),
      ...(files.log ? { log: files.log } : {}),
      ...(files.aux ? { aux: files.aux } : {}),
      ...(files.bib.length ? { bib: files.bib } : {}),
      ...(str(values.mailto) ? { mailto: str(values.mailto) } : {}),
      offline,
      ...(values.refresh ? { refresh: true } : {}),
      ...(progress ? { progress } : {}),
      verapdf: values['no-verapdf'] !== true,
      engine: engine as 'auto' | 'local' | 'docker',
      ...(str(values.image) ? { image: str(values.image) } : {}),
    });
    if (!machine && report.assumed?.mainSource === 'default' && report.status === 'skipped') {
      io.stderr(
        `No ${report.assumed.main} here and no other LaTeX document found. Run in the project folder, or name the main file: \`overfull check paper.tex\`.\n`,
      );
    } else if (!machine && report.assumed) {
      const a = report.assumed;
      io.stderr(
        `No overfull.yml: assuming main ${a.main}${a.mainSource === 'detected' ? ' (the only document here)' : ''}, profile ${a.profile}. Run \`overfull init --here\` to save these settings.\n`,
      );
    }
    if (values.json) io.stdout(formatJson(report));
    else if (values.markdown) io.stdout(formatMarkdown(report));
    else if (values.sarif) {
      const fallbackFile = sarifFallbackFile(io.cwd, io.env, str(values.config), files.main);
      io.stdout(formatSarif(report, fallbackFile ? { fallbackFile } : {}));
    } else if (values.annotations) {
      const lines = githubAnnotations(report);
      io.stdout(lines.length ? `${lines.join('\n')}\n` : '');
    } else
      io.stdout(formatHuman(report, { color: useColor(io), verbose: values.verbose === true }));
    return exitCodeFor(report, failOn as 'error' | 'warning' | 'never');
  };
  const offline = values.offline === true;
  if (!values.watch) return runOnce(offline);
  return watch(io, runOnce, offline);
}

/** Files whose change starts a new check, as path → "mtime:size". */
export function watchedState(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string, depth: number) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < 3) walk(p, depth + 1);
      } else if (e.isFile() && WATCHED.test(e.name)) {
        try {
          const st = statSync(p);
          out.set(p, `${st.mtimeMs}:${st.size}`);
        } catch {
          /* vanished between listing and stat: not watched */
        }
      }
    }
  };
  walk(root, 0);
  return out;
}

const WATCHED = /\.(?:log|pdf|aux|bcf|bib)$/i;

/** What changed between two states: anything, and whether a .bib file did. */
export function changes(
  before: Map<string, string>,
  after: Map<string, string>,
): { any: boolean; bib: boolean } {
  let any = false;
  let bib = false;
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(key) === after.get(key)) continue;
    any = true;
    if (/\.bib$/i.test(key)) bib = true;
  }
  return { any, bib };
}

async function watch(
  io: Io,
  runOnce: (offline: boolean) => Promise<number>,
  offline: boolean,
): Promise<number> {
  const intervalMs = Number(io.env.OVERFULL_WATCH_INTERVAL_MS) || 1000;
  // Ctrl-C ends the watch with the last exit code (only the real CLI has no signal).
  let signal = io.signal;
  if (!signal) {
    const stop = new AbortController();
    process.once('SIGINT', () => stop.abort());
    signal = stop.signal;
  }
  let code = await runOnce(offline);
  let state = watchedState(io.cwd);
  io.stderr('Watching the log, PDF, .aux and .bib files. Press Ctrl-C to stop.\n');
  while (!signal.aborted) {
    await new Promise<void>((done) => {
      const t = setTimeout(done, intervalMs);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        done();
      });
    });
    if (signal.aborted) break;
    const next = watchedState(io.cwd);
    const c = changes(state, next);
    state = next;
    if (!c.any) continue;
    io.stderr(`\n— ${new Date().toLocaleTimeString()} —\n`);
    // Reference lookups only when a bibliography changed; otherwise the cached answers stand.
    code = await runOnce(offline || !c.bib);
  }
  return code;
}
