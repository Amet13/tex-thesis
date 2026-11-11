/** scripts/sources-health.mjs: probe outcomes and the issue body, without the network. */
import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain .mjs script without type declarations
import { PROBES, probe, probeAll, report } from '../sources-health.mjs';

type Result = { source: string; status: string; detail: string };
const exact = (a: string, b: string) => (a.toLowerCase() === b.toLowerCase() ? 1 : 0);

/** Fake source modules: every function answers with the probe's own known title. */
function healthySources(): Record<string, (...a: unknown[]) => Promise<unknown>> {
  const byTitle = Object.fromEntries(
    (PROBES as { source: string; title: string }[]).map((p) => [p.source, p.title]),
  );
  const rec = (s: string) => ({ title: byTitle[s] });
  return {
    resolveDoi: async () => ({ kind: 'found', record: rec('doi.org') }),
    crossrefSearch: async (_c, q) =>
      (q as { title: string }).title.startsWith('Quantum') ? [] : [rec('crossref')],
    dblpSearch: async (_c, t) => (String(t).startsWith('Quantum') ? [] : [rec('dblp')]),
    arxivById: async () => rec('arxiv'),
    arxivSearch: async () => [],
    openalexSearch: async (_c, t) => (String(t).startsWith('Quantum') ? [] : [rec('openalex')]),
    semanticScholarSearch: async (_c, t) =>
      String(t).startsWith('Quantum') ? [] : [rec('semanticscholar')],
    aclById: async () => rec('acl'),
    europepmcByPmid: async () => rec('europepmc'),
    europepmcSearch: async () => [],
  };
}

const deps = (sources: ReturnType<typeof healthySources>, opts = {}) => ({
  sources,
  client: {},
  opts,
  similarity: exact,
});

describe('sources-health', () => {
  it('reports nothing when every source answers as expected', async () => {
    const results = (await probeAll(deps(healthySources()), 0)) as Result[];
    expect(results.map((r) => r.status)).toEqual(PROBES.map(() => 'ok'));
    expect(report(results)).toBe('');
  });

  it('a bot wall is broken; the report names the source and says why', async () => {
    const s = healthySources();
    s.dblpSearch = async () => {
      throw new Error('dblp.org returned a non-JSON page (HTTP 202)');
    };
    const results = (await probeAll(deps(s), 0)) as Result[];
    expect(results.find((r) => r.source === 'dblp')).toMatchObject({ status: 'broken' });
    expect(report(results)).toContain('| dblp | dblp.org returned a non-JSON page (HTTP 202) |');
  });

  it('a 429 without a key is a note, with a key it is broken', async () => {
    const s = healthySources();
    s.semanticScholarSearch = async () => {
      throw new Error('api.semanticscholar.org answered HTTP 429');
    };
    const p = PROBES.find((x: { source: string }) => x.source === 'semanticscholar');
    expect(((await probe(p, deps(s))) as Result).status).toBe('limited');
    expect(((await probe(p, deps(s, { semanticScholarKey: 'k' }))) as Result).status).toBe(
      'broken',
    );
    expect(report([{ source: 'semanticscholar', status: 'limited', detail: '' }])).toBe('');
  });

  it('a known work no longer found, or the invented control "found", is broken', async () => {
    const s = healthySources();
    s.crossrefSearch = async () => [{ title: 'Something else entirely' }];
    s.openalexSearch = async (_c, t) => [{ title: String(t) }];
    const results = (await probeAll(deps(s), 0)) as Result[];
    expect(results.find((r) => r.source === 'crossref')?.detail).toMatch(/no longer finds/);
    expect(results.find((r) => r.source === 'openalex')?.detail).toMatch(/invented title/);
  });
});
