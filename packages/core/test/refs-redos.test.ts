/**
 * Identifier parsers take text from .bib fields. Crafted values that made earlier
 * regular expressions backtrack (CodeQL alerts on acl.ts, europepmc.ts, kind.ts, doi.ts) must
 * finish quickly.
 */
import { describe, expect, it } from 'vitest';
import { identifiersOf } from '../src/refs/kind.js';
import { parseAclId } from '../src/refs/sources/acl.js';
import { parseDoi } from '../src/refs/sources/doi.js';
import { parsePmcid, parsePmid } from '../src/refs/sources/europepmc.js';

const LIMIT_MS = 100;
const N = 100_000;

function timed(fn: () => unknown): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

describe('identifier parsers stay linear on crafted input', () => {
  const inputs: Record<string, string> = {
    hashes: `#${'#'.repeat(N)}x`,
    'pmid tabs': `pmid\t${'\t'.repeat(N)}x`,
    'url braces': `\\url{{${'\\url{{|'.repeat(N / 8)}`,
    'query marks': `aclanthology.org/2020.acl-main.1${'?'.repeat(N)}`,
    'doi commas': `10.1234/x${','.repeat(N)}x`,
    'doi trailing commas': `10.1234/x${','.repeat(N)}`,
  };
  for (const [name, text] of Object.entries(inputs)) {
    it(name, () => {
      expect(timed(() => parseAclId(text))).toBeLessThan(LIMIT_MS);
      expect(timed(() => parsePmid(text))).toBeLessThan(LIMIT_MS);
      expect(timed(() => parsePmcid(text))).toBeLessThan(LIMIT_MS);
      expect(timed(() => parseDoi(text))).toBeLessThan(LIMIT_MS);
      // Built directly: the crafted text need not be valid BibTeX.
      const entry = {
        key: 'k',
        type: 'misc',
        fields: { title: 'T', url: text, howpublished: text, note: text, eprint: text },
        line: 1,
        raw: '',
      } as unknown as Parameters<typeof identifiersOf>[0];
      expect(timed(() => identifiersOf(entry))).toBeLessThan(LIMIT_MS);
    });
  }

  it('still parses the real forms', () => {
    expect(parseAclId('https://aclanthology.org/2020.acl-main.1.pdf')).toBe('2020.acl-main.1');
    expect(parseAclId('10.18653/v1/p19-1001')).toBe('P19-1001');
    expect(parsePmid('PMID: 19872477')).toBe('19872477');
    expect(parsePmid('https://pubmed.ncbi.nlm.nih.gov/19872477/')).toBe('19872477');
    expect(parsePmcid('https://pmc.ncbi.nlm.nih.gov/articles/PMC2323736/')).toBe('PMC2323736');
    expect(parseDoi('10.1145/359545.359563.')).toBe('10.1145/359545.359563');
    expect(parseDoi('doi:10.1145/359545.359563,;. ')).toBe('10.1145/359545.359563');
    expect(parseDoi('10.1000/a,b')).toBe('10.1000/a,b');
    expect(parseDoi('10.1000/,,,')).toBe('10.1000/');
  });
});
