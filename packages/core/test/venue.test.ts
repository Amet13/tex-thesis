import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PdfFacts } from '../src/pdf/index.js';
import {
  builtinProfiles,
  detectEngine,
  parseAuxLabels,
  resolveProfile,
  type TexFile,
  venueCheck,
  venueRules,
} from '../src/venue/index.js';

const aux = readFileSync(new URL('./fixtures/venue/paper.aux', import.meta.url), 'utf8');

function facts(pageCount: number, extra: Partial<PdfFacts> = {}): PdfFacts {
  return {
    pageCount,
    pages: Array.from({ length: pageCount }, (_, i) => ({
      number: i + 1,
      text: '',
      widthMm: 210,
      heightMm: 297,
    })),
    info: {},
    xmp: {},
    tagged: true,
    hasStructTree: true,
    figures: [],
    ...extra,
  };
}

const tex = (content: string, path = 'main.tex'): TexFile => ({ path, content });
const rules = (r: ReturnType<typeof venueCheck>) => r.problems.map((p) => p.rule);

describe('parseAuxLabels', () => {
  it('reads hyperref five-field labels and skips biblatex noise', () => {
    const labels = parseAuxLabels(aux);
    expect(labels.get('sec:intro')).toEqual({ ref: '1', page: '1' });
    expect(labels.get('fig:arch')).toEqual({ ref: '1', page: '3' });
    expect(labels.get('eq:main')).toEqual({ ref: '2.1', page: '4' });
    expect(labels.get('overfull:main-end')?.page).toBe('10');
    expect(labels.get('front:abstract')).toEqual({ ref: '', page: 'iii' });
    expect(labels.size).toBe(6);
  });

  it('reads the plain two-field form', () => {
    expect(parseAuxLabels('\\newlabel{a}{{3}{7}}').get('a')).toEqual({ ref: '3', page: '7' });
  });
});

describe('resolveProfile', () => {
  it('returns built-ins by name', () => {
    expect(resolveProfile('thesis').accessibility).toBe('required');
    expect(resolveProfile('double-blind').anonymous).toBe(true);
    expect(resolveProfile('arxiv').arxiv).toBe(true);
    expect(Object.keys(builtinProfiles).sort()).toEqual([
      'arxiv',
      'double-blind',
      'generic',
      'paper',
      'thesis',
    ]);
  });

  it('merges inline fields over the base profile', () => {
    const p = resolveProfile({ extends: 'paper', pageLimit: { max: 9 }, anonymous: true });
    expect(p).toMatchObject({
      id: 'paper',
      disclosure: 'recommended',
      anonymous: true,
      pageLimit: { max: 9 },
    });
    expect(builtinProfiles.paper?.anonymous).toBeUndefined();
  });

  it('throws a helpful error for unknown names', () => {
    expect(() => resolveProfile('neurips')).toThrow(/Built-in profiles: generic, thesis/);
  });
});

describe('page limit', () => {
  const profile = resolveProfile({ pageLimit: { max: 9, endLabel: 'overfull:main-end' } });

  it('counts pages up to the end label', () => {
    const r = venueCheck(profile, { facts: facts(14), aux });
    expect(r.status).toBe('fail');
    expect(r.problems[0]).toMatchObject({
      rule: 'page-limit-exceeded',
      message: 'Main text 10 of 9 pages (14 total): the main text ends on page 10',
      data: { pages: 10, max: 9 },
    });
  });

  it('passes when the label is within the limit', () => {
    const p = resolveProfile({ pageLimit: { max: 10, endLabel: 'overfull:main-end' } });
    const r = venueCheck(p, { facts: facts(14), aux });
    expect(r.status).toBe('pass');
    expect(r.summary).toContain('main text 10 of 10 pages (14 total)');
  });

  it('warns about main-text floats that landed after the end label', () => {
    const floatAux = [
      '\\newlabel{fig:arch}{{1}{1}{Overview}{figure.1}{}}',
      '\\newlabel{overfull:main-end}{{5}{2}{Conclusion}{section*.9}{}}',
      '\\newlabel{fig:latency}{{2}{3}{Latency}{figure.2}{}}',
      '\\newlabel{tab:results}{{1}{3}{Results}{table.1}{}}',
      '\\newlabel{app:proofs}{{A}{4}{Proofs}{appendix.A}{}}',
      '\\newlabel{fig:app-extra}{{3}{3}{Extra}{figure.3}{}}',
      '\\newlabel{fig:proof}{{A.1}{4}{Proof sketch}{figure.A.1}{}}',
      '\\newlabel{fig:late}{{4}{5}{After appendix start}{figure.4}{}}',
    ].join('\n');
    const p = resolveProfile({ pageLimit: { max: 9, endLabel: 'overfull:main-end' } });
    const r = venueCheck(p, { facts: facts(5), aux: floatAux });
    const floats = r.problems.filter((x) => x.rule === 'float-after-main-end');
    expect(floats.map((x) => x.data?.label)).toEqual(['fig:latency', 'tab:results']);
    expect(floats[0]).toMatchObject({ severity: 'warning', location: { page: 3 } });
    expect(floats[0]?.message).toBe(
      'Figure fig:latency floated to page 3, after the end of the main text (page 2); it may not count toward the page limit but reviewers will see it outside the main text',
    );
    expect(r.status).toBe('warn');
    expect(venueRules.some((x) => x.id === 'float-after-main-end')).toBe(true);
  });

  it('falls back to total pages when the label is missing', () => {
    const r = venueCheck(profile, { facts: facts(12), aux: '\\relax' });
    expect(rules(r)).toEqual(['page-limit-label-missing', 'page-limit-exceeded']);
    expect(r.problems[1]?.message).toBe('12 of 9 pages (all pages counted)');
    expect(r.summary).toContain('12 of 9 pages');
  });

  it('counts total pages without an end label', () => {
    const r = venueCheck(resolveProfile({ pageLimit: { max: 8 } }), { facts: facts(8) });
    expect(r.status).toBe('pass');
  });
});

describe('paper size', () => {
  it('warns on letter pages when A4 is expected', () => {
    const f = facts(2);
    for (const p of f.pages) Object.assign(p, { widthMm: 215.9, heightMm: 279.4 });
    const r = venueCheck(resolveProfile({ paper: 'a4' }), { facts: f });
    expect(r.problems[0]).toMatchObject({ rule: 'paper-size-mismatch', severity: 'warning' });
    expect(r.problems[0]?.message).toMatch(/US Letter.*expects A4.*2 pages differ/);
  });
});

describe('anonymity', () => {
  const profile = resolveProfile('double-blind');

  it('flags PDF author, \\author names, acknowledgments and self references', () => {
    const src = tex(
      [
        '\\author{Ada Lovelace \\and Charles Babbage}',
        '% \\author{Hidden In Comment}',
        'In our previous work [3] we showed it.',
        '\\section*{Acknowledgments}',
        '\\section{Use of AI tools}',
        'No generative AI tools were used in the research or the writing of this paper.',
      ].join('\n'),
    );
    const r = venueCheck(profile, {
      facts: facts(1, { info: { author: 'Ada Lovelace' } }),
      texFiles: [src],
    });
    expect(rules(r)).toEqual([
      'anonymity-pdf-author',
      'anonymity-author-named',
      'anonymity-acknowledgments',
      'anonymity-self-reference',
    ]);
    expect(r.problems[1]).toMatchObject({ location: { file: 'main.tex', line: 1 } });
    expect(r.problems[3]?.severity).toBe('info');
  });

  it('accepts Anonymous authors and macro-only \\author', () => {
    const r = venueCheck(profile, {
      facts: facts(1, { info: { author: 'Anonymous' } }),
      texFiles: [
        tex(
          '\\author{Anonymous Authors}\n\\section{AI use statement}\nNo generative AI tools were used in the research or the writing of this paper.',
        ),
        tex('\\author{\\metaAuthor}', 'b.tex'),
      ],
    });
    expect(r.status).toBe('pass');
  });
});

describe('disclosure', () => {
  it('is an error when required and missing', () => {
    const p = resolveProfile({ disclosure: 'required' });
    const r = venueCheck(p, { texFiles: [tex('\\section{Results}')] });
    expect(r.problems[0]).toMatchObject({ rule: 'disclosure-missing', severity: 'error' });
  });

  it.each([
    '\\section*{Use of Generative AI}',
    '\\section{LLM Usage Statement}',
    '\\paragraph{Declaration of AI assistance}',
    '\\subsection*{Statement}\\label{overfull:disclosure}',
  ])('accepts %s', (heading) => {
    const p = resolveProfile({ disclosure: 'required' });
    const statement = `${heading}\nNo generative AI tools were used in the research or the writing of this paper.`;
    expect(venueCheck(p, { texFiles: [tex(statement)] }).status).toBe('pass');
  });

  it('is only advice when recommended', () => {
    const r = venueCheck(resolveProfile('paper'), { texFiles: [tex('\\section{Results}')] });
    expect(r.problems[0]?.severity).toBe('info');
    expect(r.status).toBe('pass');
  });
});

describe('arXiv rules', () => {
  const profile = resolveProfile('arxiv');
  const pdflatexLog = 'This is pdfTeX, Version 3.141592653-2.6-1.40.29 (TeX Live 2026)\n';

  it('detects the engine from the log', () => {
    expect(detectEngine(pdflatexLog)).toBe('pdflatex');
    expect(detectEngine('This is LuaHBTeX, Version 1.24.0')).toBe('lualatex');
    expect(detectEngine('This is XeTeX, Version 3.141592653')).toBe('xelatex');
    expect(detectEngine(undefined)).toBeUndefined();
  });

  it('flags absolute paths, eps with pdflatex, minted, spaces and missing .bbl', () => {
    const src = tex(
      [
        '\\usepackage[cache=false]{minted}',
        '\\addbibresource{/home/me/refs.bib}',
        '\\includegraphics[width=3cm]{figures/plot.eps}',
        '\\input{C:\\Users\\me\\intro}',
        '\\includegraphics{figures/my plot.pdf}',
      ].join('\n'),
    );
    const r = venueCheck(profile, {
      texFiles: [src],
      log: pdflatexLog,
      main: 'main.tex',
      files: ['main.tex', 'figures/plot.eps', 'figures/my plot.pdf'],
    });
    expect(rules(r).sort()).toEqual(
      [
        'arxiv-absolute-path',
        'arxiv-absolute-path',
        'arxiv-eps-pdflatex',
        'arxiv-filename-space',
        'arxiv-filename-space',
        'arxiv-missing-bbl',
        'arxiv-shell-escape',
      ].sort(),
    );
    expect(r.status).toBe('fail');
  });

  it('is quiet for a clean project with a .bbl', () => {
    const r = venueCheck(profile, {
      texFiles: [tex('\\addbibresource{refs.bib}\n\\includegraphics{fig/a.pdf}')],
      log: pdflatexLog,
      main: 'main.tex',
      files: ['main.tex', 'main.bbl', 'fig/a.pdf'],
    });
    expect(r.problems).toEqual([]);
  });
});

describe('venueCheck', () => {
  it('is skipped without inputs', () => {
    expect(venueCheck(resolveProfile('generic'), {}).status).toBe('skipped');
  });

  it('documents every rule it can emit', () => {
    const ids = new Set(venueRules.map((r) => r.id));
    for (const id of [
      'page-limit-exceeded',
      'paper-size-mismatch',
      'disclosure-missing',
      'arxiv-missing-bbl',
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });
});

describe('arXiv engine and .bbl name', () => {
  const profile = resolveProfile('arxiv');
  const texFiles = [tex('\\addbibresource{refs.bib}')];
  it('flags a LuaLaTeX log as an error', () => {
    const r = venueCheck(profile, {
      texFiles,
      log: 'This is LuaHBTeX, Version 1.24.0 (TeX Live 2026)',
      main: 'main.tex',
      files: ['main.tex', 'main.bbl'],
    });
    const p = r.problems.find((x) => x.rule === 'arxiv-unsupported-engine');
    expect(p).toMatchObject({ severity: 'error' });
    expect(p?.fix).toContain('`latexmk -pdf`');
    expect(r.status).toBe('fail');
    expect(venueRules.some((x) => x.id === 'arxiv-unsupported-engine')).toBe(true);
  });

  it('requires <main>.bbl; a <jobname>.bbl must be renamed', () => {
    const run = (files: string[]) =>
      venueCheck(profile, {
        texFiles,
        log: 'This is pdfTeX, Version 3',
        main: 'main.tex',
        files,
      }).problems.filter((p) => p.rule === 'arxiv-missing-bbl');
    expect(run(['main.tex', 'main.bbl'])).toEqual([]);
    const [renamed] = run(['main.tex', 'thesis.bbl']);
    expect(renamed?.message).toBe(
      'Found thesis.bbl, but arXiv compiles main.tex and reads main.bbl; rename or copy it to main.bbl',
    );
    const [missing] = run(['main.tex']);
    expect(missing?.message).toMatch(/^No main\.bbl next to main\.tex/);
  });
});

describe('disclosure placeholder', () => {
  const file = (content: string) => ({ path: 'sections/ai.tex', content });
  it('flags placeholder text in a required disclosure as an error', () => {
    const r = venueCheck(resolveProfile({ extends: 'paper', disclosure: 'required' }), {
      texFiles: [
        file(
          '\\section*{Use of AI tools}\n\\textit{[Placeholder: describe the use of AI tools here.]}\n',
        ),
      ],
    });
    expect(r.problems.map((p) => [p.rule, p.severity])).toContainEqual([
      'disclosure-placeholder',
      'error',
    ]);
  });
  it('flags a nearly empty disclosure as a warning when recommended', () => {
    const r = venueCheck(resolveProfile('paper'), {
      texFiles: [file('\\section*{Use of Generative AI}\nTBD.\n\\section{Next}')],
    });
    expect(r.problems.map((p) => [p.rule, p.severity])).toContainEqual([
      'disclosure-placeholder',
      'warning',
    ]);
  });
  it('fix texts leave the "none were used" statement to the author', () => {
    const missing = venueCheck(resolveProfile({ disclosure: 'required' }), {
      texFiles: [tex('\\section{Results}')],
    }).problems[0];
    const placeholder = venueCheck(resolveProfile({ extends: 'paper', disclosure: 'required' }), {
      texFiles: [file('\\section*{Use of AI tools}\nTBD.\n')],
    }).problems.find((p) => p.rule === 'disclosure-placeholder');
    const rules = venueRules.filter((r) => r.id.startsWith('disclosure'));
    const texts = [missing?.fix, placeholder?.fix, ...rules.map((r) => r.fix)];
    expect(texts).toHaveLength(4);
    for (const t of texts) {
      expect(t).toContain('Only the author can say whether none were used.');
      expect(t).not.toMatch(/say so|state that no/i);
    }
  });

  it('accepts a written statement', () => {
    const r = venueCheck(resolveProfile({ extends: 'paper', disclosure: 'required' }), {
      texFiles: [
        file(
          '\\section*{Use of Generative AI}\nWe used a coding assistant to fix LaTeX build errors and to format tables. The authors wrote all text and checked every change.\n\\printbibliography',
        ),
      ],
    });
    expect(r.problems.filter((p) => p.rule.startsWith('disclosure'))).toEqual([]);
  });
});
