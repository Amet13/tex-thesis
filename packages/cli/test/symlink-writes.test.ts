/** Write paths stay inside the project, also through symlinks. */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Report } from '@overfull/core';
import { afterEach, describe, expect, it } from 'vitest';
import { citeCommand } from '../src/commands/cite.js';
import { main } from '../src/main.js';
import { insideRootForWrite } from '../src/safety.js';
import { memIo, tempCopy, tempDir } from './helpers.js';

/** Shell-script fakes on PATH and FIFOs do not exist on Windows; these tests run on Linux and macOS. */
const POSIX_ONLY = process.platform === 'win32';

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

// --- R5: writes stay inside the project -----------------------------------------

describe('R5: write paths through symlinks', () => {
  function project() {
    const outside = tempDir();
    const dir = tempDir();
    symlinkSync(outside, join(dir, 'link'));
    symlinkSync(join(outside, 'nope', 'new.bib'), join(dir, 'dangling.bib'));
    return { outside, dir };
  }

  it('insideRootForWrite refuses symlinked parents and dangling links', () => {
    const { dir } = project();
    expect(() => insideRootForWrite(dir, 'link/new.bib', 'Bibliography file')).toThrow(
      /through a symlink/,
    );
    expect(() => insideRootForWrite(dir, 'link/a/b/c.pdf', 'Output PDF')).toThrow(/symlink/);
    expect(() => insideRootForWrite(dir, 'dangling.bib', 'Bibliography file')).toThrow(
      /dangling symlink/,
    );
    expect(insideRootForWrite(dir, 'sub/new.bib', 'Bibliography file')).toBe(
      join(dir, 'sub', 'new.bib'),
    );
  });

  it('cite --bib does not create a file outside through a symlinked dir', async () => {
    const { outside, dir } = project();
    const lookup = async () => ({
      entry: {
        key: 'k',
        type: 'misc',
        line: 0,
        raw: '',
        fields: { title: 'T', doi: '10.1/x' },
      },
      source: 'doi.org',
      confidence: 1,
    });
    for (const bib of ['link/new.bib', 'dangling.bib']) {
      const io = memIo(dir);
      await expect(citeCommand(['10.1/x', '--bib', bib], io, lookup)).rejects.toThrow(/symlink/);
    }
    expect(existsSync(join(outside, 'new.bib'))).toBe(false);
    expect(existsSync(join(outside, 'nope'))).toBe(false);
  });

  it('pages --out and init refuse a symlinked target', async () => {
    const { outside, dir } = project();
    execFileSync('cp', [join(tempCopy('project'), 'thesis.pdf'), join(dir, 'main.pdf')]);
    const io = memIo(dir);
    expect(await main(['pages', '1', '--out', 'link/png'], io)).toBe(2);
    expect(io.stderrText()).toContain('symlink');
    const io2 = memIo(dir);
    expect(await main(['init', 'paper', 'link', '--no-git'], io2)).toBe(2);
    expect(await main(['init', 'paper', 'link/x', '--no-git'], memIo(dir))).toBe(2);
    expect(existsSync(join(outside, 'png'))).toBe(false);
    expect(existsSync(join(outside, 'main.tex'))).toBe(false);
    expect(existsSync(join(outside, 'x'))).toBe(false);
  });

  it.skipIf(POSIX_ONLY)('diff --out refuses a symlinked directory', async () => {
    const { dir } = project();
    expect(() => insideRootForWrite(dir, 'link/diff.pdf', 'Output PDF')).toThrow(/symlink/);
  });
});
