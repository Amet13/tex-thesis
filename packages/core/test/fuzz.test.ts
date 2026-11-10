// Property-based (fuzz) tests: the parsers read untrusted input (build logs,
// .bib files, .aux files from any project), so they must never throw, and the
// BibTeX writer must round-trip through the reader.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { citedKeys, formatBibEntry, parseBib, parseBibWithIssues } from '../src/bib/index.js';
import { analyzeLog, parseLog } from '../src/log/index.js';

// FUZZ_RUNS=20000 pnpm test fuzz for a deeper run.
const RUNS = { numRuns: Number(process.env.FUZZ_RUNS) || 300 };

/** Text that looks like a TeX log: real line shapes mixed with noise. */
const logLike = fc
  .array(
    fc.oneof(
      fc.string(),
      fc.constantFrom(
        '! Undefined control sequence.',
        'l.12 \\foo',
        '(./main.tex',
        ')',
        './chapters/a.tex:7: Missing $ inserted.',
        'Overfull \\hbox (12.5pt too wide) in paragraph at lines 3--4',
        "LaTeX Warning: Reference `x' on page 1 undefined on input line 9.",
        'Package biblatex Warning: Please (re)run Biber on the file:',
        '<to be read again>',
        'Runaway argument?',
      ),
    ),
    { maxLength: 60 },
  )
  .map((lines) => lines.join('\n'));

const word = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9.,:;'()-]{0,11}$/);
const value = fc.array(word, { minLength: 1, maxLength: 6 }).map((w) => w.join(' '));
const entry = fc.record({
  key: fc.stringMatching(/^[a-z][a-z0-9_:-]{0,19}$/),
  type: fc.constantFrom('article', 'inproceedings', 'book', 'misc', 'phdthesis', 'online'),
  fields: fc.dictionary(
    fc.constantFrom(
      'author',
      'title',
      'journal',
      'booktitle',
      'year',
      'publisher',
      'note',
      'pages',
    ),
    value,
    { minKeys: 1 },
  ),
});

describe('fuzz: parsers never throw', () => {
  it('parseLog and analyzeLog accept any text', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), logLike), (text) => {
        parseLog(text);
        const { build, output } = analyzeLog(text);
        expect(['pass', 'warn', 'fail', 'skipped']).toContain(build.status);
        expect(['pass', 'warn', 'fail', 'skipped']).toContain(output.status);
      }),
      RUNS,
    );
  });

  it('parseBibWithIssues accepts any text', () => {
    const bibLike = fc
      .array(
        fc.oneof(
          fc.string(),
          fc.constantFrom('@article{', '}', '{', ',', ' = ', '"', '@comment', '%'),
        ),
        {
          maxLength: 40,
        },
      )
      .map((parts) => parts.join(''));
    fc.assert(
      fc.property(fc.oneof(fc.string(), bibLike), (text) => {
        const { entries } = parseBibWithIssues(text);
        for (const e of entries) expect(typeof e.key).toBe('string');
      }),
      RUNS,
    );
  });

  it('citedKeys accepts any text', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(Array.isArray(citedKeys(text))).toBe(true);
      }),
      RUNS,
    );
  });
});

describe('fuzz: BibTeX round trip', () => {
  it('formatBibEntry output parses back to the same entry', () => {
    fc.assert(
      fc.property(entry, (e) => {
        const text = formatBibEntry({ ...e, line: 1, raw: '' });
        const [back] = parseBib(text);
        expect(back?.key).toBe(e.key);
        expect(back?.type).toBe(e.type);
        expect(back?.fields).toEqual(e.fields);
      }),
      RUNS,
    );
  });
});
