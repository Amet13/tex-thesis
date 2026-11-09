#!/usr/bin/env node
// Runs agent tasks against Overfull templates and scores the result with `overfull check`.
//
//   node evals/run.mjs --agent "claude -p {prompt} --permission-mode acceptEdits" \
//     [--variant kit|bare|both] [--image ghcr.io/amet13/overfull:3] [--task id] [--runs 1]
//
// "kit"  = template as shipped (AGENTS.md, skills, overfull CLI in the image).
// "bare" = same template with AGENTS.md, CLAUDE.md and skills removed.
// The agent command runs on the host inside the copied project; {prompt} is shell-quoted.
// Scoring always happens in the Docker image, so every variant is judged identically.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const { values } = parseArgs({
  options: {
    agent: { type: 'string' },
    variant: { type: 'string', default: 'both' },
    image: { type: 'string', default: process.env.OVERFULL_IMAGE ?? 'ghcr.io/amet13/overfull:3' },
    task: { type: 'string', multiple: true },
    runs: { type: 'string', default: '1' },
    keep: { type: 'boolean', default: false },
    out: { type: 'string', default: join(root, 'evals', 'results.json') },
  },
});

if (!values.agent) {
  console.error('Missing --agent "<command with {prompt}>". See evals/README.md.');
  process.exit(2);
}

const tasks = readdirSync(join(root, 'evals', 'tasks'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(root, 'evals', 'tasks', f), 'utf8')))
  .filter((t) => !values.task || values.task.includes(t.id));
const variants = values.variant === 'both' ? ['kit', 'bare'] : [values.variant];
const runs = Number(values.runs);

const shellQuote = (s) => `'${s.replaceAll("'", `'\\''`)}'`;

function prepare(task, variant) {
  const dir = mkdtempSync(join(tmpdir(), `overfull-eval-${task.id}-${variant}-`));
  cpSync(join(root, 'templates', task.template), dir, { recursive: true, verbatimSymlinks: true });
  if (variant === 'bare') {
    for (const p of ['AGENTS.md', 'CLAUDE.md', '.agents', '.claude'])
      rmSync(join(dir, p), { recursive: true, force: true });
  }
  for (const [file, patch] of Object.entries(task.setup ?? {})) {
    const path = join(dir, file);
    const current = existsSync(path) ? (parseYaml(readFileSync(path, 'utf8')) ?? {}) : {};
    writeFileSync(path, stringifyYaml(deepMerge(current, patch)));
  }
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync(
    'git',
    ['-c', 'user.email=eval@overfull', '-c', 'user.name=eval', 'commit', '-qm', 'start'],
    { cwd: dir },
  );
  return dir;
}

function deepMerge(a, b) {
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b || Array.isArray(b)) return b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = deepMerge(a[k], v);
  return out;
}

function docker(dir, args) {
  return spawnSync(
    'docker',
    ['run', '--rm', '-v', `${dir}:/work`, '-w', '/work', values.image, ...args],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
}

function score(task, dir) {
  docker(dir, ['overfull', 'build']);
  const res = docker(dir, ['overfull', 'check', '--json', '--fail-on', 'never']);
  let report;
  try {
    report = JSON.parse(res.stdout);
  } catch {
    return { pass: false, reason: 'no report', stderr: res.stderr.slice(-2000) };
  }
  const problems = report.checks.flatMap((c) => c.problems);
  const errors = problems.filter((p) => p.severity === 'error');
  const firedRules = new Set(problems.map((p) => p.rule));
  const failures = [];
  if (!task.expect.status.includes(report.status)) failures.push(`status ${report.status}`);
  if (errors.length > task.expect.maxErrors) failures.push(`${errors.length} errors`);
  for (const r of task.expect.noRules ?? []) if (firedRules.has(r)) failures.push(`rule ${r}`);
  if (task.expect.citedAtLeast) {
    const refs = report.checks.find((c) => c.check === 'references');
    const cited = refs?.stats?.cited ?? 0;
    if (cited < task.expect.citedAtLeast) failures.push(`only ${cited} cited`);
  }
  return {
    pass: failures.length === 0,
    failures,
    status: report.status,
    errors: errors.map((e) => e.rule),
  };
}

const results = [];
for (const task of tasks) {
  for (const variant of variants) {
    for (let i = 0; i < runs; i++) {
      const dir = prepare(task, variant);
      const cmd = values.agent.replaceAll('{prompt}', shellQuote(task.prompt));
      const started = Date.now();
      const agent = spawnSync('bash', ['-lc', cmd], {
        cwd: dir,
        encoding: 'utf8',
        timeout: 30 * 60 * 1000,
      });
      const result = {
        task: task.id,
        variant,
        run: i + 1,
        seconds: Math.round((Date.now() - started) / 1000),
        agentExit: agent.status,
        ...score(task, dir),
      };
      results.push(result);
      console.log(
        `${result.pass ? 'PASS' : 'FAIL'}  ${task.id.padEnd(16)} ${variant.padEnd(4)} run ${i + 1}  ${result.failures?.join(', ') ?? ''}`,
      );
      if (!values.keep) rmSync(dir, { recursive: true, force: true });
      else console.log(`      kept ${dir}`);
    }
  }
}

const summary = Object.fromEntries(
  variants.map((v) => {
    const rs = results.filter((r) => r.variant === v);
    return [v, { passed: rs.filter((r) => r.pass).length, total: rs.length }];
  }),
);
writeFileSync(
  values.out,
  `${JSON.stringify({ date: new Date().toISOString(), agent: values.agent, summary, results }, null, 2)}\n`,
);
console.log('\nSummary:', JSON.stringify(summary));
