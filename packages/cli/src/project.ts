import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { TexFile } from '@overfull/core';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.overfull', '_minted', 'dist', '.github', '.agents', '.claude']);
const MAX_FILES = 5000;

/** Project files relative to root (forward slashes), skipping VCS, caches and build dirs. */
export function listFiles(root: string): string[] {
  const out: string[] = [];
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
        st = statSync(full);
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

export function readTexFiles(root: string, files: string[]): TexFile[] {
  return files
    .filter((f) => /\.(tex|sty|cls)$/i.test(f) && !f.startsWith('overfull-diff'))
    .map((path) => ({ path, content: readFileSync(join(root, path), 'utf8') }));
}

export function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

/** Main .aux plus aux files of `\include`d chapters (which the main aux pulls in via \@input). */
export function readAux(root: string, jobname: string): string | undefined {
  const main = readIfExists(join(root, `${jobname}.aux`));
  if (main === undefined) return undefined;
  const parts = [main];
  for (const m of main.matchAll(/\\@input\{([^}]+\.aux)\}/g)) {
    const extra = readIfExists(join(root, m[1] as string));
    if (extra) parts.push(extra);
  }
  return parts.join('\n');
}
