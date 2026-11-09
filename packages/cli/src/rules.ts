import { allRules, getRule, type RuleInfo } from '@overfull/core';

/** Rules the CLI itself emits (on top of @overfull/core's registry). */
export const cliRules: RuleInfo[] = [
  {
    id: 'bib-file-missing',
    check: 'references',
    severity: 'error',
    title: 'Bibliography file not found',
    summary:
      'A .bib file named in overfull.yml (`bib:`) or in `\\addbibresource`/`\\bibliography` does not exist, so its entries cannot be checked and LaTeX cannot use them.',
    fix: 'Fix the path in `bib:` (overfull.yml) or in `\\addbibresource`, relative to the project root.',
  },
  {
    id: 'refs-cache-ignored',
    check: 'references',
    severity: 'info',
    title: 'Committed reference cache ignored in CI',
    summary:
      'With `references.cache: project`, the lookup cache `.overfull/cache/refs.json` is tracked by git. In CI a committed cache could mark references as verified that were never looked up, so it is ignored and every reference is looked up again.',
    fix: 'Remove the cache from git (`git rm --cached .overfull/cache/refs.json`) and add `.overfull/` to .gitignore, or drop `references.cache: project`.',
  },
];

/** Every rule: core's plus the CLI's own, without duplicates. */
export function everyRule(): RuleInfo[] {
  const core = allRules();
  return [...core, ...cliRules.filter((r) => !core.some((c) => c.id === r.id))];
}

export function findRule(id: string): RuleInfo | undefined {
  return getRule(id) ?? cliRules.find((r) => r.id === id);
}
