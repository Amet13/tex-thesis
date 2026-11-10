/** check ignores build.image and runs tools locked down. */
import { execFileSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Report } from '@overfull/core';
import { afterEach, describe, expect, it } from 'vitest';
import { checkImage, runCheck } from '../src/check.js';
import { DEFAULT_IMAGE } from '../src/config.js';
import { dockerToolArgs } from '../src/tools.js';
import { tempCopy, tempDir } from './helpers.js';

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

// --- R2: check never runs a project-chosen image ---------------------------------

describe('R2: check ignores build.image and runs tools locked down', () => {
  it.skipIf(POSIX_ONLY)(
    'picks --image, then $OVERFULL_IMAGE, then the default; never overfull.yml',
    async () => {
      expect(checkImage({ env: {} })).toBe(DEFAULT_IMAGE);
      expect(checkImage({ env: { OVERFULL_IMAGE: 'overfull:dev' } })).toBe('overfull:dev');
      expect(checkImage({ env: { OVERFULL_IMAGE: 'overfull:dev' }, image: 'x/y:1' })).toBe('x/y:1');
      expect(() => checkImage({ env: {}, image: '--privileged' })).toThrow(/Invalid Docker image/);

      const log = join(tempDir(), 'docker-args');
      const bin = fakeBin({
        docker: `echo "$@" >> ${log}\nif [ "$1" = info ]; then echo 27.0; fi\necho '{}'`,
      });
      process.env.PATH = `${bin}:${savedPath}`;
      const dir = tempCopy('project');
      writeFileSync(
        join(dir, 'overfull.yml'),
        `${readFileSync(join(dir, 'overfull.yml'), 'utf8')}build:\n  image: evil.example/pwn:latest\n`,
      );
      await runCheck({
        cwd: dir,
        checks: ['accessibility'],
        engine: 'docker',
        env: { PATH: bin },
      });
      const calls = readFileSync(log, 'utf8');
      expect(calls).not.toContain('evil.example');
      const verapdf = calls.split('\n').find((l) => l.includes('--entrypoint verapdf')) ?? '';
      expect(verapdf).toContain(DEFAULT_IMAGE);
      expect(verapdf).toContain('--network none');
      expect(verapdf).toMatch(/--mount type=bind,source=[^ ]+,target=\/work,readonly/);
      expect(verapdf).toMatch(/--user \d+:\d+/);
    },
  );

  it('dockerToolArgs puts the entrypoint before the image', () => {
    const args = dockerToolArgs('img:1', '/p', 'pdffonts', ['./a.pdf']);
    const i = args.indexOf('img:1');
    expect(args.slice(i - 2, i)).toEqual(['--entrypoint', 'pdffonts']);
    expect(args.slice(i + 1)).toEqual(['./a.pdf']);
    expect(args).not.toContain('-v');
  });
});
