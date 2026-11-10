import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
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

/**
 * The first path component from `root` down to `file` (both included) that is
 * a symlink, or undefined. A cache reached through a symlink may be a file the
 * repository controls (`.overfull -> some/tracked/dir`), so it is not used.
 */
export function symlinkOnPath(root: string, file: string): string | undefined {
  const parts = relative(root, file).split(sep).filter(Boolean);
  let p = root;
  for (const part of parts) {
    p = join(p, part);
    try {
      if (lstatSync(p).isSymbolicLink()) return p;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** A RefCache that lives only for this run (fresh in CI). */
export class MemoryCache implements RefCache {
  private readonly data = new Map<string, unknown>();
  get(key: string): unknown {
    return this.data.get(key);
  }
  set(key: string, value: unknown): void {
    this.data.set(key, value);
  }
  save(): void {}
}

/** Entries older than the longest lifetime (30 days for a record) are dropped on save. */
const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** Newest `cachedAt` of a stored value (a number, or a per-source map for title searches). */
function storedAt(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const at = (value as { cachedAt?: unknown }).cachedAt;
  if (typeof at === 'number') return at;
  if (at && typeof at === 'object') {
    const times = Object.values(at).filter((t): t is number => typeof t === 'number');
    return times.length ? Math.max(...times) : undefined;
  }
  return undefined;
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
    const now = Date.now();
    for (const [key, value] of Object.entries(this.data)) {
      const at = storedAt(value);
      if (at !== undefined && now - at > PRUNE_AFTER_MS) delete this.data[key];
    }
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, `${JSON.stringify(this.data, null, 1)}\n`);
      this.dirty = false;
    } catch {
      /* a read-only checkout must not fail the check */
    }
  }
}
