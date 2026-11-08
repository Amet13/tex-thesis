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
      message: 'Main text ends on page 10, limit is 9',
      data: { pages: 10, max: 9 },
    });
  });

  it('passes when the label is within the limit', () => {
    const p = resolveProfile({ pageLimit: { max: 10, endLabel: 'overfull:main-end' } });
    expect(venueCheck(p, { facts: facts(14), aux }).status).toBe('pass');
  });

  it('falls back to total pages when the label is missing', () => {
    const r = venueCheck(profile, { facts: facts(12), aux: '\\relax' });
    expect(rules(r)).toEqual(['page-limit-label-missing', 'page-limit-exceeded']);
    expect(r.problems[1]?.message).toBe('PDF has 12 pages, limit is 9');
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
        tex('\\author{Anonymous Authors}\n\\section{AI use statement}'),
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
    expect(venueCheck(p, { texFiles: [tex(heading)] }).status).toBe('pass');
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
      log: 'This is LuaHBTeX',
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
