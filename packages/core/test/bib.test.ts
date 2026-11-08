import { describe, expect, it } from 'vitest';
import {
  citedKeys,
  formatBibEntry,
  parseBib,
  parseBibWithIssues,
  parseNames,
  texToPlain,
} from '../src/bib/index.js';

describe('parseBib', () => {
  it('parses a basic entry with lowercased type and field names', () => {
    const [e] = parseBib(
      '@Article{Knuth84,\n  AUTHOR = {Donald Knuth},\n  Title = "Literate Programming",\n  YEAR = 1984\n}',
    );
    expect(e).toMatchObject({
      key: 'Knuth84',
      type: 'article',
      line: 1,
      fields: { author: 'Donald Knuth', title: 'Literate Programming', year: '1984' },
    });
    expect(e?.raw.startsWith('@Article{Knuth84')).toBe(true);
    expect(e?.raw.endsWith('}')).toBe(true);
  });

  it('keeps nested braces and inner TeX, strips only the outer delimiters', () => {
    const [e] = parseBib(
      '@article{a, title = {The {LaTeX} Companion: {\\"U}ber {$\\alpha$}}, note = "a {"} b"}',
    );
    expect(e?.fields.title).toBe('The {LaTeX} Companion: {\\"U}ber {$\\alpha$}');
    expect(e?.fields.note).toBe('a {"} b');
  });

  it('expands @string macros, month macros and # concatenation', () => {
    const text = `@string{ acm = "Communications of the ACM" }
@STRING(pre = {Proc. })
@article{x, journal = acm, booktitle = pre # {SOSP} # " 2024", month = jul, year = 2024}`;
    const [e] = parseBib(text);
    expect(e?.fields).toMatchObject({
      journal: 'Communications of the ACM',
      booktitle: 'Proc. SOSP 2024',
      month: 'July',
      year: '2024',
    });
  });

  it('ignores @comment, @preamble, text and % lines outside entries', () => {
    const text = `This file was generated.
% @article{commented, title={no}}
@comment{ @article{alsoCommented, title = {no}} }
@preamble{ "\\newcommand{\\noop}[1]{}" }
@book{real, title = {Yes}}`;
    expect(parseBib(text).map((e) => e.key)).toEqual(['real']);
  });

  it('accepts trailing commas, parentheses delimiters and multi-line values', () => {
    const [a, b] = parseBib('@misc(p1, title = {A\n   B},)\n\n@misc{p2,\n title={C},\n}\n');
    expect(a?.fields.title).toBe('A B');
    expect(b?.key).toBe('p2');
    expect(b?.line).toBe(4);
  });

  it('skips malformed entries, reports them, and resumes at the next entry', () => {
    const text = `@article{good1, title = {One}}
@article{broken, title = {Two} year = {2020}}
@article{good2, title = {Three}}
@article{unclosed, title = {Four}
@article{good3, title = {Five}}`;
    const { entries, issues } = parseBibWithIssues(text);
    expect(entries.map((e) => e.key)).toEqual(['good1', 'good2', 'good3']);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({ line: 2, key: 'broken' });
    expect(issues[0]?.message).toMatch(/missing comma/);
    expect(issues[1]).toMatchObject({ line: 4, key: 'unclosed' });
  });

  it('reports an entry without a key and duplicate keys/fields', () => {
    const { entries, issues } = parseBibWithIssues(
      '@article{, title={x}}\n@book{k, title={A}, title={B}}\n@book{K, title={C}}',
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.fields.title).toBe('A');
    expect(issues.map((i) => i.message).join('\n')).toMatch(
      /no citation key[\s\S]*duplicate field[\s\S]*duplicate key/,
    );
  });

  it('reports undefined macros but keeps the text', () => {
    const { entries, issues } = parseBibWithIssues('@article{k, journal = jacm}');
    expect(entries[0]?.fields.journal).toBe('jacm');
    expect(issues[0]?.message).toMatch(/undefined macro/);
  });

  it('handles keys with colons, dots and dashes', () => {
    expect(parseBib('@inproceedings{DBLP:conf/usenix/OngaroO14, title={T}}')[0]?.key).toBe(
      'DBLP:conf/usenix/OngaroO14',
    );
  });
});

describe('formatBibEntry', () => {
  it('orders fields, aligns =, lowercases and drops empty fields', () => {
    const [e] = parseBib(
      '@InProceedings{k, Note = {n}, year = 2014, title = {T}, Author = {A, B}, doi = {10.1/x}, booktitle = {B}, abstract = {}, pages={1--2}}',
    );
    expect(formatBibEntry(e as NonNullable<typeof e>)).toBe(
      `@inproceedings{k,
  author    = {A, B},
  title     = {T},
  booktitle = {B},
  year      = {2014},
  pages     = {1--2},
  doi       = {10.1/x},
  note      = {n},
}
`,
    );
  });

  it('round-trips through parseBib', () => {
    const [e] = parseBib(
      '@article{k, title = {The {LaTeX} way}, author = {Erd{\\H{o}}s, P.}, year = 1947}',
    );
    const [again] = parseBib(formatBibEntry(e as NonNullable<typeof e>));
    expect(again?.fields).toEqual(e?.fields);
  });
});

describe('citedKeys', () => {
  it('reads BibTeX \\citation lines, deduped and in order, without *', () => {
    const aux =
      '\\relax\n\\citation{b,a}\n\\citation{c}\n\\citation{a}\n\\citation{*}\n\\bibcite{a}{1}';
    expect(citedKeys(aux)).toEqual(['b', 'a', 'c']);
  });

  it('reads biblatex \\abx@aux@cite in both the old and the refsection form', () => {
    const aux =
      '\\abx@aux@refcontext{nyt/global//global/global}\n\\abx@aux@cite{0}{knuth84}\n\\abx@aux@segm{0}{0}{knuth84}\n\\abx@aux@cite{lamport78}\n\\abx@aux@cite{0}{knuth84}';
    expect(citedKeys(aux)).toEqual(['knuth84', 'lamport78']);
  });

  it('reads biber .bcf citekeys', () => {
    const bcf = `<?xml version="1.0" encoding="UTF-8"?>
<bcf:controlfile version="3.11" xmlns:bcf="https://sourceforge.net/projects/biblatex">
  <bcf:section number="0">
    <bcf:citekey order="1" intorder="1">vaswani2017attention</bcf:citekey>
    <bcf:citekey order="2" intorder="1">a&amp;b</bcf:citekey>
    <bcf:citekey order="3" intorder="1">vaswani2017attention</bcf:citekey>
    <bcf:citekey order="4" intorder="1">*</bcf:citekey>
  </bcf:section>
</bcf:controlfile>`;
    expect(citedKeys(bcf)).toEqual(['vaswani2017attention', 'a&b']);
  });
});

describe('texToPlain', () => {
  it.each([
    ['{\\"o}', 'ö'],
    ["\\'e", 'é'],
    ['G{\\"o}del', 'Gödel'],
    ['Erd{\\H{o}}s', 'Erdős'],
    ['Erd\\H{o}s', 'Erdős'],
    ["{\\v{S}}ar{\\v{c}}evi{\\'c}", 'Šarčević'],
    ["Garc{\\'\\i}a", 'García'],
    ['{\\L}ukasz', 'Łukasz'],
    ['Stra{\\ss}e', 'Straße'],
    ['Fran\\c{c}ois', 'François'],
    ['\\AA{}ngstr\\"om', 'Ångström'],
    ['R\\&D', 'R&D'],
    ['50\\% faster', '50% faster'],
    ['\\emph{Deep} \\textbf{learning}', 'Deep learning'],
    ['The {LaTeX} {C}ompanion', 'The LaTeX Companion'],
    ['pages 1--2 --- done', 'pages 1–2 — done'],
    ['$\\alpha$-helix', 'α-helix'],
    ['$O(n \\log n)$', 'O(n log n)'],
    ['A~B', 'A B'],
    ['\\{literal braces\\}', '{literal braces}'],
  ])('%s → %s', (input, expected) => {
    expect(texToPlain(input)).toBe(expected);
  });
});

describe('parseNames', () => {
  it('handles Last, First / First Last / von / corporate / others', () => {
    const names = parseNames(
      'Lamport, Leslie and Diego Ongaro and van der Aalst, Wil and Ludwig van Beethoven and {ATLAS Collaboration} and others',
    );
    expect(names.map((n) => n.family)).toEqual([
      'Lamport',
      'Ongaro',
      'van der Aalst',
      'van Beethoven',
      'ATLAS Collaboration',
    ]);
    expect(names[4]?.corporate).toBe(true);
    expect(names[1]?.given).toBe('Diego');
  });

  it('does not split on "and" inside braces', () => {
    expect(parseNames('{Barnes and Noble} and Smith, J.')).toHaveLength(2);
  });
});
