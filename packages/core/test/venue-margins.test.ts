/**
 * `text-outside-block`: text extents from the PDF (extractPdfFacts) compared with a venue's
 * text block. untagged.pdf is pdfLaTeX `article` on US Letter with default margins.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractPdfFacts, type PdfFacts, type PdfjsLike } from '../src/pdf/index.js';
import { marginProblems } from '../src/venue/margins.js';
import { venueRules } from '../src/venue/rules.js';
import type { VenueProfile } from '../src/venue/types.js';

async function loadPdfjs(): Promise<PdfjsLike> {
  const req = createRequire(new URL('../../cli/package.json', import.meta.url));
  return (await import(
    pathToFileURL(req.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href
  )) as PdfjsLike;
}

const profile = (textBlock: VenueProfile['textBlock']): VenueProfile => ({
  id: 'v',
  name: 'Venue',
  description: '',
  ...(textBlock ? { textBlock } : {}),
});

const facts = (box: NonNullable<PdfFacts['pages'][0]['textBox']>): PdfFacts => ({
  pageCount: 1,
  pages: [{ number: 1, text: 'x', widthMm: 215.9, heightMm: 279.4, textBox: box }],
  info: {},
  xmp: {},
  tagged: false,
  hasStructTree: false,
  figures: [],
});

describe('text extents from the PDF', () => {
  let real: PdfFacts;
  beforeAll(async () => {
    real = await extractPdfFacts(
      new Uint8Array(readFileSync(new URL('./fixtures/pdf/untagged.pdf', import.meta.url))),
      await loadPdfjs(),
    );
  });

  it('measures where the text sits on the page', () => {
    const box = real.pages[0]?.textBox;
    expect(box).toBeDefined();
    if (!box) return;
    expect(box.leftMm).toBeGreaterThan(10);
    expect(box.rightMm).toBeLessThan(real.pages[0]?.widthMm ?? 0);
    expect(box.topMm).toBeGreaterThan(5);
    expect(box.bottomMm).toBeLessThan(real.pages[0]?.heightMm ?? 0);
    expect(box.rightMm).toBeGreaterThan(box.leftMm);
  });

  it('a generous block passes and a narrow one is reported', () => {
    expect(marginProblems(profile({ widthMm: 190 }), { facts: real })).toEqual([]);
    const narrow = marginProblems(profile({ widthMm: 60 }), { facts: real });
    expect(narrow[0]?.rule).toBe('text-outside-block');
    expect(narrow[0]?.location?.page).toBe(1);
  });
});

describe('text-outside-block', () => {
  it('is registered as a warning', () => {
    expect(venueRules.find((r) => r.id === 'text-outside-block')?.severity).toBe('warning');
  });

  it('does nothing without a text block or a PDF', () => {
    expect(
      marginProblems(profile(undefined), {
        facts: facts({ leftMm: 0, rightMm: 215, topMm: 0, bottomMm: 279 }),
      }),
    ).toEqual([]);
    expect(marginProblems(profile({ widthMm: 100 }), {})).toEqual([]);
  });

  it('centres the block when no left edge is given, with 2 mm tolerance', () => {
    // Letter is 215.9 mm wide; a 139.7 mm block (5.5 in) spans 38.1 to 177.8 mm.
    const p = profile({ widthMm: 139.7 });
    expect(
      marginProblems(p, {
        facts: facts({ leftMm: 36.5, rightMm: 179.5, topMm: 30, bottomMm: 250 }),
      }),
    ).toEqual([]);
    const [problem] = marginProblems(p, {
      facts: facts({ leftMm: 38.1, rightMm: 184, topMm: 30, bottomMm: 250 }),
    });
    expect(problem?.message).toMatch(/6\.2 mm into the right margin/);
  });

  it('checks top and bottom only when the block gives them', () => {
    const box = { leftMm: 40, rightMm: 170, topMm: 10, bottomMm: 270 };
    expect(marginProblems(profile({ widthMm: 139.7 }), { facts: facts(box) })).toEqual([]);
    const [problem] = marginProblems(profile({ widthMm: 139.7, heightMm: 228.6, topMm: 25.4 }), {
      facts: facts(box),
    });
    expect(problem?.message).toMatch(/top margin/);
    expect(problem?.message).toMatch(/bottom margin/);
  });
});

describe('line numbers in the margin', () => {
  it('do not count toward the text extent', async () => {
    const { extractPdfFacts: extract } = await import('../src/pdf/index.js');
    const item = (str: string, x: number, width: number) => ({
      str,
      transform: [10, 0, 0, 10, x, 700],
      width,
      height: 10,
    });
    const page = {
      view: [0, 0, 612, 792],
      rotate: 0,
      getTextContent: async () => ({
        items: [item('12', 20, 10), item('The text of the paper.', 108, 300), item('13', 580, 10)],
      }),
      getStructTree: async () => null,
    };
    const pdfjs = {
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getMetadata: async () => ({ info: {}, metadata: null }),
          getMarkInfo: async () => null,
          getPage: async () => page,
          destroy: async () => {},
        }),
      }),
    } as unknown as PdfjsLike;
    const f = await extract(new Uint8Array([1]), pdfjs);
    const box = f.pages[0]?.textBox;
    expect(box?.leftMm).toBeCloseTo(108 * (25.4 / 72), 0);
    expect(box?.rightMm).toBeCloseTo(408 * (25.4 / 72), 0);
  });
});
