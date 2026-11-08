import { allRules, type RuleInfo } from '@overfull/core';
import { caseForRule } from './corpus';

export const CHECK_ORDER = ['build', 'output', 'references', 'accessibility', 'venue'] as const;

export function rules(): RuleInfo[] {
  const seen = new Set<string>();
  return allRules().filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

export function rulesByCheck(): { check: string; rules: (RuleInfo & { hasCase: boolean })[] }[] {
  const all = rules();
  return CHECK_ORDER.map((check) => ({
    check,
    rules: all
      .filter((r) => r.check === check)
      .sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || a.title.localeCompare(b.title))
      .map((r) => ({ ...r, hasCase: Boolean(caseForRule(r.id, r.corpus)) })),
  }));
}

export function ruleExists(id: string): boolean {
  return rules().some((r) => r.id === id);
}

function sevRank(s: string): number {
  return s === 'error' ? 0 : s === 'warning' ? 1 : 2;
}
