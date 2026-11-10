/** --json on every command; a no-change build does not run LaTeX. */
import { chmodSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Report } from '@overfull/core';
import { afterEach, describe, expect, it } from 'vitest';
import { upToDate } from '../src/commands/build.js';
import { loadConfig } from '../src/config.js';
import { main } from '../src/main.js';
import { memIo, tempCopy, tempDir } from './helpers.js';

/** Shell-script fakes on PATH and FIFOs do not exist on Windows; these tests run on Linux and macOS. */
const POSIX_ONLY = process.platform === 'win32';

const savedPath = process.env.PATH;
afterEach(() => {
  process.env.PATH = savedPath;
});

function fakeBin(scripts: Record<string, string>): string {
  const dir = tempDir();
  for (const [name, body] of Object.entries(scripts)) {
    const p = join(dir, name);
    writeFileSync(p, `#!/bin/sh\n${body}\n`);
    chmodSync(p, 0o755);
  }
  return dir;
}

const _problems = (r: Report) => r.checks.flatMap((c) => c.problems);

describe('A8: --json on every command', () => {
  it('usage errors are JSON with exit 2', async () => {
    for (const args of [
      ['build', '--json', 'nope.tex'],
      ['pages', '--json'],
      ['diff', '--json'],
      ['explain', '--json', 'no-such-rule'],
      ['check', '--json', '--fail-on', 'sometimes'],
      ['init', '--json', 'nosuchtemplate', 'x'],
    ]) {
      const io = memIo(tempDir());
      expect(await main(args, io), args.join(' ')).toBe(2);
      const out = JSON.parse(io.stdoutText()) as { error: { code: string; message: string } };
      expect(out.error.code, args.join(' ')).toBe('usage');
      expect(out.error.message.length).toBeGreaterThan(0);
    }
  });

  it('init and explain print JSON results', async () => {
    const io = memIo(tempDir());
    expect(await main(['init', 'paper', 'p', '--no-git', '--json'], io)).toBe(0);
    expect(JSON.parse(io.stdoutText())).toEqual({ template: 'paper', dir: 'p', git: null });
    const ex = memIo(tempDir());
    await main(['explain', 'overfull-box', '--json'], ex);
    expect((JSON.parse(ex.stdoutText()) as { id: string }).id).toBe('overfull-box');
  });

  it('build --json prints the report (from an up-to-date build)', async () => {
    const dir = upToDateProject();
    const io = memIo(dir, { PATH: '/nonexistent' });
    expect(await main(['build', '--json'], io)).toBe(0);
    const report = JSON.parse(io.stdoutText()) as Report;
    expect(report.tool).toBe('overfull');
    expect(report.checks.map((c) => c.check)).toEqual(['build', 'output']);
  });
});

/** The fixture project with a recorder file, its PDF newer than every source. */
function upToDateProject(): string {
  const dir = tempCopy('project');
  writeFileSync(
    join(dir, 'thesis.fls'),
    `PWD ${dir}\nINPUT /usr/share/texmf/tex/latex/base/article.cls\nINPUT ./main.tex\nINPUT ${dir}/thesis.aux\nOUTPUT thesis.pdf\n`,
  );
  const past = new Date(Date.now() - 60_000);
  for (const f of ['main.tex', 'references.bib', 'overfull.yml', 'thesis.aux'])
    utimesSync(join(dir, f), past, past);
  // The fixture log has errors; an up-to-date build needs a clean last run.
  const log = readFileSync(join(dir, 'thesis.log'), 'utf8')
    .split('\n')
    .filter((l) => !/^! |^\S+:\d+: /.test(l))
    .join('\n');
  writeFileSync(join(dir, 'thesis.log'), log);
  const now = new Date();
  utimesSync(join(dir, 'thesis.pdf'), now, now);
  return dir;
}

describe('A12: a no-change build does not run LaTeX', () => {
  it.skipIf(POSIX_ONLY)('skips latexmk when the PDF is newer than every input', async () => {
    const dir = upToDateProject();
    expect(upToDate(loadConfig(dir), 'main.tex')).toBe(true);
    const log = join(tempDir(), 'calls');
    const bin = fakeBin({ latexmk: `echo "$@" >> ${log}\nexit 0` });
    process.env.PATH = `${bin}:${savedPath}`;
    const io = memIo(dir, { PATH: process.env.PATH });
    await main(['build', '--engine', 'local'], io);
    expect(io.stderrText()).toContain('up to date');
    expect(() => readFileSync(log, 'utf8')).toThrow();
    // --force runs latexmk with -g
    await main(['build', '--engine', 'local', '--force'], memIo(dir, { PATH: process.env.PATH }));
    expect(readFileSync(log, 'utf8')).toMatch(/^-g /);
  });

  it('a source edited after the PDF means not up to date', () => {
    const dir = upToDateProject();
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(dir, 'main.tex'), later, later);
    expect(upToDate(loadConfig(dir), 'main.tex')).toBe(false);
    const dir2 = upToDateProject();
    utimesSync(join(dir2, 'references.bib'), later, later);
    expect(upToDate(loadConfig(dir2), 'main.tex')).toBe(false);
  });
});
