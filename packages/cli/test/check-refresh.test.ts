/** C4 acceptance: a warm cache means no network; `--refresh` asks again. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/main.js';
import { memIo, tempDir } from './helpers.js';

const BIB = `@article{lamport1978time,
  author = {Lamport, Leslie},
  title = {Time, Clocks, and the Ordering of Events in a Distributed System},
  journal = {CACM}, year = {1978}, doi = {10.1145/359545.359563}}

@inproceedings{ongaro2014search,
  author = {Ongaro, Diego and Ousterhout, John},
  title = {In Search of an Understandable Consensus Algorithm},
  booktitle = {USENIX ATC}, year = {2014}}
`;

const csl = {
  DOI: '10.1145/359545.359563',
  type: 'journal-article',
  title: 'Time, clocks, and the ordering of events in a distributed system',
  author: [{ given: 'Leslie', family: 'Lamport' }],
  issued: { 'date-parts': [[1978, 7]] },
};
const raft = {
  result: {
    hits: {
      '@total': '1',
      hit: [
        {
          info: {
            authors: { author: [{ text: 'Diego Ongaro' }, { text: 'John K. Ousterhout' }] },
            title: 'In Search of an Understandable Consensus Algorithm.',
            venue: 'USENIX ATC',
            year: '2014',
            type: 'Conference and Workshop Papers',
          },
        },
      ],
    },
  },
};
const emptyAtom = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>';

function countingFetch() {
  const state = { calls: 0 };
  const f = (async (input: RequestInfo | URL) => {
    state.calls++;
    const u = new URL(String(input));
    if (u.host === 'doi.org') return Response.json(csl);
    if (u.host === 'dblp.org')
      return Response.json(
        u.searchParams.get('q')?.includes('Understandable') ? raft : { result: { hits: {} } },
      );
    if (u.host === 'api.crossref.org') return Response.json({ message: { items: [] } });
    return new Response(emptyAtom, { headers: { 'content-type': 'application/atom+xml' } });
  }) as typeof fetch;
  return { fetch: f, state };
}

describe('C4: reference cache end to end', () => {
  async function run(
    dir: string,
    cacheHome: string,
    fetch: typeof globalThis.fetch,
    flags: string[],
  ) {
    const io = memIo(dir, { XDG_CACHE_HOME: cacheHome, HOME: cacheHome });
    io.fetch = fetch;
    const code = await main(['check', 'refs.bib', '--json', ...flags], io);
    return { code, report: JSON.parse(io.stdoutText()) };
  }

  it('the second run makes zero network calls; --refresh makes calls again', async () => {
    const dir = tempDir();
    const cacheHome = tempDir();
    writeFileSync(join(dir, 'refs.bib'), BIB);
    const net = countingFetch();

    const first = await run(dir, cacheHome, net.fetch, []);
    expect(net.state.calls).toBeGreaterThan(0);
    const verified = first.report.checks[0].stats?.verified;
    expect(verified).toBe(2);

    net.state.calls = 0;
    const second = await run(dir, cacheHome, net.fetch, []);
    expect(net.state.calls).toBe(0);
    expect(second.report.checks[0].stats?.verified).toBe(2);

    const third = await run(dir, cacheHome, net.fetch, ['--refresh']);
    expect(net.state.calls).toBeGreaterThan(0);
    expect(third.report.checks[0].stats?.verified).toBe(2);

    // The refresh wrote its answers: the next plain run is quiet again.
    net.state.calls = 0;
    await run(dir, cacheHome, net.fetch, []);
    expect(net.state.calls).toBe(0);
  });
});
