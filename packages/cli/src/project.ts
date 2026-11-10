import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { TexFile } from '@overfull/core';
import { UsageError } from './io.js';
import { insideRootOrUndefined } from './safety.js';

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.overfull',
  '_minted',
  'dist',
  '.github',
  '.agents',
  '.claude',
]);
const MAX_FILES = 5000;

/**
 * Project files relative to root (forward slashes), skipping VCS, caches and
 * build dirs. Symlinked directories are not followed, and symlinked files are
 * listed only when they point inside the project.
 */
export function listFiles(root: string): string[] {
  const out: string[] = [];
  let realRoot = root;
  try {
    realRoot = realpathSync(root);
  } catch {
    /* keep root */
  }
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      if (out.length >= MAX_FILES) return;
      const full = join(dir, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = lstatSync(full);
        if (st.isSymbolicLink()) {
          const target = statSync(full);
          if (target.isDirectory()) continue;
          if (!insideRootOrUndefined(realRoot, realpathSync(full))) continue;
          st = target;
        }
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(full);
      } else out.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(root);
  return out;
}

/** latexdiff output (`main-diff1a2b3c4.tex`) and Overfull's own diff files are not the paper. */
export function isDiffArtifact(path: string): boolean {
  const name = path.split('/').pop() ?? path;
  return name.startsWith('overfull-diff') || /-diff[0-9a-f]{4,40}\.tex$/i.test(name);
}

/** Largest source file read for the venue checks. */
export const MAX_TEX_BYTES = 20 * 1024 * 1024;

/**
 * Reads the project's .tex/.sty/.cls files. Non-regular files (FIFOs, sockets,
 * devices, which could block or never end) and files over MAX_TEX_BYTES are
 * skipped and listed in `skipped` with the reason.
 */
export function readTexFiles(
  root: string,
  files: string[],
  skipped: { path: string; reason: string }[] = [],
): TexFile[] {
  const out: TexFile[] = [];
  for (const path of files) {
    if (!/\.(tex|sty|cls)$/i.test(path) || isDiffArtifact(path)) continue;
    const abs = join(root, path);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile()) {
      skipped.push({ path, reason: 'not a regular file' });
      continue;
    }
    if (st.size > MAX_TEX_BYTES) {
      skipped.push({ path, reason: `larger than ${MAX_TEX_BYTES / 1024 / 1024} MB` });
      continue;
    }
    try {
      out.push({ path, content: readFileSync(abs, 'utf8') });
    } catch (err) {
      skipped.push({ path, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

/**
 * Reads a file when it exists. A path that exists but is not a regular file
 * (a directory named `main.log`, a FIFO) is a usage error with a clear message,
 * never a hang or an internal error.
 */
export function readIfExists(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  requireRegularFile(path);
  return readFileSync(path, 'utf8');
}

/** Throws a UsageError unless `path` is a regular file. */
export function requireRegularFile(path: string): void {
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(path);
  } catch (err) {
    throw new UsageError(
      `Cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!st.isFile()) {
    throw new UsageError(
      `${path} is not a file (${st.isDirectory() ? 'it is a directory' : 'it is a pipe, socket or device'}).`,
    );
  }
}

/**
 * Main .aux plus aux files of `\include`d chapters (which the main aux pulls in
 * via \@input, relative to the aux directory). Paths outside the project are ignored.
 */
export function readAux(root: string, jobname: string, auxDir = '.'): string | undefined {
  const dir = join(root, auxDir);
  const mainPath = insideRootOrUndefined(root, join(dir, `${jobname}.aux`));
  const main = mainPath ? readIfExists(mainPath) : undefined;
  if (main === undefined) return undefined;
  const parts = [main];
  for (const m of main.matchAll(/\\@input\{([^}]+\.aux)\}/g)) {
    const p = insideRootOrUndefined(root, join(dir, m[1] as string));
    const extra = p ? readIfExists(p) : undefined;
    if (extra) parts.push(extra);
  }
  return parts.join('\n');
}

export interface MainDetection {
  /** The chosen main file, or undefined when there is none or it is ambiguous. */
  main?: string;
  /** How it was found. */
  how?: 'main.tex' | 'only document' | 'matching build output';
  /** Every root-level .tex file with an uncommented \\documentclass. */
  candidates: string[];
}

/**
 * Finds the main file when nothing names it: `main.tex` if present, else the
 * root-level .tex files with an uncommented `\documentclass`. One candidate is
 * the main file. Several: the one with a matching .log or .pdf (in the root or
 * the given output directories), if exactly one has; otherwise `main` is
 * undefined and `candidates` lists them.
 */
export function detectMain(root: string, outputDirs: string[] = ['.']): MainDetection {
  if (isRegular(join(root, 'main.tex')))
    return { main: 'main.tex', how: 'main.tex', candidates: [] };
  let names: string[];
  try {
    names = readdirSync(root).sort();
  } catch {
    return { candidates: [] };
  }
  const candidates: string[] = [];
  for (const name of names) {
    if (!/\.tex$/i.test(name) || isDiffArtifact(name)) continue;
    const abs = join(root, name);
    try {
      const st = statSync(abs);
      if (!st.isFile() || st.size > MAX_TEX_BYTES) continue;
      const text = readFileSync(abs, 'utf8').replace(/(^|[^\\])%.*$/gm, '$1');
      if (/\\documentclass\b/.test(text)) candidates.push(name);
    } catch {
      /* unreadable: not a candidate */
    }
  }
  if (candidates.length === 1)
    return { main: candidates[0] as string, how: 'only document', candidates };
  if (candidates.length > 1) {
    const built = candidates.filter((c) => {
      const stem = c.replace(/\.tex$/i, '');
      return outputDirs.some((d) =>
        ['log', 'pdf'].some((ext) => isRegular(join(root, d, `${stem}.${ext}`))),
      );
    });
    if (built.length === 1)
      return { main: built[0] as string, how: 'matching build output', candidates };
  }
  return { candidates };
}

function isRegular(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The usage error for several possible main files. */
export function ambiguousMainError(candidates: string[]): UsageError {
  const first = candidates[0] ?? 'paper.tex';
  return new UsageError(
    `More than one .tex file here has a \\documentclass: ${candidates.join(', ')}.\n` +
      `Say which is the main file: \`overfull check --main ${first}\`, or set \`main: ${first}\` in overfull.yml.`,
  );
}
