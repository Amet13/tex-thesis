// Builds the working directory for one task and variant. No Docker, no agent.
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { generate } from './generate.mjs';
import { AGENT_PATHS } from './tasks.mjs';

export function deepMerge(a, b) {
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b || Array.isArray(b)) return b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = deepMerge(a[k], v);
  return out;
}

const rmAgentFiles = (dir) => {
  for (const p of AGENT_PATHS) rmSync(join(dir, p), { recursive: true, force: true });
};

/** Does this `.claude/settings.json` configure hooks? */
function hasHooks(file) {
  try {
    const hooks = JSON.parse(readFileSync(file, 'utf8')).hooks;
    return typeof hooks === 'object' && hooks !== null && Object.keys(hooks).length > 0;
  } catch {
    return false;
  }
}

/**
 * Variants:
 *   bare          no agent files.
 *   instructions  AGENTS.md and the skills (the template as shipped, without hooks).
 *   guard         instructions, plus the Claude Code hook configuration of `.claude/settings.json`
 *                 (it calls `overfull guard --hook`; `overfull` must be on the PATH of the machine that
 *                 runs the agent). When the template ships no such file, the run falls back to
 *                 `instructions`, and the result records that in `notes` and `effectiveVariant`.
 * Projects that are not templates (adopt-existing) get the agent files of the `paper` template for
 * `instructions` and `guard`, since that is what `overfull init --here --agents` would add.
 */
export function applyVariant(root, dir, task, variant) {
  const notes = [];
  let effective = variant;
  if (variant === 'bare') {
    rmAgentFiles(dir);
    return { notes, effective };
  }
  if (task.project) {
    const src = join(root, 'templates', 'paper');
    for (const p of AGENT_PATHS) {
      if (existsSync(join(src, p))) {
        mkdirSync(dirname(join(dir, p)), { recursive: true });
        cpSync(join(src, p), join(dir, p), { recursive: true, verbatimSymlinks: true });
      }
    }
  }
  const settings = join(dir, '.claude', 'settings.json');
  if (variant === 'instructions') {
    if (existsSync(settings) && hasHooks(settings)) rmSync(settings);
  } else if (variant === 'guard') {
    if (!existsSync(settings)) {
      effective = 'instructions';
      notes.push('guard: no .claude/settings.json in the template; ran as instructions');
    } else if (!hasHooks(settings)) {
      effective = 'instructions';
      notes.push('guard: .claude/settings.json has no hooks; ran as instructions');
    }
  }
  return { notes, effective };
}

/** The file's text, or undefined when it does not exist (read once, no check first). */
function readOrUndefined(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return undefined;
    throw err;
  }
}

/** Applies setup (YAML merge), edits (literal replace, exactly once) and write (files) of a task. */
export function applyTaskSetup(root, dir, task) {
  for (const [file, patch] of Object.entries(task.setup ?? {})) {
    const path = join(dir, file);
    const current = parseYaml(readOrUndefined(path) ?? '') ?? {};
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, stringifyYaml(deepMerge(current, patch)));
  }
  for (const e of task.edits ?? []) {
    const path = join(dir, e.file);
    const text = readOrUndefined(path);
    if (text === undefined) throw new Error(`edit: ${e.file} does not exist`);
    const n = text.split(e.find).length - 1;
    if (n !== 1)
      throw new Error(
        `edit: ${JSON.stringify(e.find.slice(0, 60))} occurs ${n} times in ${e.file}, expected once`,
      );
    writeFileSync(
      path,
      text.replace(e.find, () => e.replace),
    );
  }
  for (const [file, spec] of Object.entries(task.write ?? {})) {
    const path = join(dir, file);
    mkdirSync(dirname(path), { recursive: true });
    if (typeof spec === 'string') writeFileSync(path, spec);
    else if (spec.generate && spec.append) appendFileSync(path, generate(root, spec));
    else if (spec.generate) writeFileSync(path, generate(root, spec));
    else cpSync(join(root, spec.from), path);
  }
}

export function prepare(root, task, variant) {
  const dir = mkdtempSync(join(tmpdir(), `overfull-eval-${task.id}-${variant}-`));
  try {
    const base = task.project ? join(root, task.project) : join(root, 'templates', task.template);
    cpSync(base, dir, { recursive: true, verbatimSymlinks: true });
    const { notes, effective } = applyVariant(root, dir, task, variant);
    applyTaskSetup(root, dir, task);
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync(
      'git',
      ['-c', 'user.email=eval@overfull', '-c', 'user.name=eval', 'commit', '-qm', 'start'],
      { cwd: dir },
    );
    return { dir, notes, effective };
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}
