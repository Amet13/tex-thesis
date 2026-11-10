/** Errors and output are neutralized in GitHub Actions. */
import { execFileSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Report } from '@overfull/core';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../src/main.js';
import { neutralizingWriter, stopCommands } from '../src/safety.js';
import { memIo, tempCopy, tempDir } from './helpers.js';

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
function hasCommand(text: string): boolean {
  return text
    .split(/[\r\n]/)
    .some((l) => /^(::|##\[)/.test(l.replace(/^[\s\u0085\u00a0\ufeff\f\v]+/, '')));
}

/** Every line that is a workflow command, other than stop-commands markers. */
function commandsIn(text: string): string[] {
  return text
    .split(/[\r\n]/)
    .map((l) => l.replace(/^[\s\u0085\u00a0\ufeff\f\v]+/, ''))
    .filter((l) => /^(::|##\[)/.test(l))
    .filter((l) => !/^::(stop-commands::overfull-[0-9a-f]{32}|overfull-[0-9a-f]{32}::)$/.test(l));
}

// --- R3/R4: workflow commands --------------------------------------------------

describe('R3: errors are neutralized in GitHub Actions, also with --annotations', () => {
  it('a UsageError carrying a command stays inert on stderr with --annotations', async () => {
    const dir = tempCopy('project');
    const io = memIo(dir, { GITHUB_ACTIONS: 'true' });
    const code = await main(['check', '--annotations', '--profile', 'x\n::error::pwned'], io);
    expect(code).toBe(2);
    expect(io.stderrText()).toContain('pwned');
    expect(hasCommand(io.stderrText())).toBe(false);
  });

  it('error messages lose control characters outside CI too', async () => {
    const io = memIo(tempCopy('project'));
    await main(['check', '--profile', 'x\u001b[31m\u202eevil'], io);
    expect(io.stderrText()).not.toContain('\u001b');
    expect(io.stderrText()).not.toContain('\u202e');
  });

  it('plain output runs inside stop-commands, with no other command line', async () => {
    const io = memIo(tempDir(), { GITHUB_ACTIONS: 'true' });
    await main(['explain', '\u3000::error::pwned'], io);
    const err = io.stderrText();
    expect(err).toMatch(/^::stop-commands::overfull-[0-9a-f]{32}\n/);
    const token = /stop-commands::(overfull-[0-9a-f]{32})/.exec(err)?.[1];
    expect(err.endsWith(`::${token}::\n`)).toBe(true);
    expect(commandsIn(err + io.stdoutText())).toEqual([]);
  });

  it('--annotations still prints annotations and no stop-commands', async () => {
    const io = memIo(tempCopy('project'), { GITHUB_ACTIONS: 'true' });
    await main(['check', '--annotations', '--offline', '--no-verapdf', '--checks', 'output'], io);
    expect(io.stdoutText()).toMatch(/^::(error|warning|notice) /m);
    expect(io.stderrText()).not.toContain('stop-commands');
  });

  it('stop-commands tokens are random', () => {
    expect(stopCommands().start).not.toBe(stopCommands().start);
  });
});

describe('R4: neutralizingWriter', () => {
  const collect = (chunks: string[]) => {
    const parts: string[] = [];
    const w = neutralizingWriter((s) => parts.push(s));
    for (const c of chunks) w(c);
    return parts.join('');
  };

  it('a CR inside a line that already started starts a new (neutralized) line', () => {
    const out = collect(['progress', ' 50%\r::error::x\n']);
    expect(hasCommand(out)).toBe(false);
    expect(out).toBe('progress 50%\r\u200b::error::x\n');
  });

  it('CR split across chunks and Unicode whitespace before the marker', () => {
    const out = collect(['ok\r', '\u00a0', ':', ':warning::a\n', '\ufeff##', '[group]g\n']);
    expect(hasCommand(out)).toBe(false);
    expect(out.replace(/\u200b/g, '')).toBe('ok\r\u00a0::warning::a\n\ufeff##[group]g\n');
  });

  it('every chunk after the first is processed, not passed raw', () => {
    const out = collect(['line one ', 'still one\n', '\u2003::set-env name=A::1\n']);
    expect(hasCommand(out)).toBe(false);
  });
});
