import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse } from '../args.js';
import { type Io, UsageError } from '../io.js';
import { copyTemplate, TEMPLATE_NAMES, type TemplateName, templatesDir } from '../templates.js';

export const initHelp = `Usage: overfull init [thesis|paper|slides] [dir] [options]

Create a new project from a template: accessible LaTeX (LuaLaTeX, tagged PDF),
overfull.yml, Makefile, CI workflow, and AGENTS.md + skills for AI agents.

Arguments:
  template        thesis (default), paper or slides
  dir             Target directory (default: ./<template>)

Options:
  --force         Copy into a non-empty directory (existing files are overwritten)
  -h, --help      Show this help
`;

export async function initCommand(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parse(args, { force: { type: 'boolean' } }, 'init');
  if (values.help) {
    io.stdout(initHelp);
    return 0;
  }
  let [name, dir] = positionals;
  if (name && !(TEMPLATE_NAMES as readonly string[]).includes(name) && dir === undefined) {
    // `overfull init my-thesis` → thesis template into my-thesis
    dir = name;
    name = undefined;
  }
  const template = (name ?? 'thesis') as TemplateName;
  if (!(TEMPLATE_NAMES as readonly string[]).includes(template)) {
    throw new UsageError(`Unknown template "${template}". Choose ${TEMPLATE_NAMES.join(', ')}.`);
  }
  const root = templatesDir();
  const src = root ? join(root, template) : undefined;
  if (!src || !existsSync(src)) throw new UsageError(`Template "${template}" is not bundled with this overfull install.`);
  const target = resolve(io.cwd, dir ?? template);
  if (existsSync(target) && readdirSync(target).length > 0 && values.force !== true) {
    throw new UsageError(`${relative(io.cwd, target) || '.'} is not empty. Choose another directory or pass --force.`);
  }
  copyTemplate(src, target);
  const shown = relative(io.cwd, target) || '.';
  const cd = shown === '.' ? '' : `  cd ${shown}\n`;
  io.stdout(
    `Created a ${template} project in ${shown}/\n\n` +
      'Next steps\n' +
      cd +
      '  With an AI agent: open the folder in your agent (Claude Code, Codex, Cursor, Copilot)\n' +
      '    and describe what you want; AGENTS.md tells it how to build, cite and check.\n' +
      '  By hand: edit metadata.tex and main.tex, then run `make build` and `make check`\n' +
      '    (or `overfull build` and `overfull check`). Needs Docker or TeX Live.\n' +
      '  `overfull doctor` shows which tools are available.\n',
  );
  return 0;
}
