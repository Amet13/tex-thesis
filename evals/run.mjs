#!/usr/bin/env node
// Runs agent tasks on Overfull projects and scores the result. See evals/README.md.
//
//   node evals/run.mjs --agent "claude -p {prompt} --permission-mode acceptEdits" \
//     --label claude-code --model "<model name as the vendor states it>" --runs 3
//   node evals/run.mjs --dry-run          # validate every task and variant; no agent, no Docker
//
// Options: --variant bare,instructions,guard|all (default all; `kit` = instructions), --task id (repeatable),
//   --image <overfull image>, --keep (keep working directories), --out <dir> (default evals/results),
//   --timeout-min <n> (per agent run, default 30).
// The agent command runs on the host inside the working directory; {prompt} is shell-quoted.
// Scoring runs `overfull build` and `overfull check` in the Docker image, so every variant is judged alike.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { prepare } from './lib/prepare.mjs';
import { checkExpectations, parseNumstat, refProblems, scoreScope } from './lib/score.mjs';
import { proportion } from './lib/stats.mjs';
import { loadTasks, resolveVariants, validateTask } from './lib/tasks.mjs';

const root = resolve(import.meta.dirname, '..');
const { values } = parseArgs({
  options: {
    agent: { type: 'string' },
    label: { type: 'string' },
    model: { type: 'string' },
    variant: { type: 'string', default: 'all' },
    image: { type: 'string', default: process.env.OVERFULL_IMAGE ?? 'ghcr.io/amet13/overfull:3' },
    task: { type: 'string', multiple: true },
    runs: { type: 'string', default: '1' },
    keep: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    out: { type: 'string', default: join(root, 'evals', 'results') },
    'timeout-min': { type: 'string', default: '30' },
  },
});

function usage(message) {
  console.error(`${message}\nSee evals/README.md.`);
  process.exit(2);
}

let tasks;
let variants;
try {
  variants = resolveVariants(values.variant);
  tasks = loadTasks(root, values.task);
} catch (e) {
  usage(e.message);
}

// ---- validation (always) ----
let invalid = 0;
for (const t of tasks) {
  const errs = validateTask(root, t);
  if (errs.length) {
    invalid++;
    for (const e of errs) console.error(`INVALID ${t.id}: ${e}`);
  }
}
if (invalid) process.exit(1);

if (values['dry-run']) {
  let bad = 0;
  for (const t of tasks) {
    const row = [];
    for (const v of variants) {
      try {
        const { dir, notes, effective } = prepare(root, t, v);
        row.push(effective === v ? v : `${v}->${effective}`);
        for (const n of notes) console.log(`  note ${t.id}: ${n}`);
        rmSync(dir, { recursive: true, force: true });
      } catch (e) {
        bad++;
        console.error(`FAIL ${t.id} (${v}): ${e.message}`);
      }
    }
    console.log(`ok   ${t.id.padEnd(26)} ${t.template ?? t.project}  [${row.join(', ')}]`);
  }
  console.log(
    `\n${tasks.length} tasks x ${variants.length} variants prepared${bad ? `, ${bad} failed` : ''}. No agent was called and Docker was not used.`,
  );
  process.exit(bad ? 1 : 0);
}

// ---- real run ----
if (!values.agent) usage('Missing --agent "<command with {prompt}>".');
if (!values.agent.includes('{prompt}')) usage('--agent must contain {prompt}.');
if (!values.label || !/^[a-z0-9][a-z0-9._-]*$/i.test(values.label))
  usage('Missing --label (letters, digits, dot, dash, underscore), e.g. --label claude-code.');
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1) usage('--runs must be a positive integer.');

const shellQuote = (s) => `'${s.replaceAll("'", `'\\''`)}'`;
const docker = (dir, args) =>
  spawnSync('docker', ['run', '--rm', '-v', `${dir}:/work`, '-w', '/work', values.image, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
const git = (dir, args) =>
  spawnSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function scoreRun(task, dir) {
  // The change set first: the build below only adds ignored files, but measure what the agent left.
  git(dir, ['add', '-A']);
  const scope = scoreScope(
    parseNumstat(git(dir, ['diff', '--cached', '--no-renames', '--numstat', 'HEAD']).stdout),
    task,
  );

  docker(dir, ['overfull', 'build']);
  const res = docker(dir, ['overfull', 'check', '--json', '--fail-on', 'never']);
  let report;
  try {
    report = JSON.parse(res.stdout);
  } catch {
    return {
      pass: false,
      clean: false,
      failures: ['no report'],
      stderr: res.stderr.slice(-2000),
      ...scope,
      fabricated: [],
      unverified: [],
    };
  }
  const failures = checkExpectations(task, report, dir, root);
  const { fabricated, unverified } = refProblems(report);
  const maxUnverified = task.expect.maxUnverified ?? 0;
  const unverifiedFailures =
    fabricated.length + unverified.length > maxUnverified
      ? [
          `${fabricated.length + unverified.length} cited references not verified (${[...fabricated, ...unverified].join(', ')})`,
        ]
      : [];
  const pass = failures.length === 0;
  return {
    pass,
    // `clean` adds what a person reviewing the change would care about: nothing unverified in the bibliography,
    // nothing changed or written where the task did not ask for it.
    clean: pass && scope.ok && unverifiedFailures.length === 0,
    failures: [...failures, ...unverifiedFailures, ...scope.failures],
    status: report.status,
    errors: (report.checks ?? [])
      .flatMap((c) => c.problems ?? [])
      .filter((p) => p.severity === 'error')
      .map((p) => p.rule),
    fabricated,
    unverified,
    ...scope,
  };
}

const date = new Date().toISOString();
const results = [];
for (const task of tasks) {
  for (const variant of variants) {
    for (let i = 0; i < runs; i++) {
      const { dir, notes, effective } = prepare(root, task, variant);
      const cmd = values.agent.replaceAll('{prompt}', shellQuote(task.prompt));
      const started = Date.now();
      const agent = spawnSync('bash', ['-lc', cmd], {
        cwd: dir,
        encoding: 'utf8',
        timeout: Number(values['timeout-min']) * 60 * 1000,
        maxBuffer: 64 * 1024 * 1024,
      });
      const seconds = Math.round((Date.now() - started) / 1000);
      const result = {
        task: task.id,
        variant,
        effectiveVariant: effective,
        ...(notes.length ? { notes } : {}),
        run: i + 1,
        seconds,
        agentExit: agent.status,
        ...scoreRun(task, dir),
      };
      results.push(result);
      console.log(
        `${result.pass ? 'PASS' : 'FAIL'}${result.clean ? ' clean' : '      '}  ${task.id.padEnd(26)} ${variant.padEnd(12)} run ${i + 1}  ${result.failures.join('; ')}`,
      );
      if (!values.keep) rmSync(dir, { recursive: true, force: true });
      else console.log(`      kept ${dir}`);
    }
  }
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const cell = (rs) => ({
  n: rs.length,
  pass: proportion(rs.filter((r) => r.pass).length, rs.length),
  clean: proportion(rs.filter((r) => r.clean).length, rs.length),
  meanFabricatedOrUnverified: mean(rs.map((r) => r.fabricated.length + r.unverified.length)),
  meanFilesOutside: mean(rs.map((r) => r.filesOutside.length)),
  meanProseOutsideAdded: mean(rs.map((r) => r.proseOutsideAdded)),
  meanSeconds: mean(rs.map((r) => r.seconds)),
});
const summary = tasks.flatMap((t) =>
  variants.map((v) => ({
    task: t.id,
    variant: v,
    ...cell(results.filter((r) => r.task === t.id && r.variant === v)),
  })),
);
const byVariant = variants.map((v) => ({
  variant: v,
  ...cell(results.filter((r) => r.variant === v)),
}));

mkdirSync(values.out, { recursive: true });
// Never overwrite an earlier run: create the file exclusively ('wx'), and on a name
// already taken try the next suffix (no existence check before the write).
const resultsText = `${JSON.stringify(
  {
    schema: 1,
    date,
    label: values.label,
    model: values.model ?? null,
    agentCommand: values.agent,
    image: values.image,
    runsPerCell: runs,
    variants,
    tasks: tasks.map((t) => t.id),
    summary,
    byVariant,
    results,
  },
  null,
  2,
)}\n`;
let file;
for (let n = 1; !file; n++) {
  const candidate = join(
    values.out,
    `${date.slice(0, 10)}-${values.label}${n === 1 ? '' : `-${n}`}.json`,
  );
  try {
    writeFileSync(candidate, resultsText, { flag: 'wx' });
    file = candidate;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}
console.log(`\nwrote ${file}`);
for (const b of byVariant)
  console.log(
    `${b.variant.padEnd(12)} pass ${b.pass.k}/${b.pass.n}  clean ${b.clean.k}/${b.clean.n}`,
  );
