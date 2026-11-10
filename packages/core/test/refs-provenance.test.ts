import { describe, expect, it } from 'vitest';
import { parseBib } from '../src/bib/index.js';
import { markCited, refsCheck, refsRules, verifyEntries } from '../src/refs/index.js';
import { entryKind, identifiersOf, isStandard } from '../src/refs/kind.js';
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
