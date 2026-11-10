/**
 * Every `overfull …` command quoted in a fenced code block of the README, the guide and
 * the templates' READMEs must name a real command and only flags that command's
 * `--help` lists. Catches docs that drift from the CLI. Offline: nothing is run but --help.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main } from '../src/main.js';
import { memIo, tempDir } from './helpers.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const files = [
  'README.md',
  ...readdirSync(join(repo, 'docs/guide'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `docs/guide/${f}`),
  ...['thesis', 'paper', 'slides'].map((t) => `templates/${t}/README.md`),
];

interface Use {
  file: string;
  line: number;
  text: string;
  command: string;
  flags: string[];
}

/** `overfull` invocations in fenced code blocks (not prose, not JSON). */
function uses(): Use[] {
  const out: Use[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(join(repo, file), 'utf8');
    } catch {
      continue;
    }
    let fence: string | undefined;
    text.split('\n').forEach((raw, i) => {
      const m = /^\s*(```+)(\w*)/.exec(raw);
      if (m) {
        fence = fence ? undefined : (m[2] ?? '');
        return;
      }
      if (fence === undefined || !['', 'sh', 'bash', 'shell', 'console', 'text'].includes(fence))
        return;
      // A command may follow a prompt or a pipe, e.g. `$ overfull check` or `… | overfull`.
      const line = raw.replace(/#.*$/, '').replace(/^\s*\$\s*/, '');
      for (const part of line.split(/&&|\|\||;|\|/)) {
        const words = part.trim().split(/\s+/);
        if (words[0] !== 'overfull' || !words[1] || words[1].startsWith('<')) continue;
        // Sample report output (`overfull paper.pdf  FAIL`), not a command.
        if (/\b(PASS|WARN|FAIL)\s*$/.test(part)) continue;
        if (words[1].startsWith('-')) {
          out.push({ file, line: i + 1, text: raw.trim(), command: '', flags: [words[1]] });
          continue;
        }
        const flags = words
          .slice(2)
          .filter((w) => /^--?[a-z]/i.test(w))
          .map((w) => w.split('=')[0] as string)
          .filter((w) => !/^-[a-z]$/i.test(w) || w === '-h' || w === '-v');
        out.push({ file, line: i + 1, text: raw.trim(), command: words[1], flags });
      }
    });
  }
  return out;
}

async function helpOf(command: string): Promise<string> {
  const io = memIo(tempDir());
  await main(command ? [command, '--help'] : ['--help'], io);
  return io.stdoutText();
}

describe('commands quoted in the docs', () => {
  const found = uses();

  it('finds commands to check', () => {
    expect(found.length).toBeGreaterThan(40);
  });

  it('name real commands and only flags their --help lists', async () => {
    const top = await helpOf('');
    const helps = new Map<string, string>();
    const wrong: string[] = [];
    for (const u of found) {
      if (!u.command) {
        if (!['--version', '--help', '-h', '-v'].includes(u.flags[0] ?? ''))
          wrong.push(`${u.file}:${u.line} unknown option ${u.flags[0]}: ${u.text}`);
        continue;
      }
      if (!new RegExp(`^\\s+${u.command}\\b`, 'm').test(top)) {
        wrong.push(`${u.file}:${u.line} unknown command "${u.command}": ${u.text}`);
        continue;
      }
      if (!helps.has(u.command)) helps.set(u.command, await helpOf(u.command));
      const help = helps.get(u.command) as string;
      for (const f of u.flags) {
        if (f === '--help' || f === '-h' || f === '--json') continue;
        if (
          !new RegExp(`(^|[\\s,\\[|])${f.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}\\b`, 'm').test(
            help,
          )
        )
          wrong.push(`${u.file}:${u.line} \`overfull ${u.command}\` has no ${f}: ${u.text}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
