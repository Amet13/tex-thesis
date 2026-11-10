import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectProject, renderConfig, renderMakefile, renderWorkflow } from '../src/adopt.js';
import { loadConfig } from '../src/config.js';
import { main } from '../src/main.js';
import { agentKit } from '../src/templates.js';
import { memIo, tempCopy, tempDir } from './helpers.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

function tree(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tree(p, base));
    else out.push(p.slice(base.length + 1).split('\\').join('/'));
  }
  return out.sort();
}

describe('adopt: detection', () => {
  it('NeurIPS-style: article, local style file, pdfLaTeX, bibtex', () => {
    const d = detectProject(tempCopy('adopt/neurips-style'));
    expect(d).toMatchObject({
      main: 'main.tex',
      jobname: 'main',
      engine: 'pdflatex',
      bib: ['refs.bib'],
      backend: 'bibtex',
      documentClass: 'article',
      profile: 'generic',
    });
  });

  it('acmart with biblatex: biber and \\addbibresource', () => {
    const d = detectProject(tempCopy('adopt/acm-biblatex'));
    expect(d).toMatchObject({
      engine: 'pdflatex',
      bib: ['references.bib'],
      backend: 'biber',
      documentClass: 'acmart',
    });
  });

  it('thesis: report class with chapters, lualatex and jobname from .latexmkrc', () => {
    const d = detectProject(tempCopy('adopt/thesis'));
    expect(d).toMatchObject({
      main: 'thesis.tex',
      jobname: 'dissertation',
      engine: 'lualatex',
      engineFromLatexmkrc: true,
      bib: ['thesis-refs.bib'],
      backend: 'bibtex',
      profile: 'thesis',
    });
    expect(d.engineHow).toContain('.latexmkrc');
  });

  it('uses the venue data for a known style file', () => {
    const dir = tempCopy('adopt/neurips-style');
    const d = detectProject(dir, {
      styleLookup: (f) => (f === 'example_conf.sty' ? ['example-venue'] : []),
    });
    expect(d.profile).toBe('example-venue');
    expect(d.styleFiles).toEqual(['example_conf.sty']);
  });

  it('reads the engine from a % !TEX program line and from fontspec', () => {
    const a = tempDir();
    writeFileSync(
      join(a, 'main.tex'),
      '% !TEX program = xelatex\n\\documentclass{article}\\begin{document}x\\end{document}\n',
    );
    expect(detectProject(a)).toMatchObject({ engine: 'xelatex' });
    const b = tempDir();
    writeFileSync(
      join(b, 'main.tex'),
      '\\documentclass{article}\\usepackage{fontspec}\\begin{document}x\\end{document}\n',
    );
    expect(detectProject(b)).toMatchObject({ engine: 'lualatex' });
  });

  it('lists candidates and --main when several files have \\documentclass', async () => {
    const dir = tempDir();
    for (const n of ['a.tex', 'b.tex'])
      writeFileSync(join(dir, n), '\\documentclass{article}\\begin{document}\\end{document}\n');
    const io = memIo(dir);
    expect(await main(['init', '--here'], io)).toBe(2);
    expect(io.stderrText()).toContain('a.tex, b.tex');
    expect(io.stderrText()).toContain('--main');
    expect(readdirSync(dir).sort()).toEqual(['a.tex', 'b.tex']);
    const ok = memIo(dir);
    expect(await main(['init', '--here', '--main', 'b.tex'], ok)).toBe(0);
    expect(loadConfig(dir).main).toBe('b.tex');
  });
});

describe('adopt: generated files', () => {
  it.each(['neurips-style', 'acm-biblatex', 'thesis'])('overfull.yml loads back (%s)', (name) => {
    const dir = tempCopy(`adopt/${name}`);
    const d = detectProject(dir);
    writeFileSync(join(dir, 'overfull.yml'), renderConfig(d));
    const c = loadConfig(dir);
    expect(c.main).toBe(d.main);
    expect(c.jobname).toBe(d.jobname);
    expect(c.bib).toEqual(d.bib);
    expect(c.profile.id).toBe(d.profile);
    expect(c.references.requireCite).toBe(false);
    expect(c.mainSource).toBe('overfull.yml');
  });

  it('every setting line carries a comment on how it was found', () => {
    const yml = renderConfig(detectProject(tempCopy('adopt/neurips-style'))).split('\n');
    for (const key of ['main:', 'jobname:', 'bib:', 'profile:', 'checks:', 'requireCite:']) {
      const i = yml.findIndex((l) => l.trimStart().startsWith(key));
      expect(i, key).toBeGreaterThan(0);
      const here = yml[i] as string;
      const before = yml[i - 1] as string;
      expect(here.includes('#') || before.trimStart().startsWith('#'), key).toBe(true);
    }
  });

  it('CI workflow and Makefile use the detected engine, and no arXiv step for non-pdfLaTeX', () => {
    const lua = detectProject(tempCopy('adopt/thesis'));
    const wf = renderWorkflow(lua);
    expect(wf).toContain(
      'latexmk -interaction=nonstopmode -file-line-error -jobname=dissertation thesis.tex',
    );
    expect(wf).not.toContain('arXiv');
    expect(wf).toContain('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1');
    const pdf = detectProject(tempCopy('adopt/neurips-style'));
    expect(renderWorkflow(pdf)).toContain('latexmk -pdf -interaction');
    expect(renderMakefile(pdf)).toContain('LATEXMK_FLAGS ?= -pdf');
    expect(renderMakefile(pdf)).toMatch(/\n\t\$\(RUN_LATEXMK\) \$\(LATEXMK_FLAGS\)/);
  });

  it('the agent kit equals shared/agents and skills/ (one source, no drift)', () => {
    const kit = agentKit();
    expect(kit).toBeDefined();
    const byPath = new Map((kit ?? []).map((f) => [f.path, f.content]));
    const expected = new Map<string, Buffer>();
    for (const f of tree(join(repo, 'shared/agents')))
      expected.set(f, readFileSync(join(repo, 'shared/agents', f)));
    for (const skill of readdirSync(join(repo, 'skills'), { withFileTypes: true })) {
      if (!skill.isDirectory() || !existsSync(join(repo, 'skills', skill.name, 'SKILL.md')))
        continue;
      for (const f of tree(join(repo, 'skills', skill.name)))
        expected.set(
          `.agents/skills/${skill.name}/${f}`,
          readFileSync(join(repo, 'skills', skill.name, f)),
        );
    }
    expect([...byPath.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [p, c] of expected) expect(byPath.get(p)?.equals(c), p).toBe(true);
  });

  it('AGENTS.md does not assume the template layout', () => {
    const agents = readFileSync(join(repo, 'shared/agents/AGENTS.md'), 'utf8');
    expect(agents).toContain('Read `overfull.yml` for the main file');
    expect(agents).not.toMatch(/^\| `main\.tex` \|/m);
  });
});

describe('adopt: the project folder is checked before any write', () => {
  it('refuses to write through a symlink that leaves the project', async () => {
    const dir = tempCopy('adopt/neurips-style');
    const outside = tempDir();
    mkdirSync(join(dir, '.github'));
    const { symlinkSync } = await import('node:fs');
    symlinkSync(outside, join(dir, '.github', 'workflows'), 'dir');
    const io = memIo(dir);
    expect(await main(['init', '--here', '--all'], io)).toBe(2);
    expect(io.stderrText()).toMatch(/outside the project|leads outside/);
    expect(existsSync(join(dir, 'overfull.yml'))).toBe(false);
    expect(readdirSync(outside)).toEqual([]);
  });
});
