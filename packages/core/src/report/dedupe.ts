import { outputSummary } from '../log/analyze.js';
import { type CheckResult, statusOf } from '../types.js';

/**
 * Removes findings that two checks report about the same thing, so each problem
 * appears once. A cited key with no .bib entry is reported by the log
 * (`undefined-citation`, output) and by the bibliography (`citation-key-missing`,
 * references); the second carries the fix, so the log's copy is dropped. The output
 * check's status and summary are recomputed. Changes `checks` in place.
 */
export function mergeDuplicateFindings(checks: CheckResult[]): CheckResult[] {
  const refs = checks.find((c) => c.check === 'references');
  const output = checks.find((c) => c.check === 'output');
  if (!refs || !output) return checks;
  const missing = new Set(
    refs.problems.filter((p) => p.rule === 'citation-key-missing').map((p) => String(p.data?.key)),
  );
  if (!missing.size) return checks;
  const kept = output.problems.filter(
    (p) => !(p.rule === 'undefined-citation' && missing.has(String(p.data?.key))),
  );
  if (kept.length === output.problems.length) return checks;
  output.problems = kept;
  if (output.status !== 'skipped') {
    output.status = statusOf(kept);
    output.summary = outputSummary(kept);
  }
  return checks;
}
