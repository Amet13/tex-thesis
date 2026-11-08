import { cpSync, existsSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEMPLATE_NAMES = ['thesis', 'paper', 'slides'] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];

const BUILD_OUTPUT =
  /\.(aux|bbl|bcf|bcf-SAVE-ERROR|blg|fdb_latexmk|fls|lof|lot|lol|log|run\.xml|synctex\.gz|toc|out|xdv|nav|snm|vrb|idx|ilg|ind|glo|gls|glg|ist|xmpi)$|-luamml-mathml\.html$/;
const SKIP_DIRS = new Set(['.overfull', 'node_modules', '.git']);

/** True for files that belong in a template copy (sources, not build outputs). */
export function isTemplateFile(rel: string): boolean {
  const parts = rel.split(/[\\/]/);
  if (parts.some((p) => SKIP_DIRS.has(p) || p.startsWith('_minted'))) return false;
  const name = parts[parts.length - 1] ?? '';
  if (BUILD_OUTPUT.test(name) || name.startsWith('overfull-diff')) return false;
  // Root-level PDFs are build outputs; figures live in subdirectories.
  if (parts.length === 1 && name.toLowerCase().endsWith('.pdf')) return false;
  return true;
}

/** Copies a template directory, skipping build outputs and keeping symlinks. */
export function copyTemplate(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (from) => {
      const rel = relative(src, from);
      return rel === '' || isTemplateFile(rel.split(sep).join('/'));
    },
  });
  // npm tarballs drop symlinks: restore .claude/skills -> ../.agents/skills.
  const agents = join(dest, '.agents', 'skills');
  const claude = join(dest, '.claude', 'skills');
  if (existsSync(agents) && !existsSync(claude)) {
    mkdirSync(dirname(claude), { recursive: true });
    try {
      symlinkSync(join('..', '.agents', 'skills'), claude, 'dir');
    } catch {
      cpSync(agents, claude, { recursive: true });
    }
  }
}

/** Templates bundled with the package (published), or the repo's templates/ in development. */
export function templatesDir(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(here, '..', 'templates'),
    join(here, '..', '..', '..', 'templates'),
  ]) {
    if (
      existsSync(candidate) &&
      readdirSync(candidate).some((n) => (TEMPLATE_NAMES as readonly string[]).includes(n))
    ) {
      return candidate;
    }
  }
  return undefined;
}
