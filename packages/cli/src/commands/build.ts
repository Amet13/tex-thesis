import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import {
  analyzeLog,
  type CheckResult,
  formatHuman,
  formatJson,
  pdfOutputProblems,
  type Report,
  reportStatus,
  sortProblems,
} from '@overfull/core';
import { parse, str } from '../args.js';
import { bibliographyAttribution, mergeOutput } from '../check.js';
import { type Config, type Engine, loadConfig } from '../config.js';
import { type Io, UsageError, useColor } from '../io.js';
import { readPdfFacts } from '../pdf.js';
import { readIfExists } from '../project.js';
import { insideRoot, safeImage, safeJobname, safeRelPath } from '../safety.js';
import {
  batchOnly,
  dockerAvailable,
  dockerImagePresent,
  dockerRunArgs,
  imageUnavailable,
  imageUnavailableMessage,
  run,
  which,
} from '../tools.js';
import { VERSION } from '../version.js';

export const buildHelp = `Usage: overfull build [main.tex] [options]

Compile the document with latexmk, then check the build log and PDF output.
Uses a local latexmk if installed, otherwise the Overfull Docker image.

Options:
  --engine e      auto (default), local or docker
  --image name    Docker image. Precedence: --image, then $OVERFULL_IMAGE, then
                  build.image in overfull.yml, then ghcr.io/amet13/overfull:3
  --verbose, -v   Show latexmk output and fixes for each problem
  --force         Rebuild even when nothing changed since the last build
  --json          Print the report as JSON (same shape as \`overfull check --json\`)
  --config file   Config file (default overfull.yml)
  -h, --help      Show this help

Uses -lualatex unless the project has a .latexmkrc (then latexmk follows it).
Output goes to build.outDir from overfull.yml (passed as -outdir/-auxdir), else
the $out_dir of a .latexmkrc, else the project directory.
Only build projects you trust: a .latexmkrc is Perl code that latexmk runs.
Exit codes: 0 built, 1 build failed, 2 usage error.
`;

/**
 * latexmk arguments. latexmk builds a shell command line from the jobname,
 * the output directories and the main file, so each is validated here
 * (latexmk has no `--` end-of-options marker; a main file never starts with "-").
 */
export function latexmkArgs(config: Config, main: string): string[] {
  const rc =
    existsSync(join(config.root, '.latexmkrc')) || existsSync(join(config.root, 'latexmkrc'));
  const { outDir, auxDir, outDirFromConfig } = config.build;
  const dirs =
    outDirFromConfig || !rc
      ? [
          `-outdir=${safeRelPath(outDir, 'build.outDir')}`,
          `-auxdir=${safeRelPath(auxDir, 'build.outDir')}`,
        ]
      : [];
  return [
    ...(rc ? [] : ['-lualatex']),
    '-interaction=nonstopmode',
    '-file-line-error',
    `-jobname=${safeJobname(config.jobname)}`,
    ...dirs,
    safeRelPath(main),
  ];
}

export async function resolveEngine(
  engine: Engine,
  env: Io['env'],
  platform: NodeJS.Platform = process.platform,
): Promise<'local' | 'docker'> {
  const local = Boolean(which('latexmk', env, { platform }));
  // Windows: a latexmk.bat/.cmd cannot be started without cmd.exe, which would
  // re-parse the arguments; Overfull never runs it that way.
  const batch = local ? undefined : batchOnly('latexmk', env, platform);
  const batchMessage = `${batch} found, but Overfull cannot run a .bat/.cmd wrapper safely. Install latexmk.exe (MiKTeX or TeX Live provide one), or use \`--engine docker\`.`;
  if (engine === 'local') {
    if (batch) throw new UsageError(batchMessage);
    if (!local)
      throw new UsageError(
        'latexmk not found on PATH. Install TeX Live, or use `--engine docker`.',
      );
    return 'local';
  }
  if (engine === 'docker' || !local) {
    if (!(await dockerAvailable(env))) {
      throw new UsageError(
        engine === 'docker'
          ? 'Docker is not running. Start Docker, or use `--engine local` with TeX Live installed.'
          : batch
            ? batchMessage
            : 'Neither latexmk nor Docker is available. Install Docker (https://docs.docker.com/get-docker/) or TeX Live, then retry. `overfull doctor` shows what is missing.',
      );
    }
    return 'docker';
  }
  return 'local';
}

/** Files LaTeX writes during a build: their times say nothing about the sources. */
const GENERATED =
  /\.(aux|bbl|bcf|blg|fdb_latexmk|fls|lof|lot|lol|log|out|toc|nav|snm|vrb|xmpi|run\.xml|synctex\.gz|xdv|glo|gls|glg|idx|ind|ilg|ist)$|-luamml-mathml\.html$/i;

/**
 * True when the PDF is newer than every project file the last LaTeX run read
 * (from the `.fls` recorder file), the .bib files and the build configuration,
 * and the last log has no errors and asks for no rerun.
 */
export function upToDate(config: Config, main: string): boolean {
  const root = config.root;
  const pdf = join(root, config.build.outDir, `${config.jobname}.pdf`);
  const fls = [config.build.auxDir, config.build.outDir]
    .map((d) => join(root, d, `${config.jobname}.fls`))
    .find((p) => existsSync(p));
  const logPath = join(root, config.build.auxDir, `${config.jobname}.log`);
  if (!fls || !existsSync(pdf) || !existsSync(logPath)) return false;
  let pdfTime: number;
  let flsText: string;
  let log: string;
  try {
    pdfTime = statSync(pdf).mtimeMs;
    flsText = readFileSync(fls, 'utf8');
    log = readFileSync(logPath, 'utf8');
  } catch {
    return false;
  }
  if (
    /^! |^\S+:\d+: |Rerun to get|Please \(re\)run|Please rerun|may have changed|rerun LaTeX/m.test(
      log,
    )
  )
    return false;
  const pwd = /^PWD (.+)$/m.exec(flsText)?.[1]?.trim();
  const inputs = new Set<string>([main, ...config.bib, '.latexmkrc', 'latexmkrc']);
  if (config.file) inputs.add(relative(root, config.file));
  for (const m of flsText.matchAll(/^INPUT (.+)$/gm)) {
    let p = (m[1] as string).trim();
    if (isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p)) {
      if (!pwd || !p.startsWith(`${pwd}/`)) continue; // the TeX distribution
      p = p.slice(pwd.length + 1);
    }
    if (!GENERATED.test(p)) inputs.add(p);
  }
  for (const p of inputs) {
    const abs = join(root, p);
    if (abs === pdf) continue;
    try {
      if (statSync(abs).mtimeMs > pdfTime) return false;
    } catch {
      if (p === main) return false;
    }
  }
  return true;
}

/** Turns latexmk chatter into short progress lines ("lualatex (run 2)"). */
function progress(io: Io, verbose: boolean): (line: string) => void {
  return (line) => {
    if (verbose) {
      io.stderr(`${line}\n`);
      return;
    }
    const m =
      /Run number (\d+) of rule '([^']+)'/.exec(line) ??
      /Running '?(biber|bibtex|makeindex|makeglossaries)\b/.exec(line);
    if (!m) return;
    const rule = (m[2] ?? m[1] ?? '').replace(
      /^(pdf|lua|xe)?latex.*$/,
      (s) => s.split(/\s/)[0] ?? s,
    );
    io.stderr(m[2] ? `  ${rule} (run ${m[1]})\n` : `  ${rule}\n`);
  };
}

export async function buildCommand(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parse(
    args,
    {
      engine: { type: 'string' },
      image: { type: 'string' },
      verbose: { type: 'boolean', short: 'v' },
      json: { type: 'boolean' },
      force: { type: 'boolean' },
      config: { type: 'string' },
    },
    'build',
  );
  if (values.help) {
    io.stdout(buildHelp);
    return 0;
  }
  const config = loadConfig(io.cwd, str(values.config), io.env);
  const main = positionals[0] ?? config.main;
  safeRelPath(main);
  if (positionals[0]) {
    config.main = main;
    // The jobname follows the file being built unless overfull.yml (or
    // overfull.yaml, or --config) sets one explicitly.
    if (!config.jobnameFromConfig)
      config.jobname = safeJobname(main.replace(/^.*\//, '').replace(/\.tex$/i, ''));
  }
  insideRoot(config.root, main, 'Main file');
  if (!existsSync(join(config.root, main))) {
    throw new UsageError(
      `${main} not found in ${config.root}. Pass the main file: \`overfull build thesis.tex\`.`,
    );
  }
  const engineArg = (str(values.engine) ?? config.build.engine) as Engine;
  if (!['auto', 'local', 'docker'].includes(engineArg))
    throw new UsageError('--engine must be auto, local or docker');
  const imageArg = str(values.image);
  const image = imageArg ? safeImage(imageArg, '--image') : config.build.image;
  const verbose = values.verbose === true;
  const force = values.force === true;
  let result: Awaited<ReturnType<typeof run>>;
  if (!force && upToDate(config, main)) {
    // Nothing changed since the last good build: report on it without starting
    // LaTeX (in Docker, latexmk would rerun LuaLaTeX because the container's
    // font cache is new every time).
    io.stderr(
      `${main} is up to date (no source changed since the last build; --force rebuilds).\n`,
    );
    result = { code: 0, stdout: '', stderr: '' };
  } else {
    const engine = await resolveEngine(engineArg, io.env);
    const lmk = [...(force ? ['-g'] : []), ...latexmkArgs(config, main)];
    result = await runLatexmk(engine, lmk);
  }
  async function runLatexmk(
    engine: 'local' | 'docker',
    lmk: string[],
  ): Promise<Awaited<ReturnType<typeof run>>> {
    let result: Awaited<ReturnType<typeof run>>;
    if (engine === 'local') {
      io.stderr(`Building ${main} with latexmk…\n`);
      result = await run('latexmk', lmk, { cwd: config.root, onLine: progress(io, verbose) });
    } else {
      const present = await dockerImagePresent(image);
      io.stderr(
        `Building ${main} with latexmk in ${image}${present ? '' : ' (pulling the image first; this takes a few minutes once)'}…\n`,
      );
      result = await run('docker', dockerRunArgs(image, config.root, ['latexmk', ...lmk]), {
        cwd: config.root,
        onLine: progress(io, verbose),
      });
      if (result.code === 125) {
        io.stderr(`${result.stderr.trim()}\n`);
        throw new UsageError(
          imageUnavailable(result.stderr)
            ? imageUnavailableMessage(image)
            : `Docker could not start ${image}. Check the image name (--image, OVERFULL_IMAGE or build.image in overfull.yml).`,
        );
      }
    }
    return result;
  }
  const auxDir = join(config.root, config.build.auxDir);
  const outDir = join(config.root, config.build.outDir);
  const logText = readIfExists(join(auxDir, `${config.jobname}.log`));
  if (logText === undefined) {
    io.stderr(`${(result.stderr || result.stdout).trim().split('\n').slice(-15).join('\n')}\n`);
    const message = `Build failed before LaTeX wrote ${config.jobname}.log (latexmk exit code ${result.code}).`;
    if (values.json)
      io.stdout(
        `${JSON.stringify({ error: { code: 'build-failed', message, exitCode: result.code } }, null, 2)}\n`,
      );
    else io.stderr(`${message}\n`);
    return 1;
  }
  const analyzed = analyzeLog(logText, { root: config.root });
  const attribute = bibliographyAttribution(config);
  const build = { ...analyzed.build, problems: attribute(analyzed.build.problems) };
  const output = { ...analyzed.output, problems: attribute(analyzed.output.problems) };
  const checks: CheckResult[] = [build, output];
  const pdfPath = join(outDir, `${config.jobname}.pdf`);
  const pdfRel = join(config.build.outDir, `${config.jobname}.pdf`).split('\\').join('/');
  if (existsSync(pdfPath)) {
    try {
      checks[1] = mergeOutput(output, pdfOutputProblems(await readPdfFacts(pdfPath)));
    } catch {
      /* unreadable PDF: the log check still stands */
    }
  }
  for (const c of checks) c.problems = sortProblems(c.problems);
  const failed = result.code !== 0 || build.status === 'fail' || !existsSync(pdfPath);
  const report: Report = {
    tool: 'overfull',
    version: VERSION,
    target: existsSync(pdfPath) ? pdfRel : main,
    status: failed ? 'fail' : reportStatus(checks),
    checks,
  };
  if (values.json) io.stdout(formatJson(report));
  else io.stdout(formatHuman(report, { color: useColor(io), verbose }));
  if (failed && build.status !== 'fail') {
    io.stderr(
      `latexmk exited with code ${result.code}. Run \`overfull build --verbose\` to see its output.\n`,
    );
  }
  return failed ? 1 : 0;
}
