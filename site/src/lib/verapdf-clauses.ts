import { getRule, type RuleInfo, veraPdfClauses } from '@overfull/core';

/**
 * veraPDF failures have rule ids `verapdf-<clause>` (`8.2.5.26` →
 * `verapdf-8-2-5-26`). Core explains the common clause families; each gets a
 * page of its own. Other clause ids are sent to the nearest of these by the
 * 404 page (`verapdf-7-21-4-1` → `verapdf-7-21`), else to `verapdf`.
 */

/** `8.2.5.26` → `8-2-5-26`, as in rule ids. */
function clauseSlug(clause: string): string {
  return clause
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Clause ids with a page: core's clause families, plus the docs' example. */
export function clauseRuleIds(): string[] {
  const ids = veraPdfClauses.map((c) => `verapdf-${clauseSlug(c.clause)}`);
  // The example in the docs and in `overfull explain verapdf`.
  ids.push('verapdf-8-2-5-26');
  return [...new Set(ids)];
}

/** Clause pages as rules, sorted by clause number. */
export function clauseRules(): RuleInfo[] {
  return clauseRuleIds()
    .map((id) => getRule(id))
    .filter((r): r is RuleInfo => Boolean(r))
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}
