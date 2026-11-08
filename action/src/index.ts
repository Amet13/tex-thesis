import { appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import {
  CHECK_IDS,
  exitCodeFor,
  formatHuman,
  formatJson,
  formatMarkdown,
  githubAnnotations,
  runCheck,
} from 'overfull';
import { readInputs } from './inputs.js';

const escapeData = (s: string) =>
  s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

function setOutput(name: string, value: string): void {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${name}<<__OVERFULL_EOF__\n${value}\n__OVERFULL_EOF__\n`);
  else process.stdout.write(`${name}=${value}\n`);
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
  process.stdout.write(formatHuman(report, { color: true, verbose: true }));

  if (inputs.annotations) {
    const root = relative(workspace, resolve(inputs.check.cwd ?? workspace)) || '.';
    for (const line of githubAnnotations(report, { root, limit: 50 }))
      process.stdout.write(`${line}\n`);
  }
  if (inputs.summary && env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${formatMarkdown(report)}\n`);
  }
  const reportPath = join(env.RUNNER_TEMP ?? tmpdir(), 'overfull-report.json');
  writeFileSync(reportPath, formatJson(report));
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
    process.stdout.write(`::error title=Overfull preflight::${escapeData(msg)}\n`);
    process.exitCode = 2;
  },
);
