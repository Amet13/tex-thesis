/**
 * Fixtures in fixtures/pdf were compiled with TeX Live 2026 from the .tex next to them:
 * tagged.pdf (LuaLaTeX, tagging + PDF/UA-2, alt text), noalt.pdf (tagged, one figure
 * without alt, no PDF/UA claim), untagged.pdf (pdfLaTeX, letter, unresolved \ref/\cite).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  accessibilityCheck,
  extractPdfFacts,
  isMissingAlt,
  type PdfFacts,
  type PdfjsLike,
  parsePdffonts,
  parseVeraPdfReport,
  pdfOutputProblems,
} from '../src/pdf/index.js';

const fixture = (name: string) => new URL(`./fixtures/pdf/${name}`, import.meta.url);
const read = (name: string) => readFileSync(fixture(name));
const readText = (name: string) => readFileSync(fixture(name), 'utf8');

// pdf.js is a dependency of the CLI; core stays free of it and gets it injected.
async function loadPdfjs(): Promise<PdfjsLike> {
  const req = createRequire(new URL('../../cli/package.json', import.meta.url));
  const path = req.resolve('pdfjs-dist/legacy/build/pdf.mjs');
  return (await import(pathToFileURL(path).href)) as PdfjsLike;
}

function facts(overrides: Partial<PdfFacts> = {}): PdfFacts {
  return {
    pageCount: 1,
    pages: [{ number: 1, text: '', widthMm: 210, heightMm: 297 }],
    info: {},
    xmp: {},
    tagged: true,
    hasStructTree: true,
    figures: [],
    language: 'en',
    title: 'T',
    displayDocTitle: true,
    pdfua: 2,
    ...overrides,
  };
}

describe('extractPdfFacts', () => {
  let pdfjs: PdfjsLike;
  let tagged: PdfFacts;
  let noalt: PdfFacts;
  let untagged: PdfFacts;
  beforeAll(async () => {
    pdfjs = await loadPdfjs();
    tagged = await extractPdfFacts(new Uint8Array(read('tagged.pdf')), pdfjs);
    noalt = await extractPdfFacts(new Uint8Array(read('noalt.pdf')), pdfjs);
    untagged = await extractPdfFacts(new Uint8Array(read('untagged.pdf')), pdfjs);
  });

  it('reads metadata, tagging, language and PDF/UA claim of a tagged PDF', () => {
    expect(tagged.pageCount).toBe(1);
    expect(tagged.tagged).toBe(true);
    expect(tagged.hasStructTree).toBe(true);
    expect(tagged.language).toBe('en-US');
    expect(tagged.title).toBe('Tagged Fixture');
    expect(tagged.xmp.title).toBe('Tagged Fixture');
    expect(tagged.info.author).toBe('Ada Lovelace');
    expect(tagged.displayDocTitle).toBe(true);
    expect(tagged.pdfua).toBe(2);
    expect(tagged.figures).toEqual([{ page: 1, alt: 'A grey placeholder image' }]);
    expect(tagged.pages[0]?.text).toContain('See Figure 1 in Section 1');
  });

  it('finds figures without alt text', () => {
    expect(noalt.figures).toHaveLength(2);
    // LaTeX inserts the file name as placeholder alt text when alt= is missing.
    expect(noalt.figures.filter((f) => isMissingAlt(f.alt))).toHaveLength(1);
    expect(noalt.pdfua).toBeUndefined();
  });

  it('reports page size in millimetres', () => {
    expect(untagged.pages[0]?.widthMm).toBeCloseTo(215.9, 0);
    expect(untagged.pages[0]?.heightMm).toBeCloseTo(279.4, 0);
  });

  it('describes an untagged PDF', () => {
    expect(untagged.pageCount).toBe(2);
    expect(untagged.tagged).toBe(false);
    expect(untagged.language).toBeUndefined();
    expect(untagged.title).toBeUndefined();
    expect(untagged.figures).toEqual([]);
  });

  it('does not detach the caller’s buffer', async () => {
    const data = new Uint8Array(read('untagged.pdf'));
    await extractPdfFacts(data, pdfjs);
    expect(data.byteLength).toBeGreaterThan(0);
  });

  it('finds ?? and [?] with page numbers but ignores a??b in code', () => {
    const problems = pdfOutputProblems(untagged);
    const refs = problems.filter((p) => p.rule === 'pdf-unresolved-reference');
    const cites = problems.filter((p) => p.rule === 'pdf-unresolved-citation');
    expect(refs.map((p) => [p.location?.page, p.data?.count])).toEqual([
      [1, 3],
      [2, 1],
    ]);
    expect(cites.map((p) => p.location?.page)).toEqual([1]);
    expect(problems.every((p) => p.check === 'output' && p.severity === 'error')).toBe(true);
    expect(pdfOutputProblems(tagged)).toEqual([]);
  });

  it('flags an untagged PDF as inaccessible', () => {
    const r = accessibilityCheck(untagged, { level: 'required' });
    expect(r.status).toBe('fail');
    expect(r.problems.map((p) => p.rule).sort()).toEqual([
      'pdf-missing-language',
      'pdf-missing-title',
      'pdf-not-tagged',
      'pdfua-not-claimed',
    ]);
  });

  it('passes the tagged fixture', () => {
    const r = accessibilityCheck(tagged, { level: 'required' });
    expect(r.status).toBe('pass');
    expect(r.problems).toEqual([]);
  });

  it('reports missing alt per page', () => {
    const r = accessibilityCheck(noalt, { level: 'recommended' });
    const alt = r.problems.find((p) => p.rule === 'figure-missing-alt');
    expect(alt).toMatchObject({ severity: 'warning', location: { page: 1 }, data: { count: 1 } });
    expect(r.status).toBe('warn');
  });
});

describe('pdfOutputProblems on synthetic text', () => {
  const run = (text: string) =>
    pdfOutputProblems(facts({ pages: [{ number: 4, text, widthMm: 210, heightMm: 297 }] }));

  it.each([
    'see Figure ?? for details',
    'as in Fig. ??.',
    'Eq. (??) shows',
    'by (??) we get',
    'Sections ?? and 3',
    'shown in ??.',
    'see §??',
  ])('flags "%s"', (text) => {
    expect(run(text).map((p) => p.rule)).toEqual(['pdf-unresolved-reference']);
  });

  it.each(['const x = a ?? b;', 'regex a??b is lazy', 'what?? really', 'x ?? y'])(
    'ignores "%s"',
    (text) => {
      expect(run(text)).toEqual([]);
    },
  );

  it('flags [?] and [?, ?] citations', () => {
    const p = run('prior work [?] and [?, ?] disagree');
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ rule: 'pdf-unresolved-citation', data: { count: 2 } });
  });
});

describe('accessibilityCheck', () => {
  it('is skipped when level is off', () => {
    const r = accessibilityCheck(facts({ tagged: false }), { level: 'off' });
    expect(r.status).toBe('skipped');
  });

  it('flags DisplayDocTitle off when a title exists', () => {
    const r = accessibilityCheck(facts({ displayDocTitle: false }));
    expect(r.problems[0]).toMatchObject({ rule: 'pdf-missing-title', severity: 'error' });
    expect(r.problems[0]?.message).toMatch(/DisplayDocTitle/);
  });

  it('flags unembedded fonts from pdffonts', () => {
    const fonts = parsePdffonts(
      [
        'name                                 type              encoding         emb sub uni object ID',
        '------------------------------------ ----------------- ---------------- --- --- --- ---------',
        'Helvetica                            Type 1            Standard         no  no  no       9  0',
        'ABCDEF+CMR10                         Type 1            Builtin          yes yes yes      5  0',
      ].join('\n'),
    );
    const r = accessibilityCheck(facts({ fonts }), { level: 'required' });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatchObject({ rule: 'font-not-embedded', data: { fonts: ['Helvetica'] } });
  });

  it('adds an info when veraPDF is unavailable', () => {
    const r = accessibilityCheck(facts(), { verapdf: null });
    expect(r.status).toBe('pass');
    expect(r.problems.map((p) => [p.rule, p.severity])).toEqual([['verapdf-not-run', 'info']]);
  });

  it('groups veraPDF failures by clause', () => {
    const verapdf = parseVeraPdfReport(readText('verapdf-ua1.xml'));
    const r = accessibilityCheck(facts(), { verapdf, level: 'recommended' });
    const rules = r.problems.map((p) => p.rule);
    expect(rules).toEqual([...new Set(rules)]);
    expect(rules.every((id) => id.startsWith('verapdf-'))).toBe(true);
    expect(r.problems.every((p) => p.severity === 'warning')).toBe(true);
    expect(r.problems[0]?.message).toMatch(/^ISO 14289-1:2014 §[\d.]+: .+ \(\d+ failed checks?\)$/);
  });
});

describe('parsePdffonts', () => {
  it('parses real pdffonts output', () => {
    const fonts = parsePdffonts(readText('tagged.pdffonts.txt'));
    expect(fonts.length).toBe(5);
    expect(fonts[0]).toEqual({
      name: 'AJQHRP+LMRoman17-Regular',
      type: 'CID Type 0C',
      embedded: true,
      subset: true,
      unicode: true,
    });
    expect(fonts.find((f) => f.name.includes('LMSans'))?.unicode).toBe(false);
  });

  it('returns [] for unrelated text', () => {
    expect(parsePdffonts('Syntax Error: something')).toEqual([]);
  });
});

describe('parseVeraPdfReport', () => {
  it('parses veraPDF XML', () => {
    const r = parseVeraPdfReport(readText('verapdf-ua1.xml'));
    expect(r.error).toBeUndefined();
    expect(r.compliant).toBe(false);
    expect(r.failures.length).toBeGreaterThan(0);
    expect(r.failures[0]?.specification).toMatch(/ISO 14289/);
    expect(r.failures[0]?.description.length).toBeGreaterThan(5);
  });

  it('parses veraPDF JSON', () => {
    const r = parseVeraPdfReport(readText('verapdf-ua2.json'));
    expect(r.error).toBeUndefined();
    expect(r.failures.length).toBeGreaterThan(0);
    expect(r.failures.every((f) => f.clause && f.failedChecks > 0)).toBe(true);
  });

  it('parses a compliant JSON report', () => {
    const r = parseVeraPdfReport(readText('verapdf-compliant.json'));
    expect(r).toMatchObject({ compliant: true, failures: [] });
  });

  it('reports errors instead of throwing', () => {
    expect(parseVeraPdfReport('').error).toBeTruthy();
    expect(parseVeraPdfReport('{oops').error).toMatch(/JSON/);
    expect(parseVeraPdfReport('<report><jobs/></report>').error).toBeTruthy();
  });
});
