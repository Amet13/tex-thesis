import { describe, expect, it } from 'vitest';
import { resolveProfile, venueCheck } from '../src/venue/index.js';

describe('arXiv EPS figures', () => {
  it('are flagged even when the local build used LuaLaTeX', () => {
    const r = venueCheck(resolveProfile('arxiv'), {
      log: 'This is LuaHBTeX, Version 1.24.0 (TeX Live 2026)\n',
      texFiles: [{ path: 'main.tex', content: '\\includegraphics{figures/plot.eps}\n' }],
    });
    expect(r.problems.map((p) => p.rule)).toContain('arxiv-eps-pdflatex');
  });
});
