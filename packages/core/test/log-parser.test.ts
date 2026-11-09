import { describe, expect, it } from 'vitest';
import { analyzeLog, normalizePath, parseLog } from '../src/log/index.js';

const BANNER =
  'This is pdfTeX, Version 3.141592653-2.6-1.40.29 (TeX Live 2026) (preloaded format=pdflatex 2026.9.13)  8 NOV 2026 16:48';
const LUA_BANNER =
  'This is LuaHBTeX, Version 1.24.0 (TeX Live 2026)  (format=lualatex 2026.9.13)  8 NOV 2026 16:48';

const log = (...lines: string[]) => [BANNER, ...lines].join('\n');

/** Hard-wraps a line the way TeX does (79 characters). */
function wrap(line: string, width = 79): string[] {
  const out: string[] = [];
  for (let i = 0; i < line.length; i += width) out.push(line.slice(i, i + width));
  return out;
}

const undefinedCs = (cs: string, line: number, prefix = 'Text ') => [
  '! Undefined control sequence.',
  `l.${line} ${prefix}\\${cs}`,
  `${' '.repeat(`l.${line} ${prefix}\\${cs}`.length)}{x}`,
  'The control sequence at the end of the top line',
  "of your error message was never \\def'ed.",
  '',
];

const overfull = (pt: number, lines: string) => [
  `Overfull \\hbox (${pt}pt too wide) in paragraph at lines ${lines}`,
  '[]\\OT1/cmr/m/n/10 Some (unbalanced text in the box',
  '',
];

describe('parseLog basics', () => {
  it('reads the engine, format and output file', () => {
    const parsed = parseLog(
      log('(./main.tex', ')', 'Output written on main.pdf (12 pages, 345678 bytes).'),
    );
    expect(parsed.engine).toBe('pdfTeX 3.141592653-2.6-1.40.29 (TeX Live 2026)');
    expect(parsed.format).toBe('pdflatex');
    expect(parsed.outputFile).toEqual({ name: 'main.pdf', pages: 12, bytes: 345678 });
    expect(parseLog([LUA_BANNER].join('\n')).engine).toBe('LuaHBTeX 1.24.0 (TeX Live 2026)');
  });

  it('flags fatal runs and missing output', () => {
    const parsed = parseLog(
      log(
        '(./main.tex',
        '! Emergency stop.',
        '<*> main.tex',
        '            ',
        '*** (job aborted, no legal \\end found)',
        '',
        'No pages of output.',
      ),
    );
    expect(parsed.fatal).toBe(true);
    expect(parsed.noPages).toBe(true);
  });
});

describe('file stack', () => {
  it('handles several opens and closes on one line', () => {
    const parsed = parseLog(
      log(
        '(./main.tex (./a.tex) (./chapters/b.tex) (./chapters/c.tex',
        ...undefinedCs('foo', 3),
        '))',
      ),
    );
    expect(parsed.errors[0]?.file).toBe('chapters/c.tex');
    expect(parsed.files).toEqual(['main.tex', 'a.tex', 'chapters/b.tex', 'chapters/c.tex']);
  });

  it('returns to the parent file after a close', () => {
    const parsed = parseLog(
      log('(./main.tex (./chapters/a.tex [1] [2])', ...undefinedCs('foo', 9), ')'),
    );
    expect(parsed.errors[0]?.file).toBe('main.tex');
  });

  it('ignores parentheses that are not file names', () => {
    const parsed = parseLog(
      log(
        '(./main.tex (see the manual) (load luc: /tmp/font.luc)',
        '(./chapters/a.tex',
        ...overfull(20, '3--4'),
        'Package hyperref Warning: Token not allowed (oops',
        "(hyperref)                removing `math shift' on input line 2.",
        '',
        ...undefinedCs('foo', 5),
        ')',
        ...undefinedCs('bar', 8),
        ')',
      ),
    );
    expect(parsed.errors.map((e) => e.file)).toEqual(['chapters/a.tex', 'main.tex']);
  });

  it('does not let unbalanced parentheses in error context corrupt the stack', () => {
    const parsed = parseLog(
      log(
        '(./main.tex (./a.tex',
        ...undefinedCs('foo', 2, 'see (unbalanced '),
        ')',
        ...undefinedCs('bar', 4),
      ),
    );
    expect(parsed.errors.map((e) => e.file)).toEqual(['a.tex', 'main.tex']);
  });

  it('joins file names wrapped at 79 characters', () => {
    const path =
      './chapters/part-one/a-very-long-chapter-file-name-that-goes-past-the-print-width.tex';
    const parsed = parseLog(
      log('(./main.tex', ...wrap(`Some leading text (${path}`), ...undefinedCs('foo', 4), ')', ')'),
    );
    expect(parsed.errors[0]?.file).toBe(path.slice(2));
  });

  it('does not join a full-width line with a message that starts a fresh line', () => {
    const path = '(/usr/local/texlive/2026/texmf-dist/tex/latex/rerunfilecheck/rerunfilecheck.sty';
    expect(path.length).toBe(79);
    const parsed = parseLog(
      log(
        '(./main.tex',
        path,
        'Package: rerunfilecheck 2025-06-21 v1.11',
        ')',
        ...undefinedCs('x', 3),
      ),
    );
    expect(parsed.files).toContain('rerunfilecheck.sty');
    expect(parsed.errors[0]?.file).toBe('main.tex');
  });

  it('strips the project root from absolute paths', () => {
    const parsed = parseLog(log('(/home/me/thesis/chapters/a.tex', ...undefinedCs('x', 1), ')'), {
      root: '/home/me/thesis/',
    });
    expect(parsed.errors[0]?.file).toBe('chapters/a.tex');
  });
});

describe('errors', () => {
  it('reads -file-line-error messages', () => {
    const parsed = parseLog(
      log(
        '(./main.tex (./chapters/x.tex',
        './chapters/x.tex:12: Undefined control sequence.',
        'l.12 \\foo',
        '          ',
        '',
      ),
    );
    expect(parsed.errors[0]).toMatchObject({
      file: 'chapters/x.tex',
      line: 12,
      message: 'Undefined control sequence.',
    });
  });

  it('reads -file-line-error messages and file names with spaces', () => {
    // Shape of a real TeX Live 2026 log for `\input{sub dir/intro}` with -file-line-error.
    const parsed = parseLog(
      log(
        '(./main.tex',
        'LaTeX Font Info:    ... okay on input line 2.',
        ' (./sub dir/intro.tex',
        'Overfull \\hbox (12.668pt too wide) in paragraph at lines 1--2',
        '\\OT1/cmr/m/n/10 per-cal-ifrag-ilis-tic-ex-pi-ali-do-ciousxxxxxxxxxxxxxxxxxxxxxx',
        ' []',
        '',
        '',
        './sub dir/intro.tex:4: Undefined control sequence.',
        'l.4 Bad \\anotherbad',
        '                   {} here.',
        'The control sequence at the end of the top line',
        "of your error message was never \\def'ed.",
        '',
        ')',
        '(/home/me/my paper/sections/b.tex',
        'Overfull \\hbox (20.0pt too wide) in paragraph at lines 3--4',
        '[]\\OT1/cmr/m/n/10 x',
        '',
        ')',
        'C:/Users/Me/My Thesis/c.tex:7: Undefined control sequence.',
        'l.7 \\bad',
        '',
      ),
      { root: '/home/me/my paper' },
    );
    expect(parsed.errors.map((e) => [e.file, e.line, e.message])).toEqual([
      ['sub dir/intro.tex', 4, 'Undefined control sequence.'],
      ['C:/Users/Me/My Thesis/c.tex', 7, 'Undefined control sequence.'],
    ]);
    expect(parsed.warnings.filter((w) => w.kind === 'overfull').map((w) => w.file)).toEqual([
      'sub dir/intro.tex',
      'sections/b.tex',
    ]);
    expect(parsed.files).toContain('sub dir/intro.tex');
    expect(parsed.files).not.toContain('sub');
  });

  it('does not take text after a spaceless file name as part of it', () => {
    const parsed = parseLog(
      log('(./main.tex (./a.tex) (./build note.tex', ...undefinedCs('x', 1), ')', ')'),
    );
    expect(parsed.files).toEqual(['main.tex', 'a.tex', 'build note.tex']);
    const p2 = parseLog(log('(./main.tex [1] (./figs) text with a period.tex', ')'));
    expect(p2.files).toEqual(['main.tex', 'figs']);
  });

  it('joins package error continuation lines', () => {
    const parsed = parseLog(
      log(
        '(./main.tex',
        '! Package fontspec Error: ',
        '(fontspec)                The font "Foo Sans" cannot be',
        '(fontspec)                found; this may be but usually is not a fontspec bug.',
        '',
        'l.3 \\setmainfont{Foo Sans}',
        '                           ',
        '',
      ),
    );
    expect(parsed.errors[0]?.message).toBe(
      'Package fontspec Error: The font "Foo Sans" cannot be found; this may be but usually is not a fontspec bug.',
    );
    expect(parsed.errors[0]?.line).toBe(3);
    const raw = parsed.errors[0]?.raw ?? '';
    expect(analyzeLog(log('(./main.tex', ...raw.split('\n'))).build.problems[0]?.rule).toBe(
      'font-not-found',
    );
  });

  it('never drops an unknown error', () => {
    const { build } = analyzeLog(
      log('(./main.tex', '! Something entirely new happened.', 'l.7 x', '     ', ''),
    );
    expect(build.problems).toHaveLength(1);
    expect(build.problems[0]).toMatchObject({
      rule: 'tex-error',
      severity: 'error',
      message: 'Something entirely new happened',
      location: { file: 'main.tex', line: 7 },
    });
  });
});

describe('cascades', () => {
  it('folds follow-on errors within 3 lines into the root', () => {
    const { build } = analyzeLog(
      log(
        '(./main.tex',
        ...undefinedCs('foo', 10),
        ...undefinedCs('bar', 12),
        ...undefinedCs('baz', 14),
        ')',
      ),
    );
    expect(build.problems.map((p) => [p.location?.line, p.related])).toEqual([
      [10, 1],
      [14, undefined],
    ]);
    expect(build.problems[0]?.evidence).toContain('\\bar');
  });

  it('keeps errors in different files apart', () => {
    const { build } = analyzeLog(
      log(
        '(./main.tex (./a.tex',
        ...undefinedCs('foo', 2),
        ') (./b.tex',
        ...undefinedCs('bar', 3),
        '))',
      ),
    );
    expect(build.problems).toHaveLength(2);
  });

  it('folds Emergency stop and the fatal notice into the preceding root', () => {
    const { build } = analyzeLog(
      log(
        '(./main.tex',
        "! LaTeX Error: File `nosuch.sty' not found.",
        '',
        'Type X to quit or <RETURN> to proceed,',
        'or enter new name. (Default extension: sty)',
        '',
        'Enter file name: ',
        '! Emergency stop.',
        '<read *> ',
        '         ',
        'l.3 \\begin',
        '          {document}',
        '*** (cannot \\read from terminal in nonstop modes)',
        '',
        '!  ==> Fatal error occurred, no output PDF file produced!',
      ),
    );
    expect(build.problems).toHaveLength(1);
    expect(build.problems[0]).toMatchObject({ rule: 'missing-package', related: 2 });
  });
});

describe('warnings and output', () => {
  it('reports only overfull boxes above the threshold, worst per file', () => {
    const text = log(
      '(./main.tex',
      ...overfull(4.5, '1--2'),
      ...overfull(12.5, '5--6'),
      ...overfull(30.25, '9--9'),
      '(./b.tex',
      ...overfull(11, '3--3'),
      '))',
    );
    const problems = analyzeLog(text).output.problems;
    expect(problems.map((p) => [p.location?.file, p.data?.amountPt, p.data?.others])).toEqual([
      ['main.tex', 30.25, 1],
      ['b.tex', 11, 0],
    ]);
    expect(problems[0]).toMatchObject({ severity: 'warning', location: { line: 9 } });
    expect(analyzeLog(text, { overfullThresholdPt: 50 }).output.problems).toEqual([]);
    expect(analyzeLog(text, { overfullThresholdPt: 1 }).output.problems[0]?.data?.others).toBe(2);
  });

  it('ignores underfull boxes', () => {
    const text = log(
      '(./main.tex',
      'Underfull \\hbox (badness 10000) in paragraph at lines 3--4',
      '[]',
      '',
      ')',
    );
    expect(analyzeLog(text).output.problems).toEqual([]);
    expect(parseLog(text).warnings[0]?.kind).toBe('underfull');
  });

  it('groups undefined citations by key with page and line', () => {
    const text = log(
      '(./main.tex',
      "LaTeX Warning: Citation `smith2020' on page 3 undefined on input line 41.",
      '',
      "LaTeX Warning: Citation `smith2020' on page 4 undefined on input line 57.",
      '',
      ')',
    );
    const [problem] = analyzeLog(text).output.problems;
    expect(problem).toMatchObject({
      rule: 'undefined-citation',
      location: { file: 'main.tex', line: 41, page: 3 },
      data: { key: 'smith2020', count: 2 },
    });
  });

  it('parses wrapped warnings', () => {
    const text = log(
      '(./main.tex',
      ...wrap('LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.'),
      '',
      ')',
    );
    expect(parseLog(text).rerunNeeded.latex).toBe(true);
    expect(analyzeLog(text).output.problems[0]?.rule).toBe('rerun-needed');
  });

  it('keeps undefined references when the build failed and labels may have changed', () => {
    const text = log(
      '(./main.tex',
      ...undefinedCs('foo', 3),
      "LaTeX Warning: Reference `fig:missing' on page 1 undefined on input line 7.",
      '',
      'LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.',
      '',
      ')',
    );
    const { build, output } = analyzeLog(text);
    expect(build.status).toBe('fail');
    expect(output.problems.map((p) => p.rule)).toContain('undefined-reference');
    expect(output.problems.find((p) => p.rule === 'undefined-reference')?.data).toMatchObject({
      label: 'fig:missing',
    });
  });

  it('collects biblatex continuation lines', () => {
    const parsed = parseLog(
      log(
        '(./main.tex',
        'Package biblatex Warning: Please (re)run Biber on the file:',
        '(biblatex)                main',
        '(biblatex)                and rerun LaTeX afterwards.',
        ')',
      ),
    );
    expect(parsed.warnings[0]?.message).toBe(
      'Please (re)run Biber on the file: main and rerun LaTeX afterwards.',
    );
    expect(parsed.rerunNeeded).toEqual({ latex: false, biber: true, bibtex: false });
  });

  it('reports font substitutions and duplicate labels', () => {
    const text = log(
      '(./main.tex',
      "LaTeX Font Warning: Font shape `OT1/cmr/bx/sc' undefined",
      "(Font)              using `OT1/cmr/bx/n' instead on input line 3.",
      '',
      "LaTeX Warning: Label `fig:a' multiply defined.",
      '',
      ')',
    );
    expect(analyzeLog(text).output.problems.map((p) => p.rule)).toEqual([
      'duplicate-label',
      'font-substitution',
    ]);
  });
});

describe('normalizePath', () => {
  it.each([
    ['./main.tex', undefined, 'main.tex'],
    ['./chapters/./x.tex', undefined, 'chapters/x.tex'],
    ['/w/chapters/x.tex', '/w', 'chapters/x.tex'],
    ['/w/chapters/x.tex', '/w/', 'chapters/x.tex'],
    ['C:\\Users\\me\\thesis\\main.tex', 'C:\\Users\\me\\thesis', 'main.tex'],
    ['/usr/local/texlive/2026/texmf-dist/tex/latex/base/article.cls', '/w', 'article.cls'],
    ['/usr/share/texmf/tex/latex/hyperref/hyperref.sty', undefined, 'hyperref.sty'],
    ['"./my chapter.tex"', undefined, 'my chapter.tex'],
    ['/home/me/texlive/thesis/main.tex', '/home/me/texlive/thesis', 'main.tex'],
  ])('%s (root %s) → %s', (input, root, expected) => {
    expect(normalizePath(input, root)).toBe(expected);
  });
});

describe('performance', () => {
  it('parses a 50k-line log in well under a second', () => {
    const chunk = [
      '(./chapters/chapter.tex [12]',
      "LaTeX Font Info:    External font `cmex10' loaded for size",
      '(Font)              <7> on input line 3.',
      ...overfull(3, '10--12'),
      "LaTeX Warning: Reference `fig:x' on page 2 undefined on input line 5.",
      '',
      ...undefinedCs('foo', 20),
      ')',
    ];
    const lines = [BANNER, '(./main.tex'];
    while (lines.length < 50_000) lines.push(...chunk);
    lines.push(')');
    const text = lines.join('\n');
    const start = performance.now();
    const result = analyzeLog(text);
    const elapsed = performance.now() - start;
    expect(result.parsed.errors.length).toBeGreaterThan(1000);
    expect(elapsed).toBeLessThan(1000);
  });
});
