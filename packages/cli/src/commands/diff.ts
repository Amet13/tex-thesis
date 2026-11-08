import { existsSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { parse, str } from '../args.js';
import { loadConfig } from '../config.js';
import { type Io, UsageError } from '../io.js';
import { dockerAvailable, dockerRunArgs, run, which } from '../tools.js';
import { resolveEngine } from './build.js';

export const diffHelp = `Usage: overfull diff [options]

Build a PDF that marks what changed since a git revision (latexdiff), so a
supervisor or co-author can review changes. Prints the path of the PDF.

Options:
  --base ref      Revision to compare with (default: merge-base with origin/main, else HEAD~1)
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

export async function defaultBase(cwd: string): Promise<string | undefined> {
  const mb = await git(['merge-base', 'HEAD', 'origin/main'], cwd);
  if (mb) return mb;
  return git(['rev-parse', '--verify', '--quiet', 'HEAD~1'], cwd);
}

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
  const main = str(values.main) ?? config.main;
  if (!existsSync(join(config.root, main))) throw new UsageError(`${main} not found. Pass --main.`);
  const top = await git(['rev-parse', '--show-toplevel'], config.root);
  if (!top)
    throw new UsageError('Not a git repository: `overfull diff` compares against a git revision.');
  const baseRef = str(values.base) ?? (await defaultBase(config.root));
  if (!baseRef) throw new UsageError('No earlier revision to compare with. Pass --base <ref>.');
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
            env: {
              GIT_CONFIG_COUNT: '1',
              GIT_CONFIG_KEY_0: 'safe.directory',
              GIT_CONFIG_VALUE_0: '*',
            },
          }),
        )
      : run(cmd[0] as string, cmd.slice(1), { cwd: config.root });

  const stem = basename(main).replace(/\.tex$/i, '');
  const diffTex = join(dirname(main), `${stem}-diff${sha}.tex`).split('\\').join('/');
  const outPdf = str(values.out) ?? 'overfull-diff.pdf';
  const jobname = 'overfull-diff';
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
    if (ld.code !== 0 || !existsSync(join(config.root, diffTex))) {
      lastError = (ld.error ?? ld.stderr).trim().split('\n').slice(-8).join('\n');
      continue;
    }
    const produced = join(config.root, `${jobname}.pdf`);
    rmSync(produced, { force: true });
    const rc = existsSync(join(config.root, '.latexmkrc'));
    const lmk = await exec([
      'latexmk',
      ...(rc ? [] : ['-lualatex']),
      '-interaction=nonstopmode',
      `-jobname=${jobname}`,
      diffTex,
    ]);
    if (existsSync(produced) && (lmk.code === 0 || extra === ATTEMPTS[ATTEMPTS.length - 1])) {
      if (outPdf !== `${jobname}.pdf`) renameSync(produced, join(config.root, outPdf));
      if (lmk.code !== 0)
        io.stderr('The diff document had LaTeX errors; the PDF may be incomplete.\n');
      io.stdout(`${relative(io.cwd, join(config.root, outPdf)) || outPdf}\n`);
      return 0;
    }
    lastError = `latexmk failed on ${diffTex} (see ${jobname}.log)`;
    if (extra.length < 2)
      io.stderr(
        `latexdiff markup did not compile; retrying with ${ATTEMPTS[ATTEMPTS.indexOf(extra) + 1]?.join(' ')}…\n`,
      );
  }
  io.stderr(
    `${lastError}\nCould not build a diff PDF. Try an older --base, or compare a smaller change.\n`,
  );
  return 1;
}
