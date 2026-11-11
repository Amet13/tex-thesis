import { oneLine, type RefsOptions } from '@overfull/core';
import { parse } from '../args.js';
import { HOOK_HARNESSES, type HookHarness, MAX_PAYLOAD_BYTES, runHook } from '../guard/hook.js';
import { guardStaged } from '../guard/staged.js';
import { type Io, UsageError } from '../io.js';

export const guardHelp = `Usage: overfull guard --staged [--offline] [--json]
       overfull guard --hook [claude|gemini|codex]

Blocks hand-written bibliography entries at the moment they happen.

--staged   For a git pre-commit hook. Looks at the staged changes to .bib files and
           checks every entry that was added or changed. An entry passes when it:
             - was added by \`overfull cite\` (valid x-overfull marker), or
             - carries note = {overfull: author-provided} or overfull: skip, or
             - is found in the indexes (doi.org, CrossRef, dblp, arXiv, ...).
           Removed entries and whitespace or order changes pass. Otherwise the commit
           is refused and, per entry, the \`overfull cite\` command to use is printed.
           Works before the first commit.
--hook     For an AI agent's pre-tool-use hook. Reads the hook payload (JSON) from
           stdin and denies direct writes and edits of .bib files by the agent's file
           tools, with a reason that points to \`overfull cite\`. Everything else is
           allowed. A payload that is not recognised is allowed (exit 0, no output).
           Supported: claude (Claude Code), gemini (Gemini CLI), codex (Codex CLI). Without a name the
           harness is detected from the payload. A shell command that writes a .bib
           file is not detected; the pre-commit guard and \`overfull check\` catch it.

Options:
  --offline   With --staged: do not ask the indexes; an entry needs provenance or a note
  --json      With --staged: print the result as JSON
  -h, --help  Show this help

Exit codes: 0 pass, 1 blocked, 2 usage or internal error (--hook always exits 0).
Setup: see docs/guide/with-an-agent.md ("Guard"). \`overfull init --here --agents\` writes
the hook settings, \`--hooks\` installs a git pre-commit hook.
`;

/** Reads stdin to the end, up to the payload limit (more than that is returned as too large). */
async function readProcessStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += b.length;
    if (size > MAX_PAYLOAD_BYTES) return ' '.repeat(MAX_PAYLOAD_BYTES + 1);
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function guardCommand(
  args: string[],
  io: Io,
  readStdin: () => Promise<string> = readProcessStdin,
): Promise<number> {
  // `--hook` takes an optional harness name; parseArgs wants a value, so pull it out first.
  const hookAt = args.indexOf('--hook');
  let harness: HookHarness | undefined;
  let rest = args;
  if (hookAt >= 0) {
    const next = args[hookAt + 1];
    rest = args.filter((_, i) => i !== hookAt);
    if (next !== undefined && !next.startsWith('-')) {
      if (!(HOOK_HARNESSES as readonly string[]).includes(next))
        throw new UsageError(
          `Unknown harness "${oneLine(next)}" for --hook. Choose ${HOOK_HARNESSES.join(' or ')}.`,
        );
      harness = next as HookHarness;
      rest = rest.filter((_, i) => i !== hookAt);
    }
  }
  const { values } = parse(
    rest,
    { staged: { type: 'boolean' }, offline: { type: 'boolean' }, json: { type: 'boolean' } },
    'guard',
  );
  if (values.help) {
    io.stdout(guardHelp);
    return 0;
  }
  const hook = hookAt >= 0;
  const staged = values.staged === true;
  if (hook === staged) throw new UsageError('Choose one of --staged or --hook.');

  if (hook) {
    // Fail open: whatever goes wrong here must not stop the agent's other tools.
    try {
      const { output } = runHook(await readStdin(), harness, io.cwd);
      if (output) io.stdout(output);
    } catch {
      // allow
    }
    return 0;
  }

  const refs: RefsOptions = io.fetch ? { fetch: io.fetch } : {};
  let report: Awaited<ReturnType<typeof guardStaged>>;
  try {
    report = await guardStaged({ cwd: io.cwd, offline: values.offline === true, refs });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new Error(
      code === 'ENOENT'
        ? 'git was not found on PATH.'
        : `could not read the staged changes (is this a git repository?): ${err instanceof Error ? oneLine(err.message) : String(err)}`,
    );
  }
  if (values.json) {
    io.stdout(`${JSON.stringify(report, null, 2)}\n`);
    return report.status === 'pass' ? 0 : 1;
  }
  if (report.status === 'pass') {
    io.stdout(
      report.checked === 0
        ? 'overfull guard: no new or changed .bib entries.\n'
        : `overfull guard: ${report.checked} new or changed .bib ${report.checked === 1 ? 'entry' : 'entries'} checked, all fine.\n`,
    );
    return 0;
  }
  const lines = [
    `overfull guard: commit refused. ${report.blocked.length} .bib ${report.blocked.length === 1 ? 'entry was' : 'entries were'} written by hand and not verified.`,
    '',
  ];
  for (const b of report.blocked) {
    lines.push(
      `${oneLine(b.file)}:${b.line}  ${oneLine(b.key)}`,
      `  ${b.reason}`,
      `  add it properly:  ${oneLine(b.cite)}`,
      `  or, if you wrote it yourself, add to the entry:  ${b.authorProvided}`,
      '',
    );
  }
  lines.push('Then stage the file again and commit.');
  io.stderr(`${lines.join('\n')}\n`);
  return 1;
}
