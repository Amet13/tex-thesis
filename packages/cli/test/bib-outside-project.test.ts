/** A discovered .bib outside the project is a warning, not an abort. */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Report } from '@overfull/core';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../src/main.js';
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

// --- R8: bib outside the project -------------------------------------------------

describe('R8: a discovered .bib outside the project is a warning, not an abort', () => {
  it('\\bibliography{../shared/refs} → bib-outside-project, exit 0', async () => {
    const parent = tempDir();
    mkdirSync(join(parent, 'shared'));
    writeFileSync(join(parent, 'shared', 'refs.bib'), '@misc{s, title={Secret}}\n');
    const dir = join(parent, 'paper');
    mkdirSync(dir);
    writeFileSync(join(dir, 'main.tex'), '\\bibliography{../shared/refs}\n');
    const io = memIo(dir);
    const code = await main(['check', '--offline', '--checks', 'references', '--json'], io);
    expect(code).toBe(0);
    const report = JSON.parse(io.stdoutText()) as Report;
    const p = report.checks[0]?.problems[0];
    expect(p?.rule).toBe('bib-outside-project');
    expect(p?.message).toContain('../shared/refs.bib');
    expect(JSON.stringify(report)).not.toContain('Secret');
  });

  it('an explicit --bib outside is still refused', async () => {
    const parent = tempDir();
    const dir = join(parent, 'paper');
    mkdirSync(dir);
    writeFileSync(join(parent, 'x.bib'), '');
    const io = memIo(dir);
    expect(
      await main(['check', '--offline', '--checks', 'references', '--bib', '../x.bib'], io),
    ).toBe(2);
  });
});
