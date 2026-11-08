import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Report } from '@overfull/core';
import { describe, expect, it } from 'vitest';
import { parseRange } from '../src/commands/pages.js';
import { UsageError } from '../src/io.js';
import { main } from '../src/main.js';
import { memIo, tempCopy, tempDir } from './helpers.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

describe('global flags', () => {
  it('prints help and version', async () => {
    const io = memIo(tempDir());
    expect(await main([], io)).toBe(0);
    expect(io.stdoutText()).toContain('Usage: overfull <command>');
    const v = memIo(tempDir());
    expect(await main(['--version'], v)).toBe(0);
    expect(v.stdoutText()).toBe(`${pkg.version}\n`);
  });

  it.each(['init', 'build', 'check', 'cite', 'pages', 'diff', 'explain', 'doctor'])(
    '%s supports --help and --version',
    async (cmd) => {
      const io = memIo(tempDir());
      expect(await main([cmd, '--help'], io)).toBe(0);
      expect(io.stdoutText()).toMatch(new RegExp(`^Usage: overfull ${cmd}`));
      const v = memIo(tempDir());
      expect(await main([cmd, '--version'], v)).toBe(0);
      expect(v.stdoutText()).toBe(`${pkg.version}\n`);
    },
  );

  it('suggests a command for typos and exits 2', async () => {
    const io = memIo(tempDir());
    expect(await main(['chekc'], io)).toBe(2);
    expect(io.stderrText()).toContain('Did you mean `overfull check`?');
  });

  it('exits 2 on unknown flags', async () => {
    const io = memIo(tempDir());
    expect(await main(['check', '--jsn'], io)).toBe(2);
    expect(io.stderrText()).toMatch(/Unknown option '--jsn'.*\n.*overfull check --help/);
  });
});

describe('overfull check', () => {
  const run = async (args: string[]) => {
    const dir = tempCopy('project');
    const io = memIo(dir);
    const code = await main(['check', '--offline', '--no-verapdf', ...args], io);
    return { code, io, dir };
  };

  it('prints a stable JSON report and exits 1 on errors', async () => {
    const { code, io } = await run(['--json']);
    expect(code).toBe(1);
    const report = JSON.parse(io.stdoutText()) as Report;
    expect(Object.keys(report)).toEqual(['tool', 'version', 'target', 'status', 'checks']);
    expect(report).toMatchObject({ tool: 'overfull', target: 'thesis.pdf', status: 'fail' });
    expect(report.checks.map((c) => c.check)).toEqual([
      'build',
      'output',
      'references',
      'accessibility',
      'venue',
    ]);
    const problems = report.checks.flatMap((c) => c.problems);
    const rules = problems.map((p) => p.rule);
    expect(rules).toContain('citation-key-missing');
    expect(rules).toContain('figure-missing-alt');
    expect(rules).toContain('page-limit-exceeded');
    expect(problems.find((p) => p.rule === 'page-limit-exceeded')?.message).toBe(
      'Main text ends on page 2, limit is 1',
    );
    for (const p of problems) {
      expect(typeof p.message).toBe('string');
      expect(p.rule).toMatch(/^[a-z0-9-]+$/);
      expect(['error', 'warning', 'info']).toContain(p.severity);
    }
    const output = report.checks.find((c) => c.check === 'output');
    expect(output?.status).toBe('fail');
  });

  it('honours --checks and --fail-on never', async () => {
    const { code, io } = await run(['--json', '--checks', 'references', '--fail-on', 'never']);
    expect(code).toBe(0);
    const report = JSON.parse(io.stdoutText()) as Report;
    expect(report.checks.map((c) => c.check)).toEqual(['references']);
    expect(report.checks[0]?.problems.map((p) => p.data?.key)).toContain('ghost2020');
  });

  it('prints a human report by default', async () => {
    const { io } = await run([]);
    const text = io.stdoutText();
    expect(text).toMatch(/^overfull thesis\.pdf {2}FAIL\n/);
    expect(text).toMatch(/\d+ to fix · \d+ to review/);
    expect(text).not.toContain('\u001b[');
  });

  it('prints Markdown and annotations', async () => {
    const md = await run(['--markdown']);
    expect(md.io.stdoutText()).toContain('| Check | Status | Summary |');
    const an = await run(['--annotations']);
    expect(an.io.stdoutText().split('\n')[0]).toMatch(/^::error /);
  });

  it('skips checks whose inputs are missing, with a reason', async () => {
    const dir = tempDir();
    const io = memIo(dir);
    const code = await main(
      ['check', '--json', '--offline', '--checks', 'build,accessibility'],
      io,
    );
    expect(code).toBe(0);
    const report = JSON.parse(io.stdoutText()) as Report;
    expect(report.checks.map((c) => [c.check, c.status, c.skippedReason])).toEqual([
      ['build', 'skipped', 'No main.log — run `overfull build` first'],
      ['accessibility', 'skipped', 'No main.pdf — run `overfull build` first'],
    ]);
  });

  it('rejects bad option values with exit 2', async () => {
    expect((await run(['--fail-on', 'sometimes'])).code).toBe(2);
    expect((await run(['--checks', 'spelling'])).code).toBe(2);
    expect((await run(['--json', '--markdown'])).code).toBe(2);
    const p = await run(['--profile', 'neurips']);
    expect(p.code).toBe(2);
    expect(p.io.stderrText()).toContain('Built-in profiles');
  });

  it('applies --profile over the config', async () => {
    const { io } = await run(['--json', '--profile', 'generic', '--checks', 'accessibility']);
    const report = JSON.parse(io.stdoutText()) as Report;
    // generic: accessibility recommended → warnings, not errors
    expect(report.checks[0]?.problems.every((p) => p.severity !== 'error')).toBe(true);
  });

  it('works on a project path given through --config', async () => {
    const dir = tempCopy('project');
    const io = memIo(tempDir());
    await main(
      ['check', '--offline', '--json', '--checks', 'venue', '--config', join(dir, 'overfull.yml')],
      io,
    );
    expect((JSON.parse(io.stdoutText()) as Report).target).toBe('thesis.pdf');
  });
});

describe('parseRange', () => {
  it.each([
    ['3', [3]],
    ['2-5', [2, 3, 4, 5]],
    ['1,4,7', [1, 4, 7]],
    ['5, 1-2, 2', [1, 2, 5]],
    ['8-', [8, 9, 10]],
  ])('parses %s', (spec, pages) => {
    expect(parseRange(spec, 10)).toEqual(pages);
  });

  it.each(['0', '5-2', 'a', '-', '', '11'])('rejects %j', (spec) => {
    expect(() => parseRange(spec, 10)).toThrow(UsageError);
  });

  it('names the page count when out of range', () => {
    expect(() => parseRange('12', 10)).toThrow('Page 12 does not exist: the PDF has 10 pages');
  });
});

describe('overfull explain', () => {
  it('explains a rule', async () => {
    const io = memIo(tempDir());
    expect(await main(['explain', 'pdf-not-tagged'], io)).toBe(0);
    expect(io.stdoutText()).toMatch(
      /^pdf-not-tagged {2}accessibility · error\nPDF is not tagged\n/,
    );
    expect(io.stdoutText()).toContain('Fix: ');
  });

  it('prints JSON and lists rules', async () => {
    const io = memIo(tempDir());
    await main(['explain', 'page-limit-exceeded', '--json'], io);
    expect(JSON.parse(io.stdoutText())).toMatchObject({
      id: 'page-limit-exceeded',
      check: 'venue',
    });
    const list = memIo(tempDir());
    await main(['explain', '--list'], list);
    expect(list.stdoutText()).toContain('arxiv-absolute-path');
  });

  it('suggests close matches for unknown rules', async () => {
    const io = memIo(tempDir());
    expect(await main(['explain', 'pdf-not-taged'], io)).toBe(2);
    expect(io.stderrText()).toContain('Did you mean:\n  pdf-not-tagged');
  });
});

describe('overfull pages', () => {
  it('renders PNGs and prints their paths', async () => {
    const dir = tempCopy('project');
    const io = memIo(dir);
    const code = await main(['pages', '1-2', '--dpi', '30'], io);
    if (code === 2 && io.stderrText().includes('pdftoppm not found')) return; // no poppler, no Docker
    expect(code).toBe(0);
    expect(io.stdoutText()).toBe('.overfull/pages/page-1.png\n.overfull/pages/page-2.png\n');
    expect(readFileSync(join(dir, '.overfull/pages/page-1.png')).subarray(1, 4).toString()).toBe(
      'PNG',
    );
  });

  it('rejects pages beyond the end', async () => {
    const io = memIo(tempCopy('project'));
    expect(await main(['pages', '9'], io)).toBe(2);
    expect(io.stderrText()).toContain('the PDF has 2 pages');
  });
});
