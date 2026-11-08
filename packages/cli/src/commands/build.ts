import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  analyzeLog,
  type CheckResult,
  formatHuman,
  pdfOutputProblems,
  type Report,
  reportStatus,
} from '@overfull/core';
import { parse, str } from '../args.js';
import { mergeOutput } from '../check.js';
import { type Config, type Engine, loadConfig } from '../config.js';
import { type Io, UsageError, useColor } from '../io.js';
import { readPdfFacts } from '../pdf.js';
import { readIfExists } from '../project.js';
import { dockerAvailable, dockerImagePresent, dockerRunArgs, run, which } from '../tools.js';
import { VERSION } from '../version.js';

export const buildHelp = `Usage: overfull build [main.tex] [options]

Compile the document with latexmk, then check the build log and PDF output.
Uses a local latexmk if installed, otherwise the Overfull Docker image.

Options:
  --engine e      auto (default), local or docker
  --image name    Docker image (default from overfull.yml, $OVERFULL_IMAGE or ghcr.io/amet13/overfull:0.1)
  --verbose, -v   Show latexmk output and fixes for each problem
  --config file   Config file (default overfull.yml)
  -h, --help      Show this help

Uses -lualatex unless the project has a .latexmkrc (then latexmk follows it).
Exit codes: 0 built, 1 build failed, 2 usage error.
`;

export function latexmkArgs(config: Config, main: string): string[] {
  const rc =
    existsSync(join(config.root, '.latexmkrc')) || existsSync(join(config.root, 'latexmkrc'));
  return [
    ...(rc ? [] : ['-lualatex']),
    '-interaction=nonstopmode',
    '-file-line-error',
    `-jobname=${config.jobname}`,
    main,
  ];
}

export async function resolveEngine(engine: Engine, env: Io['env']): Promise<'local' | 'docker'> {
  if (engine === 'local') {
    if (!which('latexmk', env))
      throw new UsageError(
        'latexmk not found on PATH. Install TeX Live, or use `--engine docker`.',
      );
    return 'local';
  }
  if (engine === 'docker' || !which('latexmk', env)) {
    if (!(await dockerAvailable(env))) {
      throw new UsageError(
        engine === 'docker'
          ? 'Docker is not running. Start Docker, or use `--engine local` with TeX Live installed.'
          : 'Neither latexmk nor Docker is available. Install Docker (https://docs.docker.com/get-docker/) or TeX Live, then retry. `overfull doctor` shows what is missing.',
      );
    }
    return 'docker';
  }
  return 'local';
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
  if (positionals[0] && !str(values.config)) {
    config.main = main;
    if (!existsSync(join(config.root, 'overfull.yml')))
      config.jobname = main.replace(/^.*\//, '').replace(/\.tex$/i, '');
  }
  if (!existsSync(join(config.root, main))) {
    throw new UsageError(
      `${main} not found in ${config.root}. Pass the main file: \`overfull build thesis.tex\`.`,
    );
  }
  const engineArg = (str(values.engine) ?? config.build.engine) as Engine;
  if (!['auto', 'local', 'docker'].includes(engineArg))
    throw new UsageError('--engine must be auto, local or docker');
  const image = str(values.image) ?? config.build.image;
  const engine = await resolveEngine(engineArg, io.env);
  const lmk = latexmkArgs(config, main);
  const verbose = values.verbose === true;
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
        `Docker could not start ${image}. Check the image name (build.image in overfull.yml).`,
      );
    }
  }
  const logText = readIfExists(join(config.root, `${config.jobname}.log`));
  if (logText === undefined) {
    io.stderr(`${(result.stderr || result.stdout).trim().split('\n').slice(-15).join('\n')}\n`);
    io.stderr(
      `Build failed before LaTeX wrote ${config.jobname}.log (latexmk exit code ${result.code}).\n`,
    );
    return 1;
  }
  const { build, output } = analyzeLog(logText, { root: config.root });
  const checks: CheckResult[] = [build, output];
  const pdfPath = join(config.root, `${config.jobname}.pdf`);
  if (existsSync(pdfPath)) {
    try {
      checks[1] = mergeOutput(output, pdfOutputProblems(await readPdfFacts(pdfPath)));
    } catch {
      /* unreadable PDF: the log check still stands */
    }
  }
  const failed = result.code !== 0 || build.status === 'fail' || !existsSync(pdfPath);
  const report: Report = {
    tool: 'overfull',
    version: VERSION,
    target: existsSync(pdfPath) ? `${config.jobname}.pdf` : main,
    status: failed ? 'fail' : reportStatus(checks),
    checks,
  };
  io.stdout(formatHuman(report, { color: useColor(io), verbose }));
  if (failed && build.status !== 'fail') {
    io.stderr(
      `latexmk exited with code ${result.code}. Run \`overfull build --verbose\` to see its output.\n`,
    );
  }
  return failed ? 1 : 0;
}
