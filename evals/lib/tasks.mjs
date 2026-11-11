// Task loading and validation for evals/run.mjs. Pure: no Docker, no agent.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expandPlaceholders, GENERATORS } from './generate.mjs';

const VARIANTS = ['bare', 'instructions', 'guard'];
/** `kit` was the name of the template-as-shipped variant before `guard` existed. */
const VARIANT_ALIASES = { kit: 'instructions' };
export const STATUSES = ['pass', 'warn', 'fail', 'skipped'];

/** Files and folders that tell an agent how to work, removed in the `bare` variant. */
export const AGENT_PATHS = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  '.agents',
  '.claude',
  '.cursor',
  '.github/copilot-instructions.md',
];

export function resolveVariants(list) {
  if (!list || list === 'all') return [...VARIANTS];
  const out = [];
  for (const raw of list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const v = VARIANT_ALIASES[raw] ?? raw;
    if (!VARIANTS.includes(v))
      throw new Error(
        `unknown variant "${raw}" (use ${[...VARIANTS, ...Object.keys(VARIANT_ALIASES)].join(', ')} or all)`,
      );
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * Glob to RegExp. `*` matches within one path segment, `**` any number of segments
 * (`sections/**` = everything below sections/), `?` one character. Paths use `/`.
 */
export function globToRegExp(glob) {
  if (typeof glob !== 'string' || glob === '') throw new Error('empty glob');
  if (glob.startsWith('/') || glob.split('/').includes('..'))
    throw new Error(`glob must be relative and stay inside the project: ${glob}`);
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export const matchesAny = (globs, path) => globs.some((g) => globToRegExp(g).test(path));

export function loadTasks(root, ids) {
  const dir = join(root, 'evals', 'tasks');
  const tasks = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      let task;
      try {
        task = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      } catch (e) {
        throw new Error(`${f}: ${e.message}`);
      }
      return { ...task, _file: f };
    });
  const selected = ids?.length ? tasks.filter((t) => ids.includes(t.id)) : tasks;
  for (const id of ids ?? [])
    if (!tasks.some((t) => t.id === id)) throw new Error(`no task "${id}"`);
  return selected;
}

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Returns a list of problems with a task definition (empty when it is valid). */
export function validateTask(root, task) {
  const errs = [];
  const err = (m) => errs.push(m);
  if (typeof task.id !== 'string' || !/^[a-z0-9-]+$/.test(task.id))
    err('id must be lowercase letters, digits and dashes');
  else if (task._file && task._file !== `${task.id}.json`)
    err(`file name ${task._file} does not match id ${task.id}`);
  for (const k of ['title', 'prompt'])
    if (typeof task[k] !== 'string' || !task[k].trim()) err(`${k} is required`);
  if (Boolean(task.template) === Boolean(task.project))
    err('exactly one of "template" and "project" is required');
  if (task.template) {
    if (!existsSync(join(root, 'templates', task.template)))
      err(`template "${task.template}" does not exist in templates/`);
  }
  if (task.project) {
    const p = join(root, task.project);
    if (!existsSync(p) || !statSync(p).isDirectory())
      err(`project "${task.project}" is not a directory`);
  }
  if (!Array.isArray(task.allowed) || task.allowed.length === 0)
    err('allowed must be a non-empty array of globs');
  for (const key of ['allowed', 'tolerated']) {
    for (const g of task[key] ?? []) {
      try {
        globToRegExp(g);
      } catch (e) {
        err(`${key}: ${e.message}`);
      }
    }
  }
  for (const k of ['maxAddedLines', 'maxOutsideAddedLines'])
    if (task[k] !== undefined && !(Number.isInteger(task[k]) && task[k] >= 0))
      err(`${k} must be a non-negative integer`);
  for (const [file, patch] of Object.entries(task.setup ?? {})) {
    if (!isObject(patch)) err(`setup.${file} must be an object (merged into the YAML file)`);
  }
  (task.edits ?? []).forEach((e, i) => {
    if (
      !isObject(e) ||
      typeof e.file !== 'string' ||
      typeof e.find !== 'string' ||
      typeof e.replace !== 'string' ||
      e.find === ''
    )
      err(`edits[${i}] needs file, find (non-empty) and replace strings`);
  });
  for (const [file, spec] of Object.entries(task.write ?? {})) {
    if (typeof spec === 'string') continue;
    if (isObject(spec) && typeof spec.generate === 'string') {
      if (!GENERATORS[spec.generate]) err(`write.${file}: unknown generator "${spec.generate}"`);
    } else if (isObject(spec) && typeof spec.from === 'string') {
      if (!existsSync(join(root, spec.from))) err(`write.${file}: ${spec.from} does not exist`);
    } else err(`write.${file} must be a string, {from} or {generate}`);
  }
  const ex = task.expect;
  if (!isObject(ex)) err('expect is required');
  else {
    if (
      !Array.isArray(ex.status) ||
      ex.status.length === 0 ||
      ex.status.some((s) => !STATUSES.includes(s))
    )
      err(`expect.status must list some of ${STATUSES.join(', ')}`);
    if (!Number.isInteger(ex.maxErrors) || ex.maxErrors < 0)
      err('expect.maxErrors must be a non-negative integer');
    for (const k of ['noRules', 'files'])
      if (
        ex[k] !== undefined &&
        (!Array.isArray(ex[k]) || ex[k].some((s) => typeof s !== 'string'))
      )
        err(`expect.${k} must be an array of strings`);
    for (const k of ['citedAtLeast', 'maxUnverified'])
      if (ex[k] !== undefined && !(Number.isInteger(ex[k]) && ex[k] >= 0))
        err(`expect.${k} must be a non-negative integer`);
    for (const k of ['contains', 'notContains'])
      (ex[k] ?? []).forEach((c, i) => {
        if (!isObject(c) || typeof c.file !== 'string' || typeof c.pattern !== 'string') {
          err(`expect.${k}[${i}] needs file and pattern`);
          return;
        }
        try {
          new RegExp(expandPlaceholders(c.pattern, root), c.flags ?? 'i');
        } catch (e) {
          err(`expect.${k}[${i}]: ${e.message}`);
        }
      });
  }
  return errs;
}
