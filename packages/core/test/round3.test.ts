/** Regression tests for the round-3 audit findings (core). */
import { describe, expect, it } from 'vitest';
import { parseBib } from '../src/bib/index.js';
import { parseLog } from '../src/log/index.js';
import { normalizePath } from '../src/log/paths.js';
import { entryFromPublisherBibtex, sanitizeTexValue } from '../src/refs/entry.js';
import { entryKind, identifiersOf, isStandard } from '../src/refs/kind.js';
import { refsCheck, refsRules, verifyEntries } from '../src/refs/index.js';
import { neutralizeWorkflowCommands, oneLine } from '../src/report/shared.js';
import { allRules } from '../src/rules.js';
import { handlerFetch, json } from './fixtures/refs/fake-fetch.js';

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
    expect(isStandard(one('@misc{w, title={y}, url={https://www.rfc-editor.org/rfc/rfc9110}}'))).toBe(
      true,
    );
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
    const log = `This is LuaHBTeX, Version 1.18.0\n${filler}\nC:\\Users\\me\\paper\\main.tex:12: Undefined control sequence.\nl.12 \\foo\n`;
    const parsed = parseLog(log);
    const err = parsed.errors[0];
    expect(err?.line).toBe(12);
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
  url = {https://example.org/book}, x-overfull = {cite crossref 2024-01-01}}`);
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
