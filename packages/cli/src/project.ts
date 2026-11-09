import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { insideRootOrUndefined } from './safety.js';
import type { TexFile } from '@overfull/core';

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

export function readTexFiles(root: string, files: string[]): TexFile[] {
  return files
    .filter((f) => /\.(tex|sty|cls)$/i.test(f) && !isDiffArtifact(f))
    .map((path) => ({ path, content: readFileSync(join(root, path), 'utf8') }));
}

export function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
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
