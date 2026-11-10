import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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

/** File tree embedded by scripts/build-standalone.mjs: "<template>/<path>" → base64, or a symlink. */
type EmbeddedTemplates = Record<string, string | { link: string }>;
declare const __OVERFULL_TEMPLATES__: EmbeddedTemplates | undefined;

/** Templates compiled into the standalone build, if this is one. */
export function embeddedTemplates(): EmbeddedTemplates | undefined {
  return typeof __OVERFULL_TEMPLATES__ === 'object' ? __OVERFULL_TEMPLATES__ : undefined;
}

/** True when the standalone build carries the named template. */
export function hasEmbeddedTemplate(name: TemplateName): boolean {
  const all = embeddedTemplates();
  return !!all && Object.keys(all).some((k) => k.startsWith(`${name}/`));
}

/** Writes an embedded template to dest (same filtering and symlink handling as copyTemplate). */
export function writeEmbeddedTemplate(name: TemplateName, dest: string): void {
  const all = embeddedTemplates() ?? {};
  mkdirSync(dest, { recursive: true });
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(`${name}/`)) continue;
    const rel = key.slice(name.length + 1);
    if (!isTemplateFile(rel)) continue;
    const target = join(dest, ...rel.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    if (typeof value === 'string') {
      writeFileSync(target, Buffer.from(value, 'base64'));
    } else {
      try {
        symlinkSync(value.link, target, 'dir');
      } catch {
        cpSync(join(dirname(target), value.link), target, { recursive: true });
      }
    }
  }
}

/** A file of the agent kit: path relative to the project root, and its bytes. */
export interface AgentFile {
  path: string;
  content: Buffer;
}

/** What an agent kit holds: AGENTS.md, the pointer files and the skills. Nothing else of a template. */
const AGENT_KIT_FILES = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  '.github/copilot-instructions.md',
  '.cursor/rules/overfull.mdc',
]);
const AGENT_KIT_PREFIX = '.agents/skills/';

function isAgentKitFile(rel: string): boolean {
  return (AGENT_KIT_FILES.has(rel) || rel.startsWith(AGENT_KIT_PREFIX)) && isTemplateFile(rel);
}

/**
 * The agent kit for `overfull init --here`: AGENTS.md, the pointer files and
 * `.agents/skills/`, read from a bundled template. Every template carries the
 * same copy (`scripts/sync-templates.mjs` writes them from `shared/agents` and
 * `skills/`, and `--check` fails on drift), so there is one source and no
 * second copy to keep. Works from the repository, the npm package and the
 * single-file builds (which embed `templates/`). Undefined when no template is bundled.
 */
export function agentKit(): AgentFile[] | undefined {
  const all = embeddedTemplates();
  const files: AgentFile[] = [];
  for (const name of TEMPLATE_NAMES) {
    files.length = 0;
    if (all) {
      for (const [key, value] of Object.entries(all)) {
        if (!key.startsWith(`${name}/`) || typeof value !== 'string') continue;
        const rel = key.slice(name.length + 1);
        if (isAgentKitFile(rel)) files.push({ path: rel, content: Buffer.from(value, 'base64') });
      }
    } else {
      const root = templatesDir();
      const src = root ? join(root, name) : undefined;
      if (!src || !existsSync(src)) continue;
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.isFile()) {
            const rel = relative(src, full).split(sep).join('/');
            if (isAgentKitFile(rel)) files.push({ path: rel, content: readFileSync(full) });
          }
        }
      };
      walk(src);
    }
    if (files.some((f) => f.path === 'AGENTS.md'))
      return files.sort((a, b) => a.path.localeCompare(b.path));
  }
  return undefined;
}
