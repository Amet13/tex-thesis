import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { main } from '../src/main.js';
import { memIo, tempDir } from './helpers.js';

const DOC = '\\documentclass{article}\n\\begin{document}Hi\\end{document}\n';

function project(files: Record<string, string>): string {
  const dir = tempDir();
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

describe('main file detection without config', () => {
  it('uses main.tex when present, even next to other documents', () => {
    const dir = project({ 'main.tex': DOC, 'other.tex': DOC });
    const c = loadConfig(dir);
    expect([c.main, c.mainSource]).toEqual(['main.tex', 'main.tex']);
  });

  it('uses the only file with a documentclass and derives the jobname', () => {
    const dir = project({ 'paper.tex': DOC, 'macros.tex': '\\newcommand{\\x}{y}\n' });
    const c = loadConfig(dir);
    expect([c.main, c.jobname, c.mainSource]).toEqual(['paper.tex', 'paper', 'detected']);
  });

  it('ignores a commented documentclass and files in subfolders', () => {
    const dir = project({
      'a.tex': `% \\documentclass{article}\n`,
      'sub/b.tex': DOC,
      'paper.tex': DOC,
    });
    expect(loadConfig(dir).main).toBe('paper.tex');
  });

  it('prefers the candidate that has a build log or pdf', () => {
    const dir = project({ 'a.tex': DOC, 'b.tex': DOC, 'b.log': 'x' });
    const c = loadConfig(dir);
    expect([c.main, c.mainSource]).toEqual(['b.tex', 'detected']);
  });

  it('check prints the main file and looks for its log', async () => {
    const dir = project({ 'paper.tex': DOC });
    const io = memIo(dir);
    const code = await main(['check', '--offline'], io);
    expect(code).toBe(0);
    expect(io.stdoutText()).toContain('overfull paper.tex');
    expect(io.stdoutText()).toContain('paper.log');
    expect(io.stderrText()).toContain('assuming main paper.tex');
    expect(io.stderrText()).toContain('overfull init --here');
  });

  it('two candidates exit 2 and name both', async () => {
    const dir = project({ 'a.tex': DOC, 'b.tex': DOC });
    const io = memIo(dir);
    const code = await main(['check', '--offline'], io);
    expect(code).toBe(2);
    expect(io.stderrText()).toContain('a.tex, b.tex');
    expect(io.stderrText()).toContain('--main a.tex');
  });

  it('--main resolves the ambiguity and sets the jobname', async () => {
    const dir = project({ 'a.tex': DOC, 'b.tex': DOC });
    const io = memIo(dir);
    const code = await main(['check', '--offline', '--main', 'b.tex'], io);
    expect(code).toBe(0);
    expect(io.stdoutText()).toContain('b.log');
  });

  it('--main with a missing file is a usage error', async () => {
    const io = memIo(project({ 'a.tex': DOC }));
    expect(await main(['check', '--main', 'nope.tex'], io)).toBe(2);
    expect(io.stderrText()).toContain('nope.tex');
  });

  it('accepts --main on pages and diff', async () => {
    const dir = project({ 'a.tex': DOC, 'b.tex': DOC });
    const io = memIo(dir);
    expect(await main(['pages', '1', '--main', 'b.tex'], io)).toBe(2);
    expect(io.stderrText()).toContain('b.pdf not found');
    const io2 = memIo(dir);
    expect(await main(['diff'], io2)).toBe(2);
    expect(io2.stderrText()).toContain('a.tex, b.tex');
  });

  it('adds `assumed` to the JSON report only without overfull.yml', async () => {
    const dir = project({ 'paper.tex': DOC });
    const io = memIo(dir);
    await main(['check', '--offline', '--json'], io);
    const report = JSON.parse(io.stdoutText());
    expect(report.assumed).toMatchObject({
      main: 'paper.tex',
      mainSource: 'detected',
      jobname: 'paper',
      profile: 'generic',
    });
    expect(io.stderrText()).toBe('');
    writeFileSync(join(dir, 'overfull.yml'), 'main: paper.tex\n');
    const io2 = memIo(dir);
    await main(['check', '--offline', '--json'], io2);
    expect(JSON.parse(io2.stdoutText()).assumed).toBeUndefined();
  });
});
