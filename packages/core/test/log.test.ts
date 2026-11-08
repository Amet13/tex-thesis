import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeLog, logRules } from '../src/log/index.js';

const CORPUS = fileURLToPath(new URL('../../../corpus', import.meta.url));

interface CaseSpec {
  title: string;
  engine: 'lualatex' | 'pdflatex' | 'xelatex';
  check: 'build' | 'output';
  expect: string[];
  run?: 'once' | 'latexmk';
  flags?: string[];
}

const cases = readdirSync(CORPUS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

function load(id: string) {
  const spec = JSON.parse(readFileSync(join(CORPUS, id, 'case.json'), 'utf8')) as CaseSpec;
  const log = readFileSync(join(CORPUS, id, 'main.log'), 'utf8');
  return { spec, log, analysis: analyzeLog(log, { root: '/w' }) };
}

describe('corpus', () => {
  it('has at least 35 cases, each with a captured log', () => {
    expect(cases.length).toBeGreaterThanOrEqual(35);
    for (const id of cases) expect(existsSync(join(CORPUS, id, 'main.log')), id).toBe(true);
  });

  it('has fixed.tex for at least 15 cases', () => {
    expect(
      cases.filter((id) => existsSync(join(CORPUS, id, 'fixed.tex'))).length,
    ).toBeGreaterThanOrEqual(15);
  });

  it.each(cases)('%s fires exactly the expected rules', (id) => {
    const { spec, analysis } = load(id);
    const fired = new Set(
      [...analysis.build.problems, ...analysis.output.problems].map((p) => p.rule),
    );
    expect([...fired].sort()).toEqual([...spec.expect].sort());
    const primary = spec.expect[0];
    if (primary) expect(analysis[spec.check].problems.map((p) => p.rule)).toContain(primary);
    expect(analysis.parsed.engine).toMatch(/TeX Live 2026/);
  });

  it.each(cases)('%s reports project-relative locations and complete problems', (id) => {
    const { analysis } = load(id);
    for (const problem of [...analysis.build.problems, ...analysis.output.problems]) {
      expect(problem.message.length).toBeGreaterThan(10);
      expect(problem.fix, problem.rule).toBeTruthy();
      const file = problem.location?.file;
      if (file) {
        expect(file).not.toMatch(/^\.\/|^\/|\\/);
        expect(file).not.toMatch(/\.(sty|cls|aux)$/);
      }
    }
  });

  it('the clean document yields no problems in either check', () => {
    const { analysis } = load('clean-document');
    expect(analysis.build.problems).toEqual([]);
    expect(analysis.output.problems).toEqual([]);
    expect(analysis.build.status).toBe('pass');
    expect(analysis.output.status).toBe('pass');
    expect(analysis.parsed.outputFile).toMatchObject({ name: 'main.pdf', pages: 1 });
  });

  it('attributes errors to the chapter files they occur in', () => {
    const { analysis } = load('multi-file-chapters');
    const where = analysis.build.problems.map((p) => [p.rule, p.location?.file, p.location?.line]);
    expect(where).toEqual([
      ['undefined-control-sequence', 'chapters/introduction.tex', 7],
      ['missing-dollar', 'chapters/methods.tex', 4],
    ]);
    expect(analysis.parsed.files).toContain(
      'chapters/part-one-foundations/background-and-related-work-on-preflight-checks.tex',
    );
  });

  it('reads -file-line-error logs', () => {
    const { analysis } = load('file-line-error-style');
    const first = analysis.build.problems[0];
    expect(first?.location).toEqual({ file: 'chapters/results.tex', line: 4 });
    expect(first?.message).toContain('siunitx');
  });

  it('gives root-cause advice for common errors', () => {
    const fix = (id: string) => load(id).analysis.build.problems[0]?.fix ?? '';
    const message = (id: string) => load(id).analysis.build.problems[0]?.message ?? '';
    expect(fix('underscore-in-text')).toContain('`output\\_file.csv`');
    expect(fix('natbib-cite-under-biblatex')).toContain('\\parencite');
    expect(fix('mathbb-without-amssymb')).toContain('\\usepackage{amssymb}');
    expect(message('undefined-control-sequence')).toContain('`\\textbf`');
    expect(fix('missing-package')).toContain('tlmgr install fancyplots');
    expect(fix('ampersand-in-text')).toContain('Research \\& Development');
    expect(fix('caret-in-text')).toContain('$x^2$');
    expect(fix('double-subscript')).toContain('w_{ij}');
    expect(fix('inputenc-unicode')).toContain('LuaLaTeX');
    expect(fix('tikz-unknown-key')).toContain('color=red');
    expect(fix('option-clash')).toContain('\\usepackage[numbers]{natbib}');
    expect(fix('usepackage-after-begin-document')).toContain('\\usepackage{booktabs}');
    expect(message('graphics-path-backslash')).toContain('C:\\Users\\ana\\thesis\\plot.png');
    expect(message('unclosed-brace')).toContain('\\textbf{statistically significant');
  });

  it('folds a stale bibliography into one problem', () => {
    const { analysis } = load('biblatex-rerun-biber');
    expect(analysis.output.problems).toHaveLength(1);
    expect(analysis.output.problems[0]).toMatchObject({ rule: 'bibliography-missing', related: 1 });
    expect(analysis.parsed.rerunNeeded.biber).toBe(true);
  });
});

describe('logRules', () => {
  it('has unique ids and documents every rule the corpus fires', () => {
    const ids = logRules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of cases) {
      for (const rule of load(id).spec.expect) expect(ids, `${id}: ${rule}`).toContain(rule);
    }
  });

  it('points only at existing corpus cases that fire the rule', () => {
    for (const rule of logRules) {
      if (!rule.corpus) continue;
      expect(cases, rule.id).toContain(rule.corpus);
      expect(load(rule.corpus).spec.expect, rule.id).toContain(rule.id);
    }
  });
});
