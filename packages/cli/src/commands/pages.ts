import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { int, parse, str } from '../args.js';
import { loadConfig, requireMain } from '../config.js';
import { type Io, UsageError } from '../io.js';
import { loadPdfjs } from '../pdf.js';
import { insideRootForWrite } from '../safety.js';
import { dockerAvailable, dockerRunArgs, run, which } from '../tools.js';

export const pagesHelp = `Usage: overfull pages <range> [options]

Render PDF pages to PNG so you (or an agent) can look at them.
Range: "3", "2-5", "1,4,7", "8-" (to the end). Prints the written paths.

Options:
  --pdf file      PDF to render (default <jobname>.pdf)
  --main file     Main .tex file, to find <jobname>.pdf (default from overfull.yml or detected)
  --out dir       Output directory inside the project (default .overfull/pages)
  --dpi n         Resolution (default 110)
  --json          Print {pages: [{page, file}]} (or {error}) as JSON
  --config file   Config file (default overfull.yml)
  -h, --help      Show this help
`;

/** Parses a page range into sorted unique page numbers, bounded by `max` when given. */
export function parseRange(spec: string, max?: number): number[] {
  const pages = new Set<number>();
  for (const raw of spec.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(part);
    if (!m || (!m[1] && !m[3]))
      throw new UsageError(`Bad page range "${part}". Use e.g. 3, 2-5, 1,4,7 or 8-`);
    const start = m[1] ? Number(m[1]) : 1;
    const end = m[2] ? (m[3] ? Number(m[3]) : (max ?? start)) : start;
    if (start < 1 || end < start)
      throw new UsageError(`Bad page range "${part}": pages start at 1 and ranges go up`);
    if (max !== undefined && end > max)
      throw new UsageError(
        `Page ${end} does not exist: the PDF has ${max} page${max === 1 ? '' : 's'}`,
      );
    for (let p = start; p <= end; p++) pages.add(p);
  }
  if (pages.size === 0) throw new UsageError('No pages given. Use e.g. `overfull pages 3`');
  return [...pages].sort((a, b) => a - b);
}

async function pageCount(pdf: string): Promise<number> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(readFileSync(pdf)),
    verbosity: 0,
    isEvalSupported: false,
  });
  const doc = await task.promise;
  const n = doc.numPages;
  await (task.destroy ? task.destroy() : doc.destroy?.());
  return n;
}

export async function pagesCommand(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parse(
    args,
    {
      pdf: { type: 'string' },
      main: { type: 'string' },
      out: { type: 'string' },
      dpi: { type: 'string' },
      json: { type: 'boolean' },
      config: { type: 'string' },
    },
    'pages',
  );
  if (values.help) {
    io.stdout(pagesHelp);
    return 0;
  }
  const spec = positionals.join(',');
  if (!spec) throw new UsageError('Give a page range: `overfull pages 3` or `overfull pages 2-5`');
  const config = loadConfig(io.cwd, str(values.config), io.env, {
    ...(str(values.main) ? { main: str(values.main) as string } : {}),
  });
  if (!str(values.pdf)) requireMain(config);
  const pdfRel = str(values.pdf) ?? `${config.jobname}.pdf`;
  const pdf = isAbsolute(pdfRel) ? pdfRel : join(io.cwd, pdfRel);
  const pdfAtRoot = existsSync(pdf) ? pdf : join(config.root, pdfRel);
  if (!existsSync(pdfAtRoot))
    throw new UsageError(`${pdfRel} not found. Build first (\`overfull build\`) or pass --pdf.`);
  const dpi = int(values.dpi, 'dpi') ?? 110;
  const pages = parseRange(spec, await pageCount(pdfAtRoot));
  const outRel = str(values.out) ?? join('.overfull', 'pages');
  const outDir = insideRootForWrite(
    config.root,
    isAbsolute(outRel) ? outRel : join(io.cwd, outRel),
    'Output directory',
  );
  mkdirSync(outDir, { recursive: true });

  const local = Boolean(which('pdftoppm', io.env));
  if (!local && !(await dockerAvailable(io.env))) {
    throw new UsageError(
      'pdftoppm not found and Docker is not running. Install poppler (`brew install poppler` / `apt install poppler-utils`) or start Docker.',
    );
  }
  const written: { page: number; file: string }[] = [];
  for (const p of pages) {
    const prefix = join(outDir, `page-${p}`);
    let r: Awaited<ReturnType<typeof run>>;
    if (local) {
      r = await run('pdftoppm', [
        '-png',
        '-r',
        String(dpi),
        '-f',
        String(p),
        '-l',
        String(p),
        '-singlefile',
        pdfAtRoot,
        prefix,
      ]);
    } else {
      const inRoot = (abs: string) => relative(config.root, abs);
      if (inRoot(outDir).startsWith('..') || inRoot(pdfAtRoot).startsWith('..')) {
        throw new UsageError('With Docker, the PDF must be inside the project directory.');
      }
      const toPosix = (s: string) => s.split('\\').join('/');
      r = await run(
        'docker',
        dockerRunArgs(config.build.image, config.root, [
          'pdftoppm',
          '-png',
          '-r',
          String(dpi),
          '-f',
          String(p),
          '-l',
          String(p),
          '-singlefile',
          toPosix(inRoot(pdfAtRoot)),
          toPosix(inRoot(prefix)),
        ]),
      );
    }
    if (r.code !== 0) {
      const message = `${(r.error ?? r.stderr).trim()}\nCould not render page ${p}.`;
      if (values.json)
        io.stdout(
          `${JSON.stringify({ error: { code: 'render-failed', message, page: p } }, null, 2)}\n`,
        );
      else io.stderr(`${message}\n`);
      return 1;
    }
    written.push({ page: p, file: relative(io.cwd, `${prefix}.png`) || `${prefix}.png` });
  }
  io.stdout(
    values.json
      ? `${JSON.stringify({ pages: written }, null, 2)}\n`
      : `${written.map((w) => w.file).join('\n')}\n`,
  );
  return 0;
}
