import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/main.js';
import { isTemplateFile, templatesDir } from '../src/templates.js';
import { memIo, tempDir } from './helpers.js';

describe('templates', () => {
  it('skips build outputs but keeps sources and figures', () => {
    expect(isTemplateFile('main.tex')).toBe(true);
    expect(isTemplateFile('figures/plot.pdf')).toBe(true);
    expect(isTemplateFile('.agents/skills/cite/SKILL.md')).toBe(true);
    for (const f of [
      'thesis.pdf',
      'thesis.aux',
      'thesis.log',
      'thesis.synctex.gz',
      'thesis.bcf-SAVE-ERROR',
      'thesis-luamml-mathml.html',
      '.overfull/cache/refs.json',
      'chapters/intro.aux',
    ]) {
      expect(isTemplateFile(f), f).toBe(false);
    }
  });
});

describe('overfull init', () => {
  const haveTemplates = Boolean(
    templatesDir() && existsSync(join(templatesDir() as string, 'thesis', 'main.tex')),
  );

  it.skipIf(!haveTemplates)('copies the thesis template and prints next steps', async () => {
    const cwd = tempDir();
    const io = memIo(cwd);
    expect(await main(['init', 'thesis', 'my-thesis'], io)).toBe(0);
    expect(existsSync(join(cwd, 'my-thesis', 'main.tex'))).toBe(true);
    expect(existsSync(join(cwd, 'my-thesis', 'thesis.log'))).toBe(false);
    expect(io.stdoutText()).toContain('cd my-thesis');
    expect(io.stdoutText()).toContain('With an AI agent');
    expect(io.stdoutText()).toContain('By hand');
  });

  it('refuses a non-empty directory without --force', async () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, 'x'));
    writeFileSync(join(cwd, 'x', 'notes.txt'), 'keep');
    const io = memIo(cwd);
    const code = await main(['init', 'paper', 'x'], io);
    expect(code).toBe(2);
    expect(io.stderrText()).toMatch(/x is not empty|not bundled/);
  });

  it('rejects unknown templates', async () => {
    const io = memIo(tempDir());
    expect(await main(['init', 'poster', 'dir'], io)).toBe(2);
    expect(io.stderrText()).toContain('Unknown template "poster"');
  });
});

describe('overfull doctor', () => {
  it('lists tools; exits 1 only when nothing can build', async () => {
    const io = memIo(tempDir());
    const code = await main(['doctor'], io);
    const text = io.stdoutText();
    expect(code).toBe(text.includes('Ready to build.') ? 0 : 1);
    if (code === 1) expect(text).toMatch(/^Cannot build/);
    for (const name of [
      'node',
      'latexmk',
      'docker',
      'pdftoppm',
      'verapdf',
      'latexdiff',
      'api.crossref.org',
      'overfull.yml',
    ]) {
      expect(text).toContain(name);
    }
    expect(text).toMatch(/api\.crossref\.org +unreachable/);
  });

  it('reports an invalid config without failing', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'overfull.yml'), 'mian: x.tex');
    const io = memIo(dir);
    const code = await main(['doctor', '--json'], io);
    const { items, canBuild } = JSON.parse(io.stdoutText()) as {
      canBuild: boolean;
      items: { name: string; ok: boolean; detail: string }[];
    };
    expect(code).toBe(canBuild ? 0 : 1);
    expect(items.find((i) => i.name === 'overfull.yml')).toMatchObject({ ok: false });
  });
});
