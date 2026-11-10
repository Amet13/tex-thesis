/** Windows paths in logs, \input file errors and overfull-box advice. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBib } from '../src/bib/index.js';
import { analyzeLog, parseLog } from '../src/log/index.js';
import { normalizePath } from '../src/log/paths.js';

const _fast = { arxivIntervalMs: 0, retryDelayMs: 0 };
const _atom = (body: string) =>
  new Response(body, { headers: { 'content-type': 'application/atom+xml' } });
const _one = (bib: string) => parseBib(bib)[0] as NonNullable<ReturnType<typeof parseBib>[0]>;

describe('R12: Windows paths in logs', () => {
  it('a C:\\…\\file.tex:12: line starts fresh (not glued to the previous line)', () => {
    const filler = 'x'.repeat(79);
    // An extension outside the known TeX list (knitr's .Rtex), so only STARTS_FRESH can tell.
    const log = `This is LuaHBTeX, Version 1.18.0\n${filler}\nC:\\Users\\me\\paper\\main.Rtex:12: Undefined control sequence.\nl.12 \\foo\n`;
    const parsed = parseLog(log);
    const err = parsed.errors[0];
    expect(err?.line).toBe(12);
    expect(err?.file).toBe('C:/Users/me/paper/main.Rtex');
    expect(err?.message).toContain('Undefined control sequence');
  });

  it('normalizePath compares drive letters case-insensitively', () => {
    expect(normalizePath('c:/Users/me/paper/sec/a.tex', 'C:\\Users\\me\\paper')).toBe('sec/a.tex');
    expect(normalizePath('C:\\Users\\me\\paper\\a.tex', 'c:/Users/me/paper/')).toBe('a.tex');
  });
});

describe('A11: an error in an \\input file followed by `)`', () => {
  it('one `_` in related.tex is one problem, not a second root in main.tex (real LuaLaTeX log)', () => {
    const log = readFileSync(
      new URL('./fixtures/input-underscore/main.log', import.meta.url),
      'utf8',
    );
    const { build } = analyzeLog(log, { root: '/work' });
    expect(build.problems.map((p) => [p.rule, p.location?.file, p.location?.line])).toEqual([
      ['missing-dollar', 'related.tex', 4],
    ]);
    expect(build.problems[0]?.related).toBe(1);
  });

  it('an overfull box "at lines 13--1" points at the end line in the current file', () => {
    const log = [
      'This is LuaHBTeX, Version 1.18.0',
      '(./main.tex',
      '(./related.tex)',
      'Overfull \\hbox (25.0pt too wide) in paragraph at lines 13--1',
      '[]\\TU/lmr/m/n/10 text',
      '',
      ')',
    ].join('\n');
    const { output } = analyzeLog(log);
    const box = output.problems.find((p) => p.rule === 'overfull-box');
    expect(box?.location).toMatchObject({ file: 'main.tex', line: 1 });
  });
});

describe('A7: overfull-box advice', () => {
  it('does not suggest \\sloppy', () => {
    const log = [
      'This is LuaHBTeX, Version 1.18.0',
      '(./main.tex',
      'Overfull \\hbox (25.0pt too wide) in paragraph at lines 3--4',
      '[]\\TU/lmr/m/n/10 text',
      '',
      ')',
    ].join('\n');
    const box = analyzeLog(log).output.problems.find((p) => p.rule === 'overfull-box');
    expect(box?.fix).toBeDefined();
    expect(box?.fix).not.toMatch(/sloppy/);
    expect(box?.fix).toMatch(/microtype/);
  });
});
