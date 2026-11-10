import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/main.js';
import { memIo, tempDir } from './helpers.js';

const BIB = '@article{k, title={A title}, author={Doe, Jane}, year={2020}, journal={J}}\n';

describe('check with file arguments', () => {
  it('a .bib argument runs the references check only', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'refs.bib'), BIB);
    const io = memIo(dir);
    const code = await main(['check', 'refs.bib', '--offline', '--json'], io);
    const report = JSON.parse(io.stdoutText());
    expect(report.checks.map((c: { check: string }) => c.check)).toEqual(['references']);
    expect(code).toBeLessThanOrEqual(1);
  });

  it('a missing .bib is a usage error', async () => {
    const io = memIo(tempDir());
    expect(await main(['check', 'nope.bib', '--offline'], io)).toBe(2);
  });

  it('an unknown extension exits 2', async () => {
    const io = memIo(tempDir());
    expect(await main(['check', 'foo.xyz'], io)).toBe(2);
    expect(io.stderrText()).toContain('foo.xyz');
  });

  it('.tex, .log map to main and --log', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'paper.tex'), '\\documentclass{article}\n');
    writeFileSync(join(dir, 'other.log'), 'This is pdfTeX\n');
    const io = memIo(dir);
    const code = await main(['check', 'paper.tex', 'other.log', '--offline', '--json'], io);
    const report = JSON.parse(io.stdoutText());
    expect(code).toBeLessThanOrEqual(1);
    expect(report.assumed.main).toBe('paper.tex');
    const build = report.checks.find((c: { check: string }) => c.check === 'build');
    expect(build.status).not.toBe('skipped');
  });

  it('two .tex arguments are a usage error', async () => {
    const io = memIo(tempDir());
    expect(await main(['check', 'a.tex', 'b.tex'], io)).toBe(2);
  });
});
