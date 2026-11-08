import { logRules } from './log/index.js';
import { pdfRules } from './pdf/index.js';
import { refsRules } from './refs/index.js';
import type { RuleInfo } from './types.js';
import { venueRules } from './venue/index.js';

let cache: RuleInfo[] | undefined;

/** Every documented rule, deduplicated by id (first definition wins). */
export function allRules(): RuleInfo[] {
  if (cache) return cache;
  const seen = new Map<string, RuleInfo>();
  for (const r of [...logRules, ...refsRules, ...pdfRules, ...venueRules]) {
    if (!seen.has(r.id)) seen.set(r.id, r);
  }
  cache = [...seen.values()];
  return cache;
}

/**
 * Looks up a rule by id. Dynamic veraPDF ids (`verapdf-8-2-5-26`) resolve to
 * the generic `verapdf` rule with the clause in the title.
 */
export function getRule(id: string): RuleInfo | undefined {
  const exact = allRules().find((r) => r.id === id);
  if (exact) return exact;
  const m = /^verapdf-(\d[\w-]*)$/.exec(id);
  const generic = allRules().find((r) => r.id === 'verapdf');
  if (m && generic) {
    const clause = (m[1] as string).replace(/-/g, '.');
    return { ...generic, id, title: `PDF/UA clause ${clause} failed (veraPDF)` };
  }
  return undefined;
}
