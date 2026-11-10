/** Cite keys are BibTeX-safe. */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Report } from '@overfull/core';
import { afterEach, describe, expect, it } from 'vitest';
import { citeCommand, sanitizeKey } from '../src/commands/cite.js';
import { memIo, tempDir } from './helpers.js';

/** Shell-script fakes on PATH and FIFOs do not exist on Windows; these tests run on Linux and macOS. */
const _POSIX_ONLY = process.platform === 'win32';

const _git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });

function _fakeBin(scripts: Record<string, string>): string {
  const dir = tempDir();
  for (const [name, body] of Object.entries(scripts)) {
    const p = join(dir, name);
    writeFileSync(p, `#!/bin/sh\n${body}\n`);
    chmodSync(p, 0o755);
  }
  return dir;
}

const savedPath = process.env.PATH;
afterEach(() => {
  process.env.PATH = savedPath;
});

const _rules = (r: Report) => r.checks.flatMap((c) => c.problems.map((p) => p.rule));

/** True when some line, after the whitespace the Actions runner trims, is a workflow command. */
function _hasCommand(text: string): boolean {
  return text
    .split(/[\r\n]/)
    .some((l) => /^(::|##\[)/.test(l.replace(/^[\s\u0085\u00a0\ufeff\f\v]+/, '')));
}

/** Every line that is a workflow command, other than stop-commands markers. */
function _commandsIn(text: string): string[] {
  return text
    .split(/[\r\n]/)
    .map((l) => l.replace(/^[\s\u0085\u00a0\ufeff\f\v]+/, ''))
    .filter((l) => /^(::|##\[)/.test(l))
    .filter((l) => !/^::(stop-commands::overfull-[0-9a-f]{32}|overfull-[0-9a-f]{32}::)$/.test(l));
}

// --- R9: citation keys --------------------------------------------------------

describe('R9: cite keys are BibTeX-safe', () => {
  const lookup = (key: string) => async () => ({
    entry: { key, type: 'misc', line: 0, raw: '', fields: { title: 'T', doi: '10.1/x' } },
    source: 'doi.org',
    confidence: 1,
  });

  it('rejects an unsafe --key and writes nothing', async () => {
    const dir = tempDir();
    for (const key of ['a,b', 'x}, title={evil', 'a b', 'k"q', '\\input']) {
      const io = memIo(dir);
      await expect(citeCommand(['10.1/x', '--key', key], io, lookup('k'))).rejects.toThrow(
        /Invalid --key/,
      );
    }
    expect(existsSync(join(dir, 'references.bib'))).toBe(false);
    const ok = memIo(dir);
    expect(await citeCommand(['10.1/x', '--key', 'Knuth:1984/lp.v2+x'], ok, lookup('k'))).toBe(0);
  });

  it('sanitizes keys generated from index metadata', async () => {
    expect(sanitizeKey('evil},\n@misc{x')).toBe('evilmiscx');
    expect(sanitizeKey('{}')).toBe('anon');
    const dir = tempDir();
    const io = memIo(dir);
    await citeCommand(['10.1/x'], io, lookup('evil}, note={x'));
    const text = readFileSync(join(dir, 'references.bib'), 'utf8');
    expect(text).toMatch(/^@misc\{evilnotex,/);
  });
});
