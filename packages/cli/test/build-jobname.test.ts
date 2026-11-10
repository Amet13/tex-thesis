/** build <file> derives the jobname unless overfull.yml sets it. */
import { execFileSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Report } from '@overfull/core';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../src/main.js';
import { memIo, tempDir } from './helpers.js';

/** Shell-script fakes on PATH and FIFOs do not exist on Windows; these tests run on Linux and macOS. */
const POSIX_ONLY = process.platform === 'win32';

const _git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });

function fakeBin(scripts: Record<string, string>): string {
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

// --- R6: build jobname ---------------------------------------------------------

describe.skipIf(POSIX_ONLY)(
  'R6: build <file> derives the jobname unless overfull.yml sets it',
  () => {
    async function jobnameFor(config: [string, string] | undefined): Promise<string> {
      const log = join(tempDir(), 'latexmk-args');
      const bin = fakeBin({ latexmk: `echo "$@" > ${log}\nexit 1` });
      process.env.PATH = `${bin}:${savedPath}`;
      const dir = tempDir();
      writeFileSync(join(dir, 'main.tex'), '');
      writeFileSync(join(dir, 'other.tex'), '');
      if (config) writeFileSync(join(dir, config[0]), config[1]);
      await main(
        ['build', 'other.tex', '--engine', 'local'],
        memIo(dir, { PATH: process.env.PATH }),
      );
      return /-jobname=(\S+)/.exec(readFileSync(log, 'utf8'))?.[1] ?? '';
    }

    it('follows the given file with overfull.yaml or overfull.yml lacking jobname', async () => {
      expect(await jobnameFor(['overfull.yaml', 'checks: [build]\n'])).toBe('other');
      expect(await jobnameFor(['overfull.yml', 'checks: [build]\n'])).toBe('other');
      expect(await jobnameFor(undefined)).toBe('other');
    });

    it('keeps an explicit jobname', async () => {
      expect(await jobnameFor(['overfull.yml', 'jobname: thesis\n'])).toBe('thesis');
    });
  },
);
