import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import {
  CHECK_IDS,
  exitCodeFor,
  formatHuman,
  formatJson,
  formatMarkdown,
  formatSarif,
  githubAnnotations,
  neutralizeWorkflowCommands,
  oneLine,
  runCheck,
  sarifFallbackFile,
  stopCommands,
} from 'overfull';
import { upsertComment } from './comment.js';
import { readInputs } from './inputs.js';
import { escapeData, outputRecord } from './output.js';

function setOutput(name: string, value: string): void {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, outputRecord(name, value));
  else process.stdout.write(`${name}=${escapeData(value)}\n`);
}

async function main(): Promise<number> {
  const env = process.env;
  const workspace = env.GITHUB_WORKSPACE ?? process.cwd();
  const inputs = readInputs(env, workspace);
  for (const c of inputs.check.checks ?? []) {
    if (!(CHECK_IDS as readonly string[]).includes(c)) {
      throw new Error(`Unknown check "${c}" in input "checks"; use ${CHECK_IDS.join(', ')}`);
    }
  }
  const report = await runCheck(inputs.check);
  // Messages carry text from the log, PDF and .bib: never let a line act as a workflow
  // command. Neutralized, and printed inside stop-commands with a random token, so
  // the runner executes nothing from it even if a bypass of the neutralizer existed.
  const guard = stopCommands();
  process.stdout.write(
    `${guard.start}${neutralizeWorkflowCommands(formatHuman(report, { color: true, verbose: true }))}${guard.end}`,
  );

  if (inputs.annotations) {
    const root = relative(workspace, resolve(inputs.check.cwd ?? workspace)) || '.';
    for (const line of githubAnnotations(report, { root, limit: 50 }))
      process.stdout.write(`${line}\n`);
  }
  if (inputs.summary && env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${formatMarkdown(report)}\n`);
  }
  if (inputs.comment) {
    // formatMarkdown output is already neutralized; the comment is that text plus a marker.
    await upsertComment({
      env,
      markdown: formatMarkdown(report),
      token: inputs.githubToken,
      notice: (m) =>
        process.stdout.write(`::notice title=Overfull comment::${escapeData(oneLine(m))}\n`),
    });
  }
  const reportPath = join(env.RUNNER_TEMP ?? tmpdir(), 'overfull-report.json');
  writeFileSync(reportPath, formatJson(report));
  if (inputs.sarif) {
    const cwd = resolve(inputs.check.cwd ?? workspace);
    const fallbackFile = sarifFallbackFile(cwd, env);
    const sarifPath = resolve(workspace, inputs.sarif);
    mkdirSync(dirname(sarifPath), { recursive: true });
    writeFileSync(
      sarifPath,
      formatSarif(report, {
        root: relative(workspace, cwd) || '.',
        ...(fallbackFile ? { fallbackFile } : {}),
      }),
    );
    setOutput('sarif', sarifPath);
  }
  setOutput('status', report.status);
  setOutput('report', reportPath);
  return exitCodeFor(report, inputs.failOn);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(`::error title=Overfull preflight::${escapeData(oneLine(msg))}\n`);
    process.exitCode = 2;
  },
);
