import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parse } from '../args.js';
import { type Io, UsageError } from '../io.js';
import { insideRootForWrite, isDanglingSymlink } from '../safety.js';
import { copyTemplate, TEMPLATE_NAMES, type TemplateName, templatesDir } from '../templates.js';
import { run, which } from '../tools.js';

/**
 * `git init -b main` in a new project that is not already inside a repository,
 * plus an initial commit when user.name and user.email are configured.
 * Returns a line for the user, or undefined when nothing was done.
 */
export async function initGit(
  target: string,
  template: string,
  env: Io['env'],
): Promise<string | undefined> {
  if (!which('git', env)) return undefined;
  const opts = { cwd: target, env, timeoutMs: 20000 };
  const inside = await run('git', ['rev-parse', '--is-inside-work-tree'], opts);
  if (inside.code === 0) return undefined;
  const init = await run('git', ['init', '-q', '-b', 'main'], opts);
  if (init.code !== 0) return undefined;
  const name = await run('git', ['config', 'user.name'], opts);
  const email = await run('git', ['config', 'user.email'], opts);
  const commitCmd = `git add -A && git commit -m "Start from the overfull ${template} template"`;
  if (name.code !== 0 || !name.stdout.trim() || email.code !== 0 || !email.stdout.trim()) {
    return `Initialized a git repository (branch main). Set user.name/user.email, then commit:\n    ${commitCmd}`;
  }
  const add = await run('git', ['add', '-A'], opts);
  const commit =
    add.code === 0
      ? await run(
          'git',
          ['commit', '-q', '-m', `Start from the overfull ${template} template`],
          opts,
        )
      : add;
  return commit.code === 0
    ? 'Initialized a git repository (branch main) with an initial commit.'
    : `Initialized a git repository (branch main). Commit with:\n    ${commitCmd}`;
}

export const initHelp = `Usage: overfull init [thesis|paper|slides] [dir] [options]

Create a new project from a template: accessible LaTeX (LuaLaTeX, tagged PDF),
overfull.yml, Makefile, CI workflow, and AGENTS.md + skills for AI agents.

Arguments:
  template        thesis (default), paper or slides
  dir             Target directory (default: ./<template>)

Options:
  --force         Copy into a non-empty directory (existing files are overwritten)
  --no-git        Do not run \`git init\` (by default a new project outside a git
                  repository gets \`git init -b main\` and, when user.name and
                  user.email are set, an initial commit)
  -h, --help      Show this help
`;

export async function initCommand(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parse(
    args,
    { force: { type: 'boolean' }, 'no-git': { type: 'boolean' } },
    'init',
  );
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
  if (!src || !existsSync(src))
    throw new UsageError(`Template "${template}" is not bundled with this overfull install.`);
  const target = resolve(io.cwd, dir ?? template);
  // A target under the current directory must not escape it through a symlink
  // (an untrusted checkout could hold `paper -> ~/.ssh`); a dangling symlink is
  // refused anywhere.
  const rel = relative(io.cwd, target);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)))
    insideRootForWrite(io.cwd, target, 'Target directory');
  else if (isDanglingSymlink(target))
    throw new UsageError(`Target directory "${dir}" is a dangling symlink.`);
  if (existsSync(target) && readdirSync(target).length > 0 && values.force !== true) {
    throw new UsageError(
      `${relative(io.cwd, target) || '.'} is not empty. Choose another directory or pass --force.`,
    );
  }
  copyTemplate(src, target);
  const gitNote = values['no-git'] === true ? undefined : await initGit(target, template, io.env);
  const shown = relative(io.cwd, target) || '.';
  const cd = shown === '.' ? '' : `  cd ${shown}\n`;
  io.stdout(
    `Created a ${template} project in ${shown}/\n\n` +
      (gitNote ? `${gitNote}\n\n` : '') +
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
