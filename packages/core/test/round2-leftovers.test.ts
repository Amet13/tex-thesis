import { describe, expect, it } from 'vitest';
import { escapeTex } from '../src/refs/entry.js';
import { resolveProfile, venueCheck } from '../src/venue/index.js';

describe('escapeTex', () => {
  it('escapes every LaTeX special in plain index text', () => {
    expect(escapeTex('A {fast} 50% & #1 a_b ^ ~ \\ c$')).toBe(
      'A \\{fast\\} 50\\% \\& \\#1 a\\_b \\^{} \\~{} \\textbackslash{} c\\$',
    );
  });
});

describe('arXiv EPS figures', () => {
  it('are flagged even when the local build used LuaLaTeX', () => {
    const r = venueCheck(resolveProfile('arxiv'), {
      log: 'This is LuaHBTeX, Version 1.24.0 (TeX Live 2026)\n',
      texFiles: [{ path: 'main.tex', content: '\\includegraphics{figures/plot.eps}\n' }],
    });
    expect(r.problems.map((p) => p.rule)).toContain('arxiv-eps-pdflatex');
  });
});
