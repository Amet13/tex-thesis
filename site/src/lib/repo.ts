/** Build-time helpers that read files from the monorepo (never shipped to the browser). */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

function findRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = path.dirname(dir);
  }
  return path.resolve(process.cwd(), '..');
}

export const ROOT = findRoot();

export function readText(rel: string): string | null {
  const p = path.join(ROOT, rel);
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

export function listDirs(rel: string): string[] {
  try {
    return readdirSync(path.join(ROOT, rel), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

export function exists(rel: string): boolean {
  return existsSync(path.join(ROOT, rel));
}
