/**
 * End-to-end: builds a tiny project with `overfull build` (Docker) and checks it.
 * Run with OVERFULL_E2E=1 (uses $OVERFULL_IMAGE, e.g. overfull-tex:dev).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Report } from '@overfull/core';
import { describe, expect, it } from 'vitest';
import { main } from '../src/main.js';
import { memIo, tempDir } from './helpers.js';

describe.skipIf(process.env.OVERFULL_E2E !== '1')('e2e: build then check in Docker', () => {
  it('builds a tagged document and checks it', { timeout: 600000 }, async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, 'main.tex'),
      [
        '\\DocumentMetadata{lang=en-US, pdfversion=2.0, pdfstandard=ua-2, tagging=on}',
        '\\documentclass{article}',
        '\\usepackage{hyperref}',
        '\\hypersetup{pdftitle={E2E}, pdfdisplaydoctitle=true}',
        '\\begin{document}',
        '\\section{Hello}\\label{sec:a}',
        'See Section~\\ref{sec:a} and Figure~\\ref{fig:none}.',
        '\\end{document}',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'overfull.yml'),
      'main: main.tex\nprofile: thesis\nbuild:\n  engine: docker\n',
    );
    const env = { OVERFULL_IMAGE: process.env.OVERFULL_IMAGE ?? 'overfull-tex:dev' };
    const build = memIo(dir, env);
    expect(await main(['build'], build), build.stderrText()).toBe(0);
    expect(build.stdoutText()).toMatch(/^overfull main\.pdf/);
    const check = memIo(dir, env);
    expect(await main(['check', '--json', '--offline', '--no-verapdf'], check)).toBe(1);
    const report = JSON.parse(check.stdoutText()) as Report;
    const output = report.checks.find((c) => c.check === 'output');
    expect(output?.status).toBe('fail');
    expect(report.checks.find((c) => c.check === 'accessibility')?.status).not.toBe('fail');
  });
});
