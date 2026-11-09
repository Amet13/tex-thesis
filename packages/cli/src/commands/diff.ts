import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { parse, str } from '../args.js';
import { loadConfig } from '../config.js';
import { type Io, UsageError } from '../io.js';
import { insideRoot, insideRootForWrite, safeRelPath } from '../safety.js';
import {
  dockerAvailable,
  dockerRunArgs,
  imageUnavailable,
  imageUnavailableMessage,
  run,
  which,
} from '../tools.js';
import { resolveEngine } from './build.js';

export const diffHelp = `Usage: overfull diff [options]

Build a PDF that marks what changed since a git revision (latexdiff), so a
supervisor or co-author can review changes. Prints the path of the PDF.

Options:
  --base ref      Revision to compare with (default: merge-base with origin/main;
                  HEAD~1 when that is HEAD itself or there is no origin/main)
  --main file     Main .tex file (default from overfull.yml)
  --out file      Output PDF (default overfull-diff.pdf)
  --engine e      auto (default), local or docker
  --config file   Config file (default overfull.yml)
  -h, --help      Show this help
`;

/** latexdiff options to try, from best markup to most robust. */
const ATTEMPTS: string[][] = [[], ['--math-markup=0'], ['--math-markup=0', '--type=CFONT']];

async function git(args: string[], cwd: string): Promise<string | undefined> {
  const r = await run('git', args, { cwd, timeoutMs: 20000 });
  return r.code === 0 ? r.stdout.trim() : undefined;
}

/**
 * The revision to compare with: the merge-base with origin/main, unless that is
 * HEAD itself (on main, or nothing new on the branch), then HEAD~1.
 */
export async function defaultBase(
  cwd: string,
): Promise<{ ref: string; note?: string } | undefined> {
  const mb = await git(['merge-base', 'HEAD', 'origin/main'], cwd);
  const head = await git(['rev-parse', 'HEAD'], cwd);
  if (mb && mb !== head) return { ref: mb };
  const prev = await git(['rev-parse', '--verify', '--quiet', 'HEAD~1'], cwd);
  if (!prev) return undefined;
  return {
    ref: prev,
    ...(mb ? { note: 'HEAD is already on origin/main; comparing with HEAD~1 instead.' } : {}),
  };
}

/** Where latexmk writes the diff build (aux, log, PDF) so the project root stays clean. */
export const DIFF_DIR = join('.overfull', 'diff');

export async function diffCommand(args: string[], io: Io): Promise<number> {
  const { values } = parse(
    args,
    {
      base: { type: 'string' },
      main: { type: 'string' },
      out: { type: 'string' },
      engine: { type: 'string' },
      config: { type: 'string' },
    },
    'diff',
  );
  if (values.help) {
    io.stdout(diffHelp);
    return 0;
  }
  const config = loadConfig(io.cwd, str(values.config), io.env);
  const main = safeRelPath(str(values.main) ?? config.main);
  insideRoot(config.root, main, 'Main file');
  if (!existsSync(join(config.root, main))) throw new UsageError(`${main} not found. Pass --main.`);
  const top = await git(['rev-parse', '--show-toplevel'], config.root);
  if (!top)
    throw new UsageError('Not a git repository: `overfull diff` compares against a git revision.');
  const explicitBase = str(values.base);
  if (explicitBase?.startsWith('-')) throw new UsageError(`Invalid revision "${explicitBase}".`);
  const auto = explicitBase ? undefined : await defaultBase(config.root);
  const baseRef = explicitBase ?? auto?.ref;
  if (!baseRef) throw new UsageError('No earlier revision to compare with. Pass --base <ref>.');
  if (auto?.note) io.stderr(`${auto.note}\n`);
  const sha = await git(['rev-parse', '--short', `${baseRef}^{commit}`], config.root);
  if (!sha)
    throw new UsageError(`Unknown revision "${baseRef}". Try \`git log --oneline\` to pick one.`);

  const engine = await resolveEngine(
    (str(values.engine) as 'auto' | 'local' | 'docker' | undefined) ?? config.build.engine,
    io.env,
  );
  const localDiff = engine === 'local' && Boolean(which('latexdiff-vc', io.env));
  if (engine === 'local' && !localDiff && !(await dockerAvailable(io.env))) {
    throw new UsageError(
      'latexdiff-vc not found and Docker is not running. Install latexdiff (part of TeX Live) or start Docker.',
    );
  }
  const useDocker = !localDiff;
  const sub = relative(top, config.root) || '.';
  const exec = (cmd: string[]) =>
    useDocker
      ? run(
          'docker',
          dockerRunArgs(config.build.image, top, cmd, {
            subdir: sub,
            // Only the mounted repository is trusted, never '*'.
            env: {
              GIT_CONFIG_COUNT: '1',
              GIT_CONFIG_KEY_0: 'safe.directory',
              GIT_CONFIG_VALUE_0: '/work',
            },
          }),
        )
      : run(cmd[0] as string, cmd.slice(1), { cwd: config.root });

  const stem = basename(main).replace(/\.tex$/i, '');
  const diffTex = join(dirname(main), `${stem}-diff${sha}.tex`).split('\\').join('/');
  const outPdf = str(values.out) ?? 'overfull-diff.pdf';
  const outAbs = insideRootForWrite(config.root, outPdf, 'Output PDF');
  const jobname = 'overfull-diff';
  const diffDir = DIFF_DIR.split('\\').join('/');
  const dockerFailed = (r: { code: number; stderr: string }) => {
    if (!useDocker || r.code !== 125) return;
    // Docker itself failed (image missing, daemon error): not a latexdiff problem.
    io.stderr(`${r.stderr.trim()}\n`);
    throw new UsageError(
      imageUnavailable(r.stderr)
        ? imageUnavailableMessage(config.build.image)
        : `Docker could not start ${config.build.image}. Check --image, OVERFULL_IMAGE or build.image in overfull.yml.`,
    );
  };
  // latexdiff writes <stem>-diff<sha>.tex next to the main file; it is removed afterwards.
  const cleanup = () => rmSync(join(config.root, diffTex), { force: true });
  const runAttempts = async (): Promise<number> => {
    io.stderr(
      `Comparing ${main} with ${baseRef === sha || /^[0-9a-f]{40}$/.test(baseRef) ? sha : `${baseRef} (${sha})`}${useDocker ? ` in ${config.build.image}` : ''}…\n`,
    );
    let lastError = '';
    for (const extra of ATTEMPTS) {
      const ld = await exec([
        'latexdiff-vc',
        '--git',
        '--flatten',
        '--force',
        ...extra,
        '-r',
        sha,
        main,
      ]);
      dockerFailed(ld);
      if (ld.code !== 0 || !existsSync(join(config.root, diffTex))) {
        lastError = (ld.error ?? ld.stderr).trim().split('\n').slice(-8).join('\n');
        continue;
      }
      mkdirSync(join(config.root, DIFF_DIR), { recursive: true });
      const produced = join(config.root, DIFF_DIR, `${jobname}.pdf`);
      rmSync(produced, { force: true });
      const rc = existsSync(join(config.root, '.latexmkrc'));
      const lmk = await exec([
        'latexmk',
        ...(rc ? [] : ['-lualatex']),
        '-interaction=nonstopmode',
        `-jobname=${jobname}`,
        `-outdir=${diffDir}`,
        `-auxdir=${diffDir}`,
        safeRelPath(diffTex),
      ]);
      dockerFailed(lmk);
      if (existsSync(produced) && (lmk.code === 0 || extra === ATTEMPTS[ATTEMPTS.length - 1])) {
        mkdirSync(dirname(outAbs), { recursive: true });
        renameSync(produced, outAbs);
        if (lmk.code !== 0)
          io.stderr('The diff document had LaTeX errors; the PDF may be incomplete.\n');
        io.stdout(`${relative(io.cwd, outAbs) || outPdf}\n`);
        return 0;
      }
      lastError = `latexmk failed on ${diffTex} (see ${diffDir}/${jobname}.log)`;
      if (extra.length < 2)
        io.stderr(
          `latexdiff markup did not compile; retrying with ${ATTEMPTS[ATTEMPTS.indexOf(extra) + 1]?.join(' ')}…\n`,
        );
    }
    io.stderr(
      `${lastError}\nCould not build a diff PDF. Try an older --base, or compare a smaller change.\n`,
    );
    return 1;
  };
  try {
    return await runAttempts();
  } finally {
    cleanup();
  }
}
