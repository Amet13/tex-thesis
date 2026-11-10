/** Bibliography errors and source-derived problems carry .bib and file:line locations. */
import { chmodSync, cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Report } from '@overfull/core';
import { afterEach, describe, expect, it } from 'vitest';
import { runCheck } from '../src/check.js';
import { loadConfig } from '../src/config.js';
import { tempCopy, tempDir } from './helpers.js';

/** Shell-script fakes on PATH and FIFOs do not exist on Windows; these tests run on Linux and macOS. */
const _POSIX_ONLY = process.platform === 'win32';

const savedPath = process.env.PATH;
afterEach(() => {
  process.env.PATH = savedPath;
});

function _fakeBin(scripts: Record<string, string>): string {
  const dir = tempDir();
  for (const [name, body] of Object.entries(scripts)) {
    const p = join(dir, name);
    writeFileSync(p, `#!/bin/sh\n${body}\n`);
    chmodSync(p, 0o755);
  }
  return dir;
}

const problems = (r: Report) => r.checks.flatMap((c) => c.problems);

describe('A3: errors from typeset bibliography entries point at the .bib entry', () => {
  for (const [name, engine] of [
    ['bbl-a', 'biblatex (reported at main.tex)'],
    ['bbl-b', 'BibTeX (reported at main.bbl)'],
  ] as const) {
    it(engine, async () => {
      const dir = tempDir();
      cpSync(new URL(`./fixtures/${name}`, import.meta.url), dir, { recursive: true });
      const report = await runCheck({
        cwd: dir,
        checks: ['build'],
        offline: true,
        env: { PATH: process.env.PATH },
      });
      const tab = problems(report).find((p) => p.rule === 'misplaced-alignment-tab');
      expect(tab?.data?.bibKey).toBe('bad');
      expect(tab?.message).toContain('in the bibliography entry `bad`');
      expect(tab?.location).toEqual({ file: 'references.bib', line: 8 });
    });
  }
});

describe('A4 + A9 + A10: sources feed accessibility and citation locations; order', () => {
  it('figure-missing-alt comes from the source with file:line; citation-key-missing has a line', async () => {
    const report = await runCheck({
      cwd: tempCopy('project'),
      offline: true,
      verapdf: false,
      env: { PATH: process.env.PATH },
    });
    const alt = problems(report).find((p) => p.rule === 'figure-missing-alt');
    expect(alt?.location).toEqual({ file: 'main.tex', line: 16 });
    expect(alt?.severity).toBe('error'); // thesis profile: accessibility required
    const missing = problems(report).find((p) => p.rule === 'citation-key-missing');
    expect(missing?.location).toMatchObject({ file: 'main.tex', line: 13 });
  });

  it('problems in each check are sorted errors → warnings → info, then by file and line', async () => {
    const report = await runCheck({
      cwd: tempCopy('project'),
      offline: true,
      verapdf: false,
      env: { PATH: process.env.PATH },
    });
    const order = { error: 0, warning: 1, info: 2 };
    for (const c of report.checks) {
      const keys = c.problems.map(
        (p) => [order[p.severity], p.location?.file ?? '￿', p.location?.line ?? 0] as const,
      );
      const sorted = [...keys].sort(
        (a, b) => a[0] - b[0] || a[1].localeCompare(b[1]) || a[2] - b[2],
      );
      expect(keys, c.check).toEqual(sorted);
    }
  });

  it('the paper profile requires accessibility', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'overfull.yml'), 'profile: paper\n');
    expect(loadConfig(dir).profile.accessibility).toBe('required');
  });
});
