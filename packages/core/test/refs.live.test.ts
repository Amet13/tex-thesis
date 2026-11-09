/** Live smoke test against the real indexes. Run with OVERFULL_LIVE=1. */
import { describe, expect, it } from 'vitest';
import { parseBib } from '../src/bib/index.js';
import { lookup, verifyEntries } from '../src/refs/index.js';

const live = process.env.OVERFULL_LIVE === '1';
const mailto = process.env.OVERFULL_MAILTO;

describe.skipIf(!live)('live reference lookups', () => {
  it('verifies a DOI and an arXiv paper, and does not verify a fabricated one', {
    timeout: 120_000,
  }, async () => {
    const entries = parseBib(`
@article{lamport1978time, author={Lamport, Leslie}, year={1978},
  title={Time, Clocks, and the Ordering of Events in a Distributed System}, doi={10.1145/359545.359563}}
@misc{vaswani2017attention, author={Vaswani, Ashish}, title={Attention Is All You Need}, year={2017},
  eprint={1706.03762}, archiveprefix={arXiv}}
@article{fake, author={Zhang, Li}, title={Neural Certificates for Byzantine Fault-Tolerant Replication},
  journal={ACM TOCS}, year={2023}, doi={10.1145/3587712.3587799}}`);
    const results = await verifyEntries(entries, { ...(mailto ? { mailto } : {}) });
    expect(results.map((r) => r.status)).toEqual(['verified', 'verified', 'not-found']);
  });

  it('looks up a DOI', { timeout: 60_000 }, async () => {
    const r = await lookup('10.1038/171737a0', { ...(mailto ? { mailto } : {}) });
    expect(r?.entry.key).toBe('watson1953molecular');
  });
});
