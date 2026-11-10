import { oneLine, safeLines } from '@overfull/core';
import { buildCommand } from './commands/build.js';
import { checkCommand } from './commands/check.js';
import { citeCommand } from './commands/cite.js';
import { diffCommand } from './commands/diff.js';
import { doctorCommand } from './commands/doctor.js';
import { explainCommand } from './commands/explain.js';
import { guardCommand } from './commands/guard.js';
import { adoptCommand, initCommand } from './commands/init.js';
import { mcpCommand } from './commands/mcp.js';
import { pagesCommand } from './commands/pages.js';
import { closest } from './config.js';
import { type Io, UsageError } from './io.js';
import { inGitHubActions, neutralizingWriter, stopCommands } from './safety.js';
import { VERSION } from './version.js';

export const mainHelp = `overfull ${VERSION} — preflight for LaTeX papers and theses

Usage: overfull <command> [options]

Commands:
  init [thesis|paper|slides] [dir]   Create a project from a template
  adopt                              Add Overfull to the LaTeX project in this folder (init --here)
  build [main.tex]                   Compile with latexmk (local or Docker) and check the log
  check                              Check log, PDF, references, accessibility, venue rules
  cite <doi | arXiv:id | "title">    Add a verified BibTeX entry; prints its key
  pages <range>                      Render PDF pages to PNG (e.g. 3, 2-5, 1,4,7)
  diff [--base ref]                  Build a PDF marking changes since a git revision
  explain <rule>                     What a rule means and how to fix it
  doctor                             Show which tools are available
  guard --staged | --hook            Block hand-written .bib entries (git pre-commit, agent hooks)
  mcp                                Run as an MCP server on stdio (for agents without a shell)

Run \`overfull <command> --help\` for options. Docs: https://amet13.github.io/overfull/
`;

type Command = (args: string[], io: Io) => Promise<number>;

const COMMANDS: Record<string, Command> = {
  init: initCommand,
  adopt: adoptCommand,
  build: buildCommand,
  check: checkCommand,
  cite: (args, io) => citeCommand(args, io),
  pages: pagesCommand,
  diff: diffCommand,
  explain: explainCommand,
  doctor: doctorCommand,
  guard: (args, io) => guardCommand(args, io),
  mcp: (args, io) => mcpCommand(args, io, main),
};

/** Runs the CLI and returns the exit code (0 ok, 1 problems found, 2 usage/internal error). */
export async function main(argv: string[], ioIn: Io): Promise<number> {
  if (!inGitHubActions(ioIn.env)) return run(argv, ioIn);
  // In GitHub Actions, printed text (log excerpts, titles, file names, error
  // messages) must never be read as workflow commands. stderr is always
  // neutralized; stdout too, except for `check --annotations`, which prints
  // (escaped) commands on purpose. Other commands also run inside
  // stop-commands (written to stderr, so `--json`/`--markdown` stdout stays
  // clean); with --annotations that would silence the annotations themselves.
  const annotations = argv[0] === 'check' && argv.includes('--annotations');
  const io: Io = {
    ...ioIn,
    stdout: annotations ? ioIn.stdout : neutralizingWriter(ioIn.stdout),
    stderr: neutralizingWriter(ioIn.stderr),
  };
  if (annotations) return run(argv, io);
  const guard = stopCommands();
  ioIn.stderr(guard.start);
  try {
    return await run(argv, io);
  } finally {
    ioIn.stderr(guard.end);
  }
}

/** Untrusted text in an error message: each line made safe (no controls, no bidi overrides). */
const safeMessage = (s: string) => safeLines(s).join('\n');

async function run(argv: string[], io: Io): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    if (cmd === 'help' && rest[0] && COMMANDS[rest[0]]) return run([rest[0], '--help'], io);
    io.stdout(mainHelp);
    return 0;
  }
  if (cmd === '--version' || cmd === '-V' || cmd === 'version') {
    io.stdout(`${VERSION}\n`);
    return 0;
  }
  const command = COMMANDS[cmd];
  if (!command) {
    const hint = closest(cmd, Object.keys(COMMANDS));
    io.stderr(
      `Unknown command "${oneLine(cmd)}".${hint ? ` Did you mean \`overfull ${hint}\`?` : ''}\nRun \`overfull --help\` for the list of commands.\n`,
    );
    return 2;
  }
  if (rest.includes('--version') || rest.includes('-V')) {
    io.stdout(`${VERSION}\n`);
    return 0;
  }
  const json = rest.includes('--json');
  const jsonError = (code: 'usage' | 'internal', message: string) =>
    io.stdout(`${JSON.stringify({ error: { code, message } }, null, 2)}\n`);
  try {
    return await command(rest, io);
  } catch (err) {
    if (json) {
      // --json promises JSON on stdout, errors included.
      const usage = err instanceof UsageError;
      jsonError(usage ? 'usage' : 'internal', err instanceof Error ? err.message : String(err));
      return 2;
    }
    if (err instanceof UsageError) {
      io.stderr(`overfull ${cmd}: ${safeMessage(err.message)}\n`);
      return 2;
    }
    const msg =
      err instanceof Error
        ? io.env.OVERFULL_DEBUG
          ? (err.stack ?? err.message)
          : err.message
        : String(err);
    io.stderr(
      `overfull ${cmd}: internal error: ${safeMessage(msg)}\nSet OVERFULL_DEBUG=1 for a stack trace and report it at https://github.com/amet13/overfull/issues\n`,
    );
    return 2;
  }
}
