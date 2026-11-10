/**
 * Measured results committed to the repository, rendered on the guide pages
 * "How accurate is the reference check" (bench/refs/results.json) and "Does it help
 * agents" (evals/results/*.json). Nothing is shown until such a file exists, and a
 * partial or replayed benchmark run is never shown.
 */
import { listFiles, readText } from './repo';

interface Proportion {
  k: number;
  n: number;
  rate: number | null;
  low: number | null;
  high: number | null;
}

interface BenchResults {
  date?: string;
  overfullVersion?: string;
  mode?: string;
  partial?: boolean;
  datasets?: { real?: { entries?: number }; fabricated?: { entries?: number } };
  sources?: { host?: string; requests?: number; failures?: number }[];
  metrics?: {
    falseNotFoundOnReal?: Proportion;
    falseMismatchOnReal?: Proportion;
    lookupIncompleteOnReal?: Proportion;
    detection?: Record<string, Proportion>;
    secondsPerEntry?: { median?: number | null; p95?: number | null };
  };
}

interface EvalResults {
  date?: string;
  label?: string;
  model?: string | null;
  runsPerCell?: number;
  tasks?: string[];
  byVariant?: { variant: string; pass?: Proportion; clean?: Proportion }[];
}

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ENTITIES[c] ?? c);
const pct = (v: number | null | undefined) =>
  typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : 'n/a';
const prop = (p: Proportion | undefined) =>
  p ? `${pct(p.rate)} (${p.k} of ${p.n}; 95% CI ${pct(p.low)} to ${pct(p.high)})` : 'n/a';
const num = (v: number | null | undefined) => (typeof v === 'number' ? v.toFixed(1) : 'n/a');

function parse<T>(text: string | null): T | undefined {
  if (!text) return undefined;
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === 'object' ? (v as T) : undefined;
  } catch {
    return undefined;
  }
}

/** HTML for the benchmark results, or '' when there is no published live run. */
export function benchResultsHtml(): string {
  const r = parse<BenchResults>(readText('bench/refs/results.json'));
  if (r?.mode !== 'live' || !r || r.partial) return '';
  const m = r.metrics ?? {};
  const det = m.detection ?? {};
  const rows: [string, string][] = [
    ['Real works reported as not found', prop(m.falseNotFoundOnReal)],
    ['Real works reported with differing metadata', prop(m.falseMismatchOnReal)],
    ['Real works not decided because an index was unreachable', prop(m.lookupIncompleteOnReal)],
    ['Invented entries detected', prop(det.invented)],
    ['Entries with wrong metadata detected', prop(det['wrong-metadata'])],
    ['Entries with the DOI of another work detected', prop(det['wrong-doi'])],
  ];
  const unreachable = (r.sources ?? [])
    .filter((s) => (s.requests ?? 0) > 0 && (s.failures ?? 0) >= (s.requests ?? 0))
    .map((s) => s.host ?? '?');
  return `<h2 id="measured">Measured</h2>
<p>Run of ${esc(String(r.date).slice(0, 10))} with Overfull ${esc(r.overfullVersion)}: ${esc(r.datasets?.real?.entries ?? '?')} real and ${esc(r.datasets?.fabricated?.entries ?? '?')} fabricated entries, live indexes.</p>
<table><thead><tr><th>Measure</th><th>Result</th></tr></thead><tbody>
${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('\n')}
</tbody></table>
<p>Seconds per entry: median ${num(m.secondsPerEntry?.median)}, 95th percentile ${num(m.secondsPerEntry?.p95)}.${unreachable.length ? ` Unreachable during the run: ${esc(unreachable.join(', '))}.` : ''}</p>`;
}

/** HTML for the committed agent eval results, or '' when there are none. */
export function evalResultsHtml(): string {
  const runs = listFiles('evals/results')
    .filter((f) => f.endsWith('.json'))
    .map((f) => parse<EvalResults>(readText(`evals/results/${f}`)))
    .filter((r): r is EvalResults & { byVariant: NonNullable<EvalResults['byVariant']> } =>
      Array.isArray(r?.byVariant),
    );
  if (!runs.length) return '';
  const body = runs
    .map(
      (r) => `<h3>${esc(r.label)}, ${esc(String(r.date).slice(0, 10))}</h3>
<p>Model: ${esc(r.model ?? 'not stated')}. ${esc(r.runsPerCell)} runs per task and variant, ${esc(r.tasks?.length ?? '?')} tasks.</p>
<table><thead><tr><th>Variant</th><th>Passed</th><th>Passed with no fabricated or unverified citation</th></tr></thead><tbody>
${r.byVariant.map((b) => `<tr><td>${esc(b.variant)}</td><td>${esc(prop(b.pass))}</td><td>${esc(prop(b.clean))}</td></tr>`).join('\n')}
</tbody></table>`,
    )
    .join('\n');
  return `<h2 id="measured">Measured</h2>\n${body}`;
}
