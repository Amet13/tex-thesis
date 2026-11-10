/** doctor exit code and veraPDF advice. */
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Report } from '@overfull/core';
import { afterEach, describe, expect, it } from 'vitest';
import { runCheck } from '../src/check.js';
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

const problems = (r: Report) => r.checks.flatMap((c) => c.problems);

describe('A13: doctor exit code and veraPDF advice', () => {
  it.skipIf(POSIX_ONLY)('doctor exits 1 and says so first when nothing can build', async () => {
    const bin = fakeBin({
      docker: `case "$1" in info) echo 27.0; exit 0;; image) exit 1;; manifest) echo "manifest unknown" >&2; exit 1;; esac\nexit 1`,
    });
    process.env.PATH = `${bin}:/usr/bin:/bin`;
    const io = memIo(tempDir(), { PATH: process.env.PATH });
    expect(await main(['doctor'], io)).toBe(1);
    expect(io.stdoutText()).toMatch(/^Cannot build/);
  });

  it('check: veraPDF not run is only a note when it could not have run (no Docker)', async () => {
    const report = await runCheck({
      cwd: tempCopy('project'),
      checks: ['accessibility'],
      engine: 'local',
      env: { PATH: '/nonexistent' },
    });
    const v = problems(report).find((p) => p.rule === 'verapdf-not-run');
    expect(v?.severity).toBe('info');
  });
});
