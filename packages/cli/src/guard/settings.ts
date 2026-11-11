/**
 * Hook configuration files of the agent kit (`.claude/settings.json`,
 * `.gemini/settings.json`) and how `init --here --agents` adds the Overfull hook
 * to a file that already exists: the hook entry is added, every other key stays.
 */

import { execFileSync } from 'node:child_process';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

/** Kit files that hold hook configuration and are merged, not overwritten. */
export const HOOK_SETTINGS_FILES = new Set([
  '.claude/settings.json',
  '.gemini/settings.json',
  '.codex/hooks.json',
]);

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function commandsOf(group: unknown): string[] {
  if (!isObject(group) || !Array.isArray(group.hooks)) return [];
  return group.hooks.flatMap((h) =>
    isObject(h) && typeof h.command === 'string' ? [h.command] : [],
  );
}

/**
 * Adds the hook groups of `wanted` to `existing` (JSON text of a settings file).
 * A group whose command is already present is not added again. Returns the new
 * text, or undefined when there is nothing to change; `error` when `existing`
 * or `wanted` is not a JSON object (the file is then left alone).
 */
export function mergeHookSettings(
  existing: string,
  wanted: string,
): { text?: string; error?: string } {
  let have: unknown;
  let want: unknown;
  try {
    have = JSON.parse(existing);
    want = JSON.parse(wanted);
  } catch {
    return { error: 'is not valid JSON; left alone' };
  }
  if (!isObject(have) || !isObject(want)) return { error: 'is not a JSON object; left alone' };
  const wantHooks = isObject(want.hooks) ? want.hooks : {};
  if (have.hooks !== undefined && !isObject(have.hooks))
    return { error: 'has a "hooks" value that is not an object; left alone' };
  const merged: Json = { ...have, hooks: { ...(have.hooks as Json | undefined) } };
  const hooks = merged.hooks as Json;
  let changed = false;
  for (const [event, groups] of Object.entries(wantHooks)) {
    if (!Array.isArray(groups)) continue;
    const current = hooks[event];
    if (current !== undefined && !Array.isArray(current))
      return { error: `has "hooks.${event}" that is not a list; left alone` };
    const list: unknown[] = Array.isArray(current) ? [...current] : [];
    const present = new Set(list.flatMap(commandsOf));
    for (const g of groups) {
      if (commandsOf(g).every((c) => present.has(c))) continue;
      list.push(g);
      changed = true;
    }
    hooks[event] = list;
  }
  return changed ? { text: `${JSON.stringify(merged, null, 2)}\n` } : {};
}

const PRE_COMMIT_SCRIPT = `#!/bin/sh
# Installed by \`overfull init --here --hooks\`: blocks hand-written .bib entries.
# Does nothing when overfull is not installed.
command -v overfull >/dev/null 2>&1 || exit 0
exec overfull guard --staged
`;

/** The line that adds the guard to a pre-commit hook that already exists. */
const PRE_COMMIT_LINE = 'overfull guard --staged || exit 1';

export interface GitHookResult {
  status: 'written' | 'would-write' | 'exists' | 'no-git' | 'elsewhere';
  path?: string;
  /** Printed when the hook was not installed. */
  line?: string;
}

/**
 * Installs `.git/hooks/pre-commit` for `root` when it does not exist. Never
 * overwrites a hook, and never writes outside the repository's own git
 * directory (a `core.hooksPath` elsewhere gets the line to add instead).
 */
export function installGitHook(root: string, dryRun: boolean): GitHookResult {
  const gitOut = (args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  let gitDir: string;
  let hook: string;
  try {
    // Compare real paths: on macOS the temp folder is a symlink (/var → /private/var),
    // and on Windows git prints long forward-slash paths where Node may hold short names.
    const base = realpathSync.native(root);
    gitDir = realpathSync.native(resolve(base, gitOut(['rev-parse', '--absolute-git-dir'])));
    hook = resolve(base, gitOut(['rev-parse', '--git-path', 'hooks/pre-commit']));
  } catch {
    return { status: 'no-git' };
  }
  const fold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
  if (!fold(hook).startsWith(fold(gitDir + sep)))
    return { status: 'elsewhere', path: hook, line: PRE_COMMIT_LINE };
  if (dryRun)
    return existsSync(hook)
      ? { status: 'exists', path: hook, line: PRE_COMMIT_LINE }
      : { status: 'would-write', path: hook };
  // No existence check before the write: O_EXCL below fails with EEXIST when
  // a hook is already there, so nothing can slip in between.
  try {
    mkdirSync(dirname(hook), { recursive: true });
    const fs = openSync(hook, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o755);
    try {
      if (!fstatSync(fs).isFile()) return { status: 'exists', path: hook, line: PRE_COMMIT_LINE };
      writeSync(fs, PRE_COMMIT_SCRIPT);
    } finally {
      closeSync(fs);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST')
      return { status: 'exists', path: hook, line: PRE_COMMIT_LINE };
    throw err;
  }
  return { status: 'written', path: hook };
}
