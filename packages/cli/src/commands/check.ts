import { formatHuman, formatJson, formatMarkdown, githubAnnotations } from '@overfull/core';
import { list, parse, str } from '../args.js';
import { exitCodeFor, runCheck } from '../check.js';
import { parseChecks } from '../config.js';
import { type Io, UsageError, useColor } from '../io.js';

export const checkHelp = `Usage: overfull check [options]

Check the built document: build log, PDF output, references, accessibility, venue rules.
Reads <jobname>.log / .pdf / .aux and the .bib files named in overfull.yml.

Options:
  --checks a,b        Only these checks (build, output, references, accessibility, venue)
  --profile name      Venue profile: generic, thesis, paper, arxiv, double-blind
  --offline           Do not look references up online
  --fail-on level     error (default), warning or never
  --json              Print the report as JSON (stable, for agents and scripts)
  --markdown          Print a Markdown summary (GitHub job summary / PR comment)
  --annotations       Print GitHub workflow annotations
  --verbose, -v       Show why and how to fix each problem
  --pdf file          PDF to check (default <jobname>.pdf)
  --log file          Build log (default <jobname>.log)
  --aux file          .aux file (default <jobname>.aux)
  --bib a.bib,b.bib   Bibliography files (default from overfull.yml or main.tex)
  --mailto address    Contact address for CrossRef's polite pool
  --no-verapdf        Do not run veraPDF even if installed
  --config file       Config file (default overfull.yml)
  -h, --help          Show this help

Exit codes: 0 pass (or warnings without --fail-on warning), 1 fail, 2 usage error.
`;

export async function checkCommand(args: string[], io: Io): Promise<number> {
  const { values } = parse(
    args,
    {
      checks: { type: 'string' },
      profile: { type: 'string' },
      offline: { type: 'boolean' },
      'fail-on': { type: 'string' },
      json: { type: 'boolean' },
      markdown: { type: 'boolean' },
      annotations: { type: 'boolean' },
      verbose: { type: 'boolean', short: 'v' },
      pdf: { type: 'string' },
      log: { type: 'string' },
      aux: { type: 'string' },
      bib: { type: 'string' },
      mailto: { type: 'string' },
      'no-verapdf': { type: 'boolean' },
      config: { type: 'string' },
    },
    'check',
  );
  if (values.help) {
    io.stdout(checkHelp);
    return 0;
  }
  const failOn = str(values['fail-on']) ?? 'error';
  if (!['error', 'warning', 'never'].includes(failOn)) {
    throw new UsageError(`--fail-on must be error, warning or never, got "${failOn}"`);
  }
  const formats = ['json', 'markdown', 'annotations'].filter((f) => values[f]);
  if (formats.length > 1) throw new UsageError(`Choose one output format, not ${formats.map((f) => `--${f}`).join(' and ')}`);
  const checksArg = list(values.checks);
  const report = await runCheck({
    cwd: io.cwd,
    env: io.env,
    ...(io.fetch ? { fetch: io.fetch } : {}),
    ...(str(values.config) ? { config: str(values.config) } : {}),
    ...(checksArg ? { checks: parseChecks(checksArg, '--checks', '--checks') } : {}),
    ...(str(values.profile) ? { profile: str(values.profile) } : {}),
    ...(str(values.pdf) ? { pdf: str(values.pdf) } : {}),
    ...(str(values.log) ? { log: str(values.log) } : {}),
    ...(str(values.aux) ? { aux: str(values.aux) } : {}),
    ...(list(values.bib) ? { bib: list(values.bib) } : {}),
    ...(str(values.mailto) ? { mailto: str(values.mailto) } : {}),
    offline: values.offline === true,
    verapdf: values['no-verapdf'] !== true,
  });
  if (values.json) io.stdout(formatJson(report));
  else if (values.markdown) io.stdout(formatMarkdown(report));
  else if (values.annotations) {
    const lines = githubAnnotations(report);
    io.stdout(lines.length ? `${lines.join('\n')}\n` : '');
  } else io.stdout(formatHuman(report, { color: useColor(io), verbose: values.verbose === true }));
  return exitCodeFor(report, failOn as 'error' | 'warning' | 'never');
}
