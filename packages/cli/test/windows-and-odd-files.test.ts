/** Windows batch wrappers and paths; non-regular and huge files. */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Report } from '@overfull/core';
import { afterEach, describe, expect, it } from 'vitest';
import { runCheck } from '../src/check.js';
import { resolveEngine } from '../src/commands/build.js';
import { main } from '../src/main.js';
import { readTexFiles } from '../src/project.js';
import { bindMount, which } from '../src/tools.js';
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

const rules = (r: Report) => r.checks.flatMap((c) => c.problems.map((p) => p.rule));

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

// --- R12: Windows ---------------------------------------------------------------

describe('R12: Windows batch wrappers and paths', () => {
  it('which() skips .bat/.cmd on win32 unless allowed; build explains', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'latexmk.BAT'), '@echo off\n');
    const env = { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' };
    expect(which('latexmk', env, { platform: 'win32' })).toBeUndefined();
    expect(which('latexmk', env, { platform: 'win32', allowBatch: true })).toBe(
      join(dir, 'latexmk.BAT'),
    );
    await expect(resolveEngine('local', env, 'win32')).rejects.toThrow(
      /latexmk\.BAT found.*latexmk\.exe.*--engine docker/,
    );
    writeFileSync(join(dir, 'latexmk.EXE'), '');
    expect(await resolveEngine('local', env, 'win32')).toBe('local');
  });

  it('mounts with --mount so a path with ":" or "," is unambiguous', () => {
    expect(bindMount('C:\\Users\\me\\paper')).toEqual([
      '--mount',
      'type=bind,source=C:\\Users\\me\\paper,target=/work',
    ]);
    expect(bindMount('/a,b/p', true)).toEqual([
      '--mount',
      'type=bind,"source=/a,b/p",target=/work,readonly',
    ]);
  });
});

// --- R14: odd files ---------------------------------------------------------------

describe('R14: non-regular and huge files', () => {
  it.skipIf(POSIX_ONLY)('skips FIFOs and files over 20 MB when reading sources', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'main.tex'), 'x');
    execFileSync('mkfifo', [join(dir, 'pipe.tex')]);
    writeFileSync(join(dir, 'big.tex'), '');
    truncateSync(join(dir, 'big.tex'), 21 * 1024 * 1024);
    const skipped: { path: string; reason: string }[] = [];
    const files = readTexFiles(dir, ['big.tex', 'main.tex', 'pipe.tex'], skipped);
    expect(files.map((f) => f.path)).toEqual(['main.tex']);
    expect(skipped.map((s) => s.path)).toEqual(['big.tex', 'pipe.tex']);
  });

  it.skipIf(POSIX_ONLY)(
    'check reports skipped sources as info and does not hang on a FIFO',
    async () => {
      const dir = tempCopy('project');
      execFileSync('mkfifo', [join(dir, 'pipe.tex')]);
      const report = await runCheck({
        cwd: dir,
        checks: ['venue'],
        verapdf: false,
        env: { PATH: process.env.PATH },
      });
      expect(rules(report)).toContain('tex-file-skipped');
    },
  );

  it('a directory named like the log or PDF is a clean usage error', async () => {
    for (const name of ['thesis.log', 'thesis.pdf']) {
      const dir = tempCopy('project');
      execFileSync('rm', [join(dir, name)]);
      mkdirSync(join(dir, name));
      const io = memIo(dir);
      expect(await main(['check', '--offline', '--no-verapdf'], io), name).toBe(2);
      expect(io.stderrText()).toContain('is not a file');
      expect(io.stderrText()).not.toContain('internal error');
    }
  });
});
