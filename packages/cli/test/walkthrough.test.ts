/** Regressions from the round-4 persona walkthroughs (CLI and Action side). */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatHuman, type Problem, type Report } from '@overfull/core';
import { afterEach, describe, expect, it } from 'vitest';
import { readInputs } from '../../../action/src/inputs.js';
import { mergeOutput, runCheck } from '../src/check.js';
import { loadConfig } from '../src/config.js';
import { main } from '../src/main.js';
import { memIo, tempCopy, tempDir } from './helpers.js';

/** Shell-script fakes on PATH do not exist on Windows. */
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

describe('explicit inputs that do not exist fail with exit 2', () => {
  it('--pdf names the path and the jobname from overfull.yml', async () => {
    const io = memIo(tempCopy('project'));
    expect(await main(['check', '--pdf', 'out/thesis.pdf'], io)).toBe(2);
    const err = io.stderrText();
    expect(err).toContain('PDF not found: out/thesis.pdf');
    expect(err).toContain('"thesis" (from overfull.yml)');
  });

  it('detects $jobname in .latexmkrc for the hint', async () => {
    const dir = tempCopy('project');
    rmSync(join(dir, 'overfull.yml'));
    writeFileSync(join(dir, '.latexmkrc'), "$jobname = 'paper';\n$pdf_mode = 4;\n");
    const config = loadConfig(dir);
    expect(config.jobname).toBe('paper');
    expect(config.jobnameSource).toBe('.latexmkrc');
    const io = memIo(dir);
    expect(await main(['check', '--log', 'thesis-typo.log'], io)).toBe(2);
    expect(io.stderrText()).toContain('Log file not found: thesis-typo.log');
    expect(io.stderrText()).toContain('"paper" (from .latexmkrc), so the build writes paper.log');
  });

  it('a missing --bib or --aux is an error, not a skip', async () => {
    const dir = tempCopy('project');
    const a = memIo(dir);
    expect(await main(['check', '--bib', 'nope.bib', '--offline'], a)).toBe(2);
    expect(a.stderrText()).toContain('Bibliography file not found: nope.bib');
    const b = memIo(dir);
    expect(await main(['check', '--aux', 'nope.aux', '--offline'], b)).toBe(2);
    expect(b.stderrText()).toContain('Aux file not found: nope.aux');
  });

  it('Action inputs: a missing log rejects (the Action exits 2)', async () => {
    const dir = tempCopy('project');
    const inputs = readInputs({ INPUT_LOG: 'build/thesis.log' }, dir);
    await expect(runCheck(inputs.check)).rejects.toThrow(/Log file not found: build\/thesis\.log/);
  });

  it('in CI, skip reasons do not say "run `overfull build` first"', async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, 'main.tex'),
      '\\documentclass{article}\\begin{document}x\\end{document}',
    );
    const report = await runCheck({
      cwd: dir,
      checks: ['build', 'accessibility'],
      env: { CI: 'true', PATH: '/nonexistent' },
    });
    for (const c of report.checks) {
      expect(c.skippedReason).not.toContain('overfull build');
      expect(c.skippedReason).toMatch(
        /build the document in an earlier workflow step, or set `pdf:`\/`log:`$/,
      );
    }
    const local = await runCheck({ cwd: dir, checks: ['build'], env: { PATH: '/nonexistent' } });
    expect(local.checks[0]?.skippedReason).toContain('run `overfull build` first');
  });
});

describe('output check summary', () => {
  it('reflects PDF problems merged into a clean log result', () => {
    const pdfProblem: Problem = {
      rule: 'pdf-unresolved-reference',
      check: 'output',
      severity: 'error',
      message: '"??" in the PDF',
      location: { page: 2 },
    };
    const merged = mergeOutput(
      { check: 'output', status: 'pass', problems: [], summary: 'No problems found in the output' },
      [pdfProblem],
    );
    expect(merged.status).toBe('fail');
    expect(merged.summary).not.toMatch(/No problems/);
    expect(merged.summary).toContain('pdf-unresolved-reference');
    const text = formatHuman({ tool: 'overfull', version: '0', status: 'fail', checks: [merged] });
    expect(text).not.toMatch(/No problems found/);
  });
});

describe('verapdf-not-run severity in the CLI and the Action', () => {
  it('Action: info, with advice to use the template workflow or install veraPDF', async () => {
    const dir = tempCopy('project');
    const inputs = readInputs({ INPUT_CHECKS: 'accessibility', PATH: '/nonexistent' }, dir);
    const report = await runCheck(inputs.check);
    const v = problems(report).find((p) => p.rule === 'verapdf-not-run');
    expect(v?.severity).toBe('info');
    expect(v?.fix).toBe(
      'Full PDF/UA validation needs veraPDF; run the template workflow (Docker) or install veraPDF on the runner',
    );
  });

  it.skipIf(POSIX_ONLY)('CLI with Docker available: a warning when required', async () => {
    const bin = fakeBin({
      docker: 'case "$1" in info) echo 27.0; exit 0;; esac\nexit 1',
    });
    process.env.PATH = `${bin}:/usr/bin:/bin`;
    const report = await runCheck({
      cwd: tempCopy('project'),
      checks: ['accessibility'],
      env: { PATH: process.env.PATH },
    });
    const v = problems(report).find((p) => p.rule === 'verapdf-not-run');
    expect(v?.severity).toBe('warning');
  });
});

describe('help and exit codes', () => {
  it('explain reference-unproven tells authors about author-provided', async () => {
    const io = memIo(tempDir());
    expect(await main(['explain', 'reference-unproven'], io)).toBe(0);
    expect(io.stdoutText()).toContain(
      'If you wrote this entry yourself, add `note = {overfull: author-provided}` to it.',
    );
  });

  it('cite --help lists every JSON field and the ambiguous / not-found shapes', async () => {
    const io = memIo(tempDir());
    expect(await main(['cite', '--help'], io)).toBe(0);
    const help = io.stdoutText();
    expect(help).toContain('{key, entry, source, confidence, added, bib}');
    expect(help).toContain('{ambiguous: true, message, candidates:');
    expect(help).toContain(
      '{found: false, query, searched, failures: [{source, reason}], message}',
    );
  });

  it('diff --help lists complete', async () => {
    const io = memIo(tempDir());
    expect(await main(['diff', '--help'], io)).toBe(0);
    expect(io.stdoutText()).toContain('{pdf, base, sha, complete}');
  });

  it.skipIf(POSIX_ONLY)('diff --json exits 1 when the diff PDF is incomplete', async () => {
    const bin = fakeBin({
      // latexdiff-vc ... -r <sha> <main.tex> → writes main-diff<sha>.tex
      'latexdiff-vc':
        'sha=""; while [ $# -gt 0 ]; do if [ "$1" = -r ]; then sha="$2"; fi; shift; done\necho x > "main-diff$sha.tex"',
      // latexmk with errors still writes a PDF (nonstopmode) and exits 12
      latexmk: 'mkdir -p .overfull/diff; echo pdf > .overfull/diff/overfull-diff.pdf; exit 12',
    });
    process.env.PATH = `${bin}:${savedPath}`;
    const dir = tempDir();
    const git = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: dir,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 't',
          GIT_AUTHOR_EMAIL: 't@example.org',
          GIT_COMMITTER_NAME: 't',
          GIT_COMMITTER_EMAIL: 't@example.org',
        },
      });
    git('init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'main.tex'), '1');
    git('add', '-A');
    git('commit', '-qm', 'one');
    writeFileSync(join(dir, 'main.tex'), '2');
    git('commit', '-qam', 'two');
    const io = memIo(dir, { PATH: process.env.PATH });
    expect(await main(['diff', '--engine', 'local', '--json'], io)).toBe(1);
    expect(JSON.parse(io.stdoutText())).toMatchObject({ complete: false });
    expect(existsSync(join(dir, 'overfull-diff.pdf'))).toBe(true);
    const plain = memIo(dir, { PATH: process.env.PATH });
    expect(await main(['diff', '--engine', 'local'], plain)).toBe(0);
  });
});
