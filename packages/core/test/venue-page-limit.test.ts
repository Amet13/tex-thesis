import { describe, expect, it } from 'vitest';
import type { PdfFacts } from '../src/pdf/index.js';
import { resolveProfile, venueCheck } from '../src/venue/index.js';

const profile = resolveProfile({
  extends: 'paper',
  pageLimit: { max: 8, endLabel: 'overfull:main-end' },
});
const facts = {
  pageCount: 5,
  pages: [],
  info: {},
  xmp: {},
  tagged: true,
  hasStructTree: true,
  figures: [],
} as PdfFacts;
const rules = (ctx: Parameters<typeof venueCheck>[1]) =>
  venueCheck(profile, ctx)
    .problems.map((p) => p.rule)
    .filter((r) => r.startsWith('page-limit'));

describe('page limit with an end label', () => {
  it('with no PDF reports only page-limit-unchecked', () => {
    expect(rules({ texFiles: [{ path: 'main.tex', content: 'x' }] })).toEqual([
      'page-limit-unchecked',
    ]);
    expect(rules({ aux: '\\newlabel{other}{{1}{1}}' })).toEqual(['page-limit-unchecked']);
  });

  it('with a PDF but no label reports page-limit-label-missing', () => {
    expect(rules({ facts, aux: '' })).toEqual(['page-limit-label-missing']);
  });
});
