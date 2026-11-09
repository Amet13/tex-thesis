import type { RuleInfo } from '@overfull/core';
import { parse } from '../args.js';
import { closest } from '../config.js';
import { type Io, UsageError, useColor } from '../io.js';
import { everyRule, findRule } from '../rules.js';

export const explainHelp = `Usage: overfull explain <rule> [--json]

Explain a rule: what it means and how to fix it. Rule ids appear in every
problem Overfull reports. \`overfull explain --list\` lists all rules.

Options:
  --list          List every rule id with its title
  --json          Print the rule (or the list) as JSON; an unknown rule prints {error}
  -h, --help      Show this help
`;

function format(rule: RuleInfo, color: boolean): string {
  const b = (s: string) => (color ? `\u001b[1m${s}\u001b[22m` : s);
  const d = (s: string) => (color ? `\u001b[2m${s}\u001b[22m` : s);
  return [
    `${b(rule.id)}  ${d(`${rule.check} · ${rule.severity}`)}`,
    rule.title,
    '',
    rule.summary,
    '',
    `${b('Fix:')} ${rule.fix}`,
    ...(rule.corpus ? ['', d(`Example: corpus/${rule.corpus}`)] : []),
    '',
  ].join('\n');
}

export async function explainCommand(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parse(
    args,
    { json: { type: 'boolean' }, list: { type: 'boolean' } },
    'explain',
  );
  if (values.help) {
    io.stdout(explainHelp);
    return 0;
  }
  if (values.list) {
    const rules = everyRule();
    if (values.json) io.stdout(`${JSON.stringify(rules, null, 2)}\n`);
    else {
      const w = Math.max(...rules.map((r) => r.id.length)) + 2;
      io.stdout(
        `${rules.map((r) => `${r.id.padEnd(w)}${r.check.padEnd(14)}${r.title}`).join('\n')}\n`,
      );
    }
    return 0;
  }
  const id = positionals[0]?.trim();
  if (!id)
    throw new UsageError(
      'Give a rule id, e.g. `overfull explain undefined-control-sequence` (or --list).',
    );
  const rule = findRule(id);
  if (!rule) {
    const ids = everyRule().map((r) => r.id);
    const near = new Set<string>();
    const best = closest(id, ids);
    if (best) near.add(best);
    for (const r of ids) if (r.includes(id) || id.includes(r)) near.add(r);
    const list = [...near].slice(0, 8);
    throw new UsageError(
      `Unknown rule "${id}".${list.length ? ` Did you mean:\n${list.map((r) => `  ${r}`).join('\n')}` : ''}\n` +
        'Run `overfull explain --list` to see all rules.',
    );
  }
  io.stdout(values.json ? `${JSON.stringify(rule, null, 2)}\n` : format(rule, useColor(io)));
  return 0;
}
