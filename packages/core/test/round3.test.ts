/** Regression tests for the round-3 audit findings (core). */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatBibEntry, parseBib } from '../src/bib/index.js';
import { analyzeLog, parseLog } from '../src/log/index.js';
import { normalizePath } from '../src/log/paths.js';
import {
  entryFromPublisherBibtex,
  escapeLooseTex,
  htmlUnescape,
  sanitizeTexValue,
  stripPictographs,
} from '../src/refs/entry.js';
import { lookup, markCited, refsCheck, refsRules, verifyEntries } from '../src/refs/index.js';
import { entryKind, identifiersOf, isStandard } from '../src/refs/kind.js';
import { neutralizeWorkflowCommands, oneLine } from '../src/report/shared.js';
import { allRules } from '../src/rules.js';
import { handlerFetch, json, readFixture } from './fixtures/refs/fake-fetch.js';

const fast = { arxivIntervalMs: 0, retryDelayMs: 0 };
const atom = (body: string) =>
  new Response(body, { headers: { 'content-type': 'application/atom+xml' } });
const one = (bib: string) => parseBib(bib)[0] as NonNullable<ReturnType<typeof parseBib>[0]>;

describe('R7: standards are recognized by type and issuer, not by title words', () => {
  it('a journal article that mentions ISO 9001 in its title is scholarly', () => {
    const fake = one(`@article{fake1,
  title = {A Deep Learning Framework for Quantum Gravitational Lensing of ISO 9001 Auditors},
  author = {Zyx, Quorbl}, journal = {Journal of Imaginary Results}, year = {2023}}`);
    expect(isStandard(fake)).toBe(false);
    expect(entryKind(fake, identifiersOf(fake))).toBe('scholarly');
    const paper = one(`@inproceedings{p, title = {Implementing RFC 9000 in the kernel},
  author = {Doe, J.}, booktitle = {SIGCOMM}, year = {2022}}`);
    expect(isStandard(paper)).toBe(false);
  });

  it('still recognizes real standards', () => {
    expect(isStandard(one('@misc{c, title={HTTP Semantics}, howpublished={RFC 9110}}'))).toBe(true);
    expect(
      isStandard(one('@techreport{i, title={Quality management systems}, institution={ISO}}')),
    ).toBe(true);
    expect(isStandard(one('@techreport{n, title={x}, number={ISO 9001:2015}}'))).toBe(true);
    expect(
      isStandard(one('@misc{w, title={y}, url={https://www.rfc-editor.org/rfc/rfc9110}}')),
    ).toBe(true);
    // A misc entry whose title only mentions a standard somewhere is not one.
    expect(isStandard(one('@misc{m, title={Auditing ISO 9001 in practice}, author={A, B}}'))).toBe(
      false,
    );
  });

  it('requireProvenance reports the fake ISO-titled article (it is searched)', async () => {
    const f = handlerFetch((u) => {
      if (u.host === 'api.crossref.org') return json({ message: { items: [] } });
      if (u.host === 'dblp.org') return json({ result: { hits: { '@total': '0' } } });
      return atom('<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    });
    const entries = parseBib(`@article{fake1,
  title = {A Deep Learning Framework for Quantum Gravitational Lensing of ISO 9001 Auditors},
  author = {Zyx, Quorbl}, journal = {Journal of Imaginary Results}, year = {2023}}`);
    const results = await verifyEntries(entries, {
      fetch: f.fetch,
      ...fast,
      requireProvenance: true,
    });
    expect(results[0]?.status).toBe('not-found');
    expect(f.calls.some((c) => c.includes('crossref'))).toBe(true);
    const rules = refsCheck(results, { entries }).problems.map((p) => p.rule);
    expect(rules).toContain('reference-unproven');
  });
});

describe('R10: identifiers that point to another work', () => {
  const CLOCKS = `@article{c,
  title = {Time, Clocks, and the Ordering of Events in a Distributed System},
  author = {Lamport, Leslie}, journal = {Communications of the ACM}, year = {1978},
  eprint = {2101.00001}, archiveprefix = {arXiv}}`;
  const otherPaper = `<feed xmlns="http://www.w3.org/2005/Atom">
<entry><id>http://arxiv.org/abs/2101.00001v1</id><published>2021-01-01T00:00:00Z</published>
<title>Quantum Transport in Twisted Bilayer Graphene Nanoribbons</title>
<author><name>Mei Tanaka</name></author><author><name>Ravi Gupta</name></author></entry></feed>`;

  it('an arXiv id of a different, identified paper is an error', async () => {
    const f = handlerFetch((u) => {
      if (u.host === 'export.arxiv.org') return atom(otherPaper);
      throw new TypeError(`unexpected ${u.host}`);
    });
    const entries = parseBib(CLOCKS);
    const [r] = await verifyEntries(entries, { fetch: f.fetch, ...fast });
    expect(r?.wrongWork).toMatchObject({ field: 'eprint', id: '2101.00001' });
    const [p] = refsCheck(r ? [r] : [], { entries }).problems;
    expect(p).toMatchObject({ rule: 'reference-arxiv-wrong-work', severity: 'error' });
    expect(p?.message).toContain('Quantum Transport');
    expect(refsRules.some((x) => x.id === 'reference-arxiv-wrong-work')).toBe(true);
  });

  it('a DOI in url = {https://doi.org/…} or howpublished is the entry DOI', async () => {
    const d = one(`@article{d, title = {T}, url = {https://doi.org/10.1145/359545.999999}}`);
    expect(identifiersOf(d).doi).toBe('10.1145/359545.999999');
    const h = one(`@misc{h, title = {T}, howpublished = {\\url{https://dx.doi.org/10.1000/ABC}}}`);
    expect(identifiersOf(h).doi).toBe('10.1000/abc');
    const doiUrls: string[] = [];
    const f = handlerFetch((u) => {
      if (u.host === 'doi.org') {
        doiUrls.push(u.pathname);
        return new Response('Not found', { status: 404 });
      }
      if (u.host === 'api.crossref.org') return json({ message: { items: [] } });
      if (u.host === 'dblp.org') return json({ result: { hits: { '@total': '0' } } });
      return atom('<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    });
    const [r] = await verifyEntries(
      parseBib(`@article{d,
  title = {Time, Clocks, and the Ordering of Events in a Distributed System},
  author = {Lamport, Leslie}, journal = {CACM}, year = {1978},
  url = {https://doi.org/10.1145/359545.999999}}`),
      { fetch: f.fetch, ...fast },
    );
    expect(doiUrls).toEqual(['/10.1145/359545.999999']);
    expect(r?.status).toBe('not-found');
    expect(r?.reason).toContain('DOI 10.1145/359545.999999 does not exist');
  });
});

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

describe('R12: Windows paths in logs', () => {
  it('a C:\\…\\file.tex:12: line starts fresh (not glued to the previous line)', () => {
    const filler = 'x'.repeat(79);
    // An extension outside the known TeX list (knitr's .Rtex), so only STARTS_FRESH can tell.
    const log = `This is LuaHBTeX, Version 1.18.0\n${filler}\nC:\\Users\\me\\paper\\main.Rtex:12: Undefined control sequence.\nl.12 \\foo\n`;
    const parsed = parseLog(log);
    const err = parsed.errors[0];
    expect(err?.line).toBe(12);
    expect(err?.file).toBe('C:/Users/me/paper/main.Rtex');
    expect(err?.message).toContain('Undefined control sequence');
  });

  it('normalizePath compares drive letters case-insensitively', () => {
    expect(normalizePath('c:/Users/me/paper/sec/a.tex', 'C:\\Users\\me\\paper')).toBe('sec/a.tex');
    expect(normalizePath('C:\\Users\\me\\paper\\a.tex', 'c:/Users/me/paper/')).toBe('a.tex');
  });
});

describe('R4: neutralizer and oneLine', () => {
  it('neutralizes markers after any Unicode whitespace and after CR', () => {
    for (const ws of ['\u00a0', '\u3000', '\ufeff', '\u2003', '\u0085', '\f', '\v', ' \t']) {
      const out = neutralizeWorkflowCommands(`ok\n${ws}::error::x`);
      expect(out, JSON.stringify(ws)).toContain('\u200b::error');
    }
    const cr = neutralizeWorkflowCommands('progress\r::set-env name=A::1\r##[group]x');
    expect(cr).toBe('progress\r\u200b::set-env name=A::1\r\u200b##[group]x');
    expect(neutralizeWorkflowCommands('a ::b')).toBe('a ::b');
  });

  it('oneLine strips C1 controls and bidi overrides', () => {
    expect(oneLine('a\u009b31mb\u0085c\u202eevil\u2066x\u2069')).toBe('a31mb cevilx');
  });
});

describe('R8: bib-outside-project is a registered rule', () => {
  it('is documented', () => {
    expect(allRules().find((r) => r.id === 'bib-outside-project')).toMatchObject({
      check: 'references',
    });
  });
});

describe('R15: x-overfull is a marker, not a proof', () => {
  const notFound = handlerFetch((u) => {
    if (u.host === 'api.crossref.org') return json({ message: { items: [] } });
    if (u.host === 'dblp.org') return json({ result: { hits: { '@total': '0' } } });
    return atom('<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
  });
  it('an unverified entry with x-overfull but no DOI/eprint/url is still unproven', async () => {
    const entries = parseBib(`@article{fake2,
  title = {Zorbulating hyperflux capacitors in submerged tandem orchards},
  author = {Zyx, Quorbl}, journal = {Journal of Imaginary Results}, year = {2023},
  x-overfull = {cite crossref 2024-01-01}}
@book{ok, title = {Some unindexed book}, author = {Doe, J.}, year = {2001},
  url = {https://example.org/book}}`);
    // A real `overfull cite` marker (valid hash) with a URL vouches for the book.
    const book = entries[1] as NonNullable<(typeof entries)[1]>;
    entries[1] = markCited(book, 'crossref', '2024-01-01');
    const results = await verifyEntries(entries, {
      fetch: notFound.fetch,
      ...fast,
      requireProvenance: true,
    });
    const unproven = refsCheck(results, { entries, requireProvenance: true })
      .problems.filter((p) => p.rule === 'reference-unproven')
      .map((p) => (p.data as { key: string }).key);
    expect(unproven).toEqual(['fake2']);
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

describe('A6: title lookups are fast and honest', () => {
  const empty = (u: URL): Response => {
    if (u.host === 'api.crossref.org') return json({ message: { items: [] } });
    if (u.host === 'dblp.org') return json({ result: { hits: { '@total': '0' } } });
    return atom('<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
  };

  it('does not retry an OpenAlex 429 whose body says the daily budget is used up', async () => {
    let openalexCalls = 0;
    const f = handlerFetch((u) => {
      if (u.host === 'api.openalex.org') {
        openalexCalls++;
        return new Response('{"error":"Rate limit exceeded: daily budget"}', { status: 429 });
      }
      return empty(u);
    });
    const outcomes: { failures: { source: string; reason: string }[] }[] = [];
    await lookup('A sufficiently long made up title for testing', {
      fetch: f.fetch,
      ...fast,
      openalexKey: 'k',
      onSearch: (o) => outcomes.push(o),
    });
    expect(openalexCalls).toBe(1);
    expect(outcomes[0]?.failures.find((x) => x.source === 'openalex')?.reason).toMatch(/daily/);
  });

  it('stops asking further sources once the time budget is used up', async () => {
    const f = handlerFetch(empty);
    const outcomes: { searched: string[]; failures: { source: string }[] }[] = [];
    await expect(
      lookup('A sufficiently long made up title for testing', {
        fetch: f.fetch,
        ...fast,
        titleBudgetMs: -1,
        onSearch: (o) => outcomes.push(o),
      }),
    ).rejects.toThrow(/time budget/);
    expect(f.calls).toEqual([]);
    expect(outcomes[0]?.searched).toEqual([]);
    expect(outcomes[0]?.failures.map((x) => x.source)).toContain('crossref');
  });

  it('an OpenAlex record without a venue becomes @misc, title casing kept', async () => {
    const f = handlerFetch((u) =>
      u.host === 'api.openalex.org'
        ? json({
            results: [
              {
                display_name: 'Graph Neural Networks for Tiny Orchards in GPU Clusters',
                publication_year: 2024,
                type: 'article',
                authorships: [{ author: { display_name: 'Ada Lovelace' } }],
                primary_location: { source: null },
              },
            ],
          })
        : empty(u),
    );
    const r = await lookup('Graph Neural Networks for Tiny Orchards in GPU Clusters', {
      fetch: f.fetch,
      ...fast,
      openalexKey: 'k',
    });
    expect(r?.entry.type).toBe('misc');
    expect(r?.entry.fields.title).toBe('Graph Neural Networks for Tiny Orchards in GPU Clusters');
  });
});

describe('A5: lookup reports what really answered', () => {
  it('a dblp bot wall (HTTP 202 HTML) is a failure, not a searched source', async () => {
    const f = handlerFetch((u) => {
      if (u.host === 'dblp.org')
        return new Response('<html>Making sure you are not a bot!</html>', { status: 202 });
      if (u.host === 'api.crossref.org') return json({ message: { items: [] } });
      return atom('<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    });
    let seen: { searched: string[]; failures: { source: string }[] } | undefined;
    await lookup('A sufficiently long made up title for testing', {
      fetch: f.fetch,
      ...fast,
      sources: ['crossref', 'dblp', 'arxiv'],
      onSearch: (o) => {
        seen = o;
      },
    });
    expect(seen?.searched).toEqual(['crossref', 'arxiv']);
    expect(seen?.failures.map((x) => x.source)).toEqual(['dblp']);
  });
});

describe('A11: an error in an \\input file followed by `)`', () => {
  it('one `_` in related.tex is one problem, not a second root in main.tex (real LuaLaTeX log)', () => {
    const log = readFileSync(
      new URL('./fixtures/input-underscore/main.log', import.meta.url),
      'utf8',
    );
    const { build } = analyzeLog(log, { root: '/work' });
    expect(build.problems.map((p) => [p.rule, p.location?.file, p.location?.line])).toEqual([
      ['missing-dollar', 'related.tex', 4],
    ]);
    expect(build.problems[0]?.related).toBe(1);
  });

  it('an overfull box "at lines 13--1" points at the end line in the current file', () => {
    const log = [
      'This is LuaHBTeX, Version 1.18.0',
      '(./main.tex',
      '(./related.tex)',
      'Overfull \\hbox (25.0pt too wide) in paragraph at lines 13--1',
      '[]\\TU/lmr/m/n/10 text',
      '',
      ')',
    ].join('\n');
    const { output } = analyzeLog(log);
    const box = output.problems.find((p) => p.rule === 'overfull-box');
    expect(box?.location).toMatchObject({ file: 'main.tex', line: 1 });
  });
});

describe('A7: overfull-box advice', () => {
  it('does not suggest \\sloppy', () => {
    const log = [
      'This is LuaHBTeX, Version 1.18.0',
      '(./main.tex',
      'Overfull \\hbox (25.0pt too wide) in paragraph at lines 3--4',
      '[]\\TU/lmr/m/n/10 text',
      '',
      ')',
    ].join('\n');
    const box = analyzeLog(log).output.problems.find((p) => p.rule === 'overfull-box');
    expect(box?.fix).toBeDefined();
    expect(box?.fix).not.toMatch(/sloppy/);
    expect(box?.fix).toMatch(/microtype/);
  });
});
