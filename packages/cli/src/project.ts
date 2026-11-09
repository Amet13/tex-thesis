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
    throw new UsageError(`Cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
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
