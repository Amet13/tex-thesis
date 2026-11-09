import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import type { RefCache } from '@overfull/core';

type Env = Record<string, string | undefined>;

/** The per-user cache directory: %LOCALAPPDATA%, $XDG_CACHE_HOME or ~/.cache, plus /overfull. */
export function userCacheDir(env: Env, platform: NodeJS.Platform = process.platform): string {
  const home = env.HOME || env.USERPROFILE || homedir();
  if (platform === 'win32')
    return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'overfull');
  return join(env.XDG_CACHE_HOME || join(home, '.cache'), 'overfull');
}

/**
 * Where reference lookups for a project are cached. By default outside the
 * project (keyed by a hash of its root), so a cache committed to a repository
 * cannot mark references as verified. `references.cache: project` keeps the
 * old `.overfull/cache/refs.json`.
 */
export function refsCachePath(root: string, mode: 'user' | 'project', env: Env): string {
  if (mode === 'project') return join(root, '.overfull', 'cache', 'refs.json');
  let real = root;
  try {
    real = realpathSync(root);
  } catch {
    /* keep root */
  }
  const key = createHash('sha256').update(real).digest('hex').slice(0, 16);
  return join(userCacheDir(env), key, 'refs.json');
}

/** True when `file` is tracked by git in the repository containing `root`. */
export function trackedByGit(root: string, file: string): boolean {
  const r = spawnSync('git', ['ls-files', '--error-unmatch', '--', relative(root, file)], {
    cwd: root,
    stdio: 'ignore',
    timeout: 10000,
  });
  return r.status === 0;
}

/** A JSON-file-backed RefCache. Call `save()` once at the end; failures to save are ignored. */
export class FileCache implements RefCache {
  private data: Record<string, unknown> = {};
  private dirty = false;

  constructor(private readonly path: string) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        this.data = parsed as Record<string, unknown>;
    } catch {
      this.data = {};
    }
  }

  get(key: string): unknown {
    return this.data[key];
  }

  set(key: string, value: unknown): void {
    this.data[key] = value;
    this.dirty = true;
  }

  save(): void {
    if (!this.dirty) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, `${JSON.stringify(this.data, null, 1)}\n`);
      this.dirty = false;
    } catch {
      /* a read-only checkout must not fail the check */
    }
  }
}
