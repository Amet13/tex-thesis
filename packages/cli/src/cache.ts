import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RefCache } from '@overfull/core';

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
