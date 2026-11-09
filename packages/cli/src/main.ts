import { buildCommand } from './commands/build.js';
import { checkCommand } from './commands/check.js';
import { citeCommand } from './commands/cite.js';
import { diffCommand } from './commands/diff.js';
import { doctorCommand } from './commands/doctor.js';
import { explainCommand } from './commands/explain.js';
import { initCommand } from './commands/init.js';
import { pagesCommand } from './commands/pages.js';
import { closest } from './config.js';
import { type Io, UsageError } from './io.js';
import { neutralizingWriter } from './safety.js';
import { VERSION } from './version.js';

export const mainHelp = `overfull ${VERSION} — preflight for LaTeX papers and theses

Usage: overfull <command> [options]

Commands:
  init [thesis|paper|slides] [dir]   Create a project from a template
  build [main.tex]                   Compile with latexmk (local or Docker) and check the log
  check                              Check log, PDF, references, accessibility, venue rules
  cite <doi | arXiv:id | "title">    Add a verified BibTeX entry; prints its key
  pages <range>                      Render PDF pages to PNG (e.g. 3, 2-5, 1,4,7)
  diff [--base ref]                  Build a PDF marking changes since a git revision
  explain <rule>                     What a rule means and how to fix it
  doctor                             Show which tools are available

Run \`overfull <command> --help\` for options. Docs: https://amet13.github.io/overfull/
`;

type Command = (args: string[], io: Io) => Promise<number>;

const COMMANDS: Record<string, Command> = {
  init: initCommand,
  build: buildCommand,
  check: checkCommand,
  cite: (args, io) => citeCommand(args, io),
  pages: pagesCommand,
  diff: diffCommand,
  explain: explainCommand,
  doctor: doctorCommand,
};

/** Runs the CLI and returns the exit code (0 ok, 1 problems found, 2 usage/internal error). */
export async function main(argv: string[], ioIn: Io): Promise<number> {
  const [cmd, ...rest] = argv;
  // In GitHub Actions, printed text (log excerpts, titles, file names) must not
  // be read as workflow commands. `check --annotations` prints them on purpose,
  // escaped by githubAnnotations.
  const io: Io =
    ioIn.env.GITHUB_ACTIONS === 'true' && !rest.includes('--annotations')
      ? {
          ...ioIn,
          stdout: neutralizingWriter(ioIn.stdout),
          stderr: neutralizingWriter(ioIn.stderr),
        }
      : ioIn;
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    if (cmd === 'help' && rest[0] && COMMANDS[rest[0]]) return main([rest[0], '--help'], ioIn);
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
      `Unknown command "${cmd}".${hint ? ` Did you mean \`overfull ${hint}\`?` : ''}\nRun \`overfull --help\` for the list of commands.\n`,
    );
    return 2;
  }
  if (rest.includes('--version') || rest.includes('-V')) {
    io.stdout(`${VERSION}\n`);
    return 0;
  }
  try {
    return await command(rest, io);
  } catch (err) {
    if (err instanceof UsageError) {
      io.stderr(`overfull ${cmd}: ${err.message}\n`);
      return 2;
    }
    const msg =
      err instanceof Error
        ? io.env.OVERFULL_DEBUG
          ? (err.stack ?? err.message)
          : err.message
        : String(err);
    io.stderr(
      `overfull ${cmd}: internal error: ${msg}\nSet OVERFULL_DEBUG=1 for a stack trace and report it at https://github.com/amet13/overfull/issues\n`,
    );
    return 2;
  }
}
