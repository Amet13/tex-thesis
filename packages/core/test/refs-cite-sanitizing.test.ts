import { describe, expect, it } from 'vitest';
import { formatBibEntry, parseBib } from '../src/bib/index.js';
import {
  entryFromPublisherBibtex,
  escapeLooseTex,
  htmlUnescape,
  sanitizeTexValue,
  stripPictographs,
} from '../src/refs/entry.js';
import { lookup } from '../src/refs/index.js';
import { handlerFetch, readFixture } from './fixtures/refs/fake-fetch.js';

const fast = { arxivIntervalMs: 0, retryDelayMs: 0 };
const _atom = (body: string) =>
  new Response(body, { headers: { 'content-type': 'application/atom+xml' } });
const _one = (bib: string) => parseBib(bib)[0] as NonNullable<ReturnType<typeof parseBib>[0]>;

describe('R11: publisher BibTeX is sanitized', () => {
  it('neutralizes \\input and friends in a DataCite-like title, keeps accents', () => {
    const bib = `@misc{x, title = {Data for \\input{/etc/passwd} G\\"odel \\textit{et al.} \\immediate\\write18{rm -rf ~} ^^5cinput{x}},
  author = {M\\"uller, J.}, publisher = {Zenodo \\csname foo\\endcsname}, year = {2024}}`;
    const e = entryFromPublisherBibtex(bib, '10.5281/zenodo.1');
    const title = e?.fields.title ?? '';
    expect(title).not.toMatch(/\\input/);
    expect(title).not.toMatch(/\\immediate|\\write/);
    expect(title).not.toContain('^^');
    expect(title).toContain('\\textbackslash{}input{/etc/passwd}');
    expect(title).toContain('G\\"odel');
    expect(title).toContain('\\textit{et al.}');
    expect(e?.fields.author).toBe('M\\"uller, J.');
    expect(e?.fields.publisher).not.toMatch(/\\csname/);
    expect(sanitizeTexValue('\\DeclareRobustCommand\\x{}')).toContain('\\textbackslash{}');
    expect(sanitizeTexValue('$x^2$ \\emph{a}')).toBe('$x^2$ \\emph{a}');
  });
});

describe('A2: cite writes clean, escaped values (recorded doi.org responses)', () => {
  const recorded = JSON.parse(readFixture('doi-escaping.json')) as Record<
    string,
    { csl: string; bibtex: string }
  >;
  const doiFetch = handlerFetch((u, accept) => {
    const doi = decodeURIComponent(u.pathname.slice(1)).toLowerCase();
    const r = recorded[doi];
    if (u.host !== 'doi.org' || !r) return new Response('', { status: 404 });
    return accept.includes('bibtex')
      ? new Response(r.bibtex, { headers: { 'content-type': 'application/x-bibtex' } })
      : new Response(r.csl, {
          headers: { 'content-type': 'application/vnd.citationstyles.csl+json' },
        });
  });

  it('KDD: &amp; becomes \\& (not &amp; and not a bare &)', async () => {
    const r = await lookup('10.1145/3292500.3330701', { fetch: doiFetch.fetch, ...fast });
    const booktitle = r?.entry.fields.booktitle ?? '';
    expect(booktitle).toContain('Knowledge Discovery \\& Data Mining');
    expect(booktitle).not.toContain('&amp;');
    expect(formatBibEntry(r?.entry as NonNullable<typeof r>['entry'])).not.toMatch(/[^\\]&/);
    // ACM's BibTeX has `collection` (not a BibTeX field) next to `series`: only `series` stays.
    expect(r?.entry.fields.collection).toBeUndefined();
    expect(r?.entry.fields.series).toBeDefined();
  });

  it('FAccT: the parrot emoji is dropped without a trailing space', async () => {
    const r = await lookup('10.1145/3442188.3445922', { fetch: doiFetch.fetch, ...fast });
    expect(r?.entry.fields.title).toBe(
      'On the Dangers of Stochastic Parrots: Can Language Models Be Too Big?',
    );
  });

  it('helpers', () => {
    expect(htmlUnescape('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x2014;')).toBe(
      'a & b <c> "d" \'e\' —',
    );
    expect(stripPictographs('Too Big? 🦜')).toBe('Too Big?');
    expect(stripPictographs('A 👩‍💻 coder ❤️ x')).toBe('A coder x');
    expect(escapeLooseTex('R&D 50% #1 a_b $x_1$ \\& ok')).toBe(
      'R\\&D 50\\% \\#1 a\\_b $x_1$ \\& ok',
    );
  });
});
