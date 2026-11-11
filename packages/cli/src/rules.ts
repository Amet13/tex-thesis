import { allRules, getRule, type RuleInfo } from '@overfull/core';

/** Rules the CLI itself emits beyond @overfull/core's registry (currently none; all live in core). */
const cliRules: RuleInfo[] = [];

/** Every rule: core's plus the CLI's own, without duplicates. */
export function everyRule(): RuleInfo[] {
  const core = allRules();
  return [...core, ...cliRules.filter((r) => !core.some((c) => c.id === r.id))];
}

export function findRule(id: string): RuleInfo | undefined {
  return getRule(id) ?? cliRules.find((r) => r.id === id);
}
