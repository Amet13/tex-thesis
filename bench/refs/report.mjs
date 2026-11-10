// Markdown rendering of a results.json, for the workflow's job summary.
import { CLASSES, FABRICATED, STATUSES } from './score.mjs';

const pct = (p) => (p.rate === null ? 'n/a' : `${(p.rate * 100).toFixed(1)}%`);
const ci = (p) =>
  p.low === null ? '' : ` (95% CI ${(p.low * 100).toFixed(1)}–${(p.high * 100).toFixed(1)}%)`;
const frac = (p) => `${p.k}/${p.n}`;
const secs = (s) => (s === null || s === undefined ? 'n/a' : s.toFixed(2));

export function toMarkdown(r) {
  const m = r.metrics;
  const lines = [];
  lines.push(`## Reference check benchmark, ${r.date.slice(0, 10)}`, '');
  lines.push(
    `Overfull ${r.overfullVersion}, mode ${r.mode}${r.partial ? ' (partial: --limit was used, do not publish)' : ''}. ` +
      `${r.datasets.real.entries} real and ${r.datasets.fabricated.entries} fabricated entries.`,
    '',
  );
  lines.push(
    `| Class | total | ${STATUSES.join(' | ')} |`,
    `|---|---:|${STATUSES.map(() => '---:').join('|')}|`,
  );
  for (const c of CLASSES) {
    const row = r.counts[c];
    lines.push(`| ${c} | ${row.total} | ${STATUSES.map((s) => row[s]).join(' | ')} |`);
  }
  lines.push('', '| Metric | Value | Count |', '|---|---:|---:|');
  lines.push(
    `| False "not found" on real works | ${pct(m.falseNotFoundOnReal)}${ci(m.falseNotFoundOnReal)} | ${frac(m.falseNotFoundOnReal)} |`,
  );
  lines.push(
    `| Real works flagged as mismatch | ${pct(m.falseMismatchOnReal)} | ${frac(m.falseMismatchOnReal)} |`,
  );
  lines.push(
    `| Real works with incomplete lookup | ${pct(m.lookupIncompleteOnReal)} | ${frac(m.lookupIncompleteOnReal)} |`,
  );
  for (const c of FABRICATED)
    lines.push(
      `| Detection, ${c} | ${pct(m.detection[c])}${ci(m.detection[c])} | ${frac(m.detection[c])} |`,
    );
  lines.push(
    `| Unverifiable, real works | ${pct(m.unverifiable.real)} | ${frac(m.unverifiable.real)} |`,
  );
  lines.push(
    `| Unverifiable, all entries | ${pct(m.unverifiable.all)} | ${frac(m.unverifiable.all)} |`,
  );
  lines.push(
    `| Seconds per entry, median / p95 | ${secs(m.secondsPerEntry.median)} / ${secs(m.secondsPerEntry.p95)} | ${m.secondsPerEntry.n} |`,
    `| Total time | ${secs(m.secondsPerEntry.total)} s | |`,
  );
  lines.push(
    '',
    '| Source | requests | failed requests | entries where it was switched off |',
    '|---|---:|---:|---:|',
  );
  for (const s of r.sources)
    lines.push(`| ${s.host} | ${s.requests} | ${s.failures} | ${s.skippedByBreaker} |`);
  const misses = r.entries.filter((e) => e.class === 'real' && e.status === 'not-found');
  if (misses.length) {
    lines.push(
      '',
      'Real works reported as not found:',
      '',
      ...misses.map((e) => `- \`${e.key}\`: ${e.reason ?? ''}`),
    );
  }
  lines.push(
    '',
    'To publish these numbers on the site, download `results.json` from the workflow artifacts, commit it as `bench/refs/results.json` in a pull request and mention the run it came from.',
  );
  return `${lines.join('\n')}\n`;
}
