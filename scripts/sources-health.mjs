#!/usr/bin/env node
// Weekly health check of every reference source Overfull asks (sources-health.yml).
// For each source, two fixed queries through the core's own source modules: one that
// must find a known work, and one invented title that must find nothing similar. Prints
// a Markdown report of the sources that need a look, and nothing when all are healthy.
//
//   node scripts/sources-health.mjs [--json]
//
// A source counts as broken only after a second attempt a minute later fails the same
// way. A source without an API key that answers HTTP 429 (a shared keyless budget used
// up, common on CI runners) is listed as a note, not as broken. OPENALEX_API_KEY,
// SEMANTIC_SCHOLAR_API_KEY and OVERFULL_MAILTO are used when set.
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/** A title that no index should know (checked when this file was written). */
const INVENTED = 'Quantum Gradient Folding for Self-Supervised Hypergraph Lattice Transformers';

/**
 * One probe per source. `known` runs the source's own lookup for a work it must have;
 * `title` is that work's title, compared with what came back.
 */
export const PROBES = [
  {
    source: 'doi.org',
    title: 'Time, clocks, and the ordering of events in a distributed system',
    known: (s, c) => s.resolveDoi(c, '10.1145/359545.359563'),
    invented: null,
  },
  {
    source: 'crossref',
    title: 'Deep Residual Learning for Image Recognition',
    known: (s, c, o) =>
      s.crossrefSearch(c, { title: 'Deep Residual Learning for Image Recognition' }, o.mailto),
    invented: (s, c, o) => s.crossrefSearch(c, { title: INVENTED }, o.mailto),
  },
  {
    source: 'dblp',
    title: 'In Search of an Understandable Consensus Algorithm',
    known: (s, c) => s.dblpSearch(c, 'In Search of an Understandable Consensus Algorithm'),
    invented: (s, c) => s.dblpSearch(c, INVENTED),
  },
  {
    source: 'arxiv',
    title: 'Attention Is All You Need',
    known: (s, c) => s.arxivById(c, '1706.03762'),
    invented: (s, c) => s.arxivSearch(c, INVENTED),
  },
  {
    source: 'openalex',
    title: 'Deep Residual Learning for Image Recognition',
    keyed: 'openalexKey',
    known: (s, c, o) =>
      s.openalexSearch(c, 'Deep Residual Learning for Image Recognition', o.openalexKey, o.mailto),
    invented: (s, c, o) => s.openalexSearch(c, INVENTED, o.openalexKey, o.mailto),
  },
  {
    source: 'semanticscholar',
    title: 'Deep Residual Learning for Image Recognition',
    keyed: 'semanticScholarKey',
    known: (s, c, o) =>
      s.semanticScholarSearch(
        c,
        'Deep Residual Learning for Image Recognition',
        o.semanticScholarKey,
      ),
    invented: (s, c, o) => s.semanticScholarSearch(c, INVENTED, o.semanticScholarKey),
  },
  {
    source: 'acl',
    title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
    known: (s, c) => s.aclById(c, 'N19-1423'),
    invented: null,
  },
  {
    source: 'europepmc',
    title: 'Initial sequencing and analysis of the human genome',
    known: (s, c) => s.europepmcByPmid(c, '11237011'),
    invented: (s, c) => s.europepmcSearch(c, INVENTED),
  },
];

/** The records a source call returned, whatever its shape. */
function recordsOf(answer) {
  if (answer === null || answer === undefined) return [];
  if (Array.isArray(answer)) return answer;
  if (answer.kind === 'found') return [answer.record];
  if (answer.kind) return [];
  return [answer];
}

/**
 * Runs one probe. Returns { source, status, detail }: status `ok`, `limited` (HTTP 429
 * without a key), or `broken` (no answer, an HTML page instead of data, or the known
 * work not found, or an invented title "found").
 */
export async function probe(p, deps) {
  const { sources, client, opts, similarity } = deps;
  const run = async (fn) => {
    try {
      return { records: recordsOf(await fn(sources, client, opts)) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };
  const known = await run(p.known);
  if (known.error) {
    const limited = /HTTP 429/.test(known.error) && p.keyed && !opts[p.keyed];
    return { source: p.source, status: limited ? 'limited' : 'broken', detail: known.error };
  }
  const best = Math.max(0, ...known.records.map((r) => similarity(p.title, r.title ?? '')));
  if (best < 0.9) {
    return {
      source: p.source,
      status: 'broken',
      detail: `answered, but no longer finds “${p.title}” (best title match ${best.toFixed(2)})`,
    };
  }
  if (p.invented) {
    const inv = await run(p.invented);
    if (inv.error) return { source: p.source, status: 'broken', detail: inv.error };
    const hit = inv.records.find((r) => similarity(INVENTED, r.title ?? '') >= 0.9);
    if (hit) {
      return {
        source: p.source,
        status: 'broken',
        detail: `“finds” the invented title used as a control: “${hit.title}”`,
      };
    }
  }
  return { source: p.source, status: 'ok', detail: '' };
}

/** The issue body: empty when every source is healthy (the issue then closes). */
export function report(results) {
  const broken = results.filter((r) => r.status === 'broken');
  const limited = results.filter((r) => r.status === 'limited');
  if (!broken.length) return '';
  const lines = [
    'These reference sources did not answer as expected, twice, a minute apart. The',
    'reference check works around a missing source (see "Not found" in',
    'docs/guide/references.md), but each one lost means fewer entries can be judged.',
    '',
    '| Source | What happened |',
    '| --- | --- |',
    ...broken.map((r) => `| ${r.source} | ${r.detail.replaceAll('|', '\\|')} |`),
  ];
  if (limited.length) {
    lines.push(
      '',
      `Also rate-limited without an API key (not counted as broken): ${limited.map((r) => r.source).join(', ')}.`,
    );
  }
  lines.push(
    '',
    'Look at the source module in packages/core/src/refs/sources/ and the API documentation',
    'it links. A bot wall or a changed response format needs a code change; an outage',
    'needs nothing (this issue closes itself on the next good run).',
  );
  return lines.join('\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Probes every source; a failing one is asked again after `retryMs`. */
export async function probeAll(deps, retryMs = 60_000) {
  const results = [];
  for (const p of PROBES) {
    let r = await probe(p, deps);
    if (r.status === 'broken') {
      await sleep(retryMs);
      r = await probe(p, { ...deps, client: deps.newClient ? deps.newClient() : deps.client });
    }
    results.push(r);
  }
  return results;
}

async function main() {
  const { values } = parseArgs({ options: { json: { type: 'boolean' } } });
  // Loads the TypeScript sources of the core directly (the benchmark does the same).
  await import('../bench/refs/lib/core.mjs');
  const src = new URL('../packages/core/src/refs/', import.meta.url);
  const load = (p) => import(new URL(p, src).href);
  const [http, normalize, ...mods] = await Promise.all(
    [
      'http.ts',
      'normalize.ts',
      'sources/doi.ts',
      'sources/crossref.ts',
      'sources/dblp.ts',
      'sources/arxiv.ts',
      'sources/openalex.ts',
      'sources/semanticscholar.ts',
      'sources/acl.ts',
      'sources/europepmc.ts',
    ].map(load),
  );
  const sources = Object.assign({}, ...mods);
  const opts = {
    mailto: process.env.OVERFULL_MAILTO || undefined,
    openalexKey: process.env.OPENALEX_API_KEY || undefined,
    semanticScholarKey: process.env.SEMANTIC_SCHOLAR_API_KEY || undefined,
  };
  const newClient = () =>
    new http.HttpClient({
      arxivIntervalMs: 3000,
      ...(opts.semanticScholarKey ? { semanticScholarKey: opts.semanticScholarKey } : {}),
    });
  const results = await probeAll({
    sources,
    client: newClient(),
    newClient,
    opts,
    similarity: normalize.titleSimilarity,
  });
  if (values.json) console.log(JSON.stringify(results, null, 2));
  else {
    const body = report(results);
    if (body) console.log(body);
    for (const r of results)
      console.error(`${r.source}: ${r.status}${r.detail ? ` (${r.detail})` : ''}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
