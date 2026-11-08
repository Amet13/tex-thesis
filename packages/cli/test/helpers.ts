import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Io } from '../src/io.js';

export interface MemIo extends Io {
  out: string[];
  err: string[];
  stdoutText(): string;
  stderrText(): string;
}

export function memIo(cwd: string, env: Record<string, string | undefined> = {}): MemIo {
  const out: string[] = [];
  const err: string[] = [];
  return {
    cwd,
    // Keep PATH so tool detection works, but no colors and no real network by default.
    env: { PATH: process.env.PATH, NO_COLOR: '1', ...env },
    isTTY: false,
    out,
    err,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    stdoutText: () => out.join(''),
    stderrText: () => err.join(''),
    fetch: (() => Promise.reject(new Error('network disabled in tests'))) as typeof fetch,
  };
}

/** Copies a fixture directory to a fresh temp dir and returns its path. */
export function tempCopy(fixture: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'overfull-test-'));
  cpSync(new URL(`./fixtures/${fixture}`, import.meta.url), dir, { recursive: true });
  return dir;
}

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'overfull-test-'));
}
