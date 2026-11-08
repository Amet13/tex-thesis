#!/usr/bin/env node
// Corpus runner for the build-log rules.
//
//   node scripts/corpus.mjs --capture [id...]   compile cases in Docker, write corpus/<id>/main.log
//   node scripts/corpus.mjs --verify  [id...]   recompile into a temp dir and check that the
//                                               expected rules fire (and fixed.tex is clean)
//   node scripts/corpus.mjs --check   [id...]   check the committed main.log files only (no Docker)
//
// The TeX Live image can be overridden with OVERFULL_TEX_IMAGE. Runs with plain `node` (>= 22.18):
// the TypeScript sources of @overfull/core are loaded through Node's built-in type stripping.

import { spawn } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_IMAGE =
  'texlive/texlive:latest@sha256:6530544393bd37b4aec8801292231ff61599aca43a04571306479a21591e87dd';
const IMAGE = process.env.OVERFULL_TEX_IMAGE || DEFAULT_IMAGE;
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CORPUS = join(ROOT, 'corpus');
const CONCURRENCY = Number(process.env.OVERFULL_CORPUS_JOBS || 4);
const ENGINES = new Set(['lualatex', 'pdflatex', 'xelatex']);
/** Files that describe a case rather than belong to the document. */
const CASE_ONLY_FILES = new Set(['case.json', 'main.log', 'fixed.tex']);

// The core sources use `.js` import specifiers (TypeScript NodeNext style). Map them to the `.ts`
// files so Node's type stripping can load the sources directly, without a build step.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const relative = specifier.startsWith('./') || specifier.startsWith('../');
      if (error?.code === 'ERR_MODULE_NOT_FOUND' && relative && specifier.endsWith('.js')) {
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      }
      throw error;
    }
  },
});

const originalEmit = process.emit;
process.emit = function quietTypeStripping(event, warning, ...rest) {
  if (event === 'warning' && warning?.name === 'ExperimentalWarning') return false;
  return originalEmit.call(this, event, warning, ...rest);
};

const { analyzeLog } = await import('../packages/core/src/log/index.ts');

async function loadCases(ids) {
  const names = (await readdir(CORPUS, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const unknown = ids.filter((id) => !names.includes(id));
  if (unknown.length > 0) throw new Error(`unknown corpus case(s): ${unknown.join(', ')}`);
  const selected = ids.length > 0 ? ids : names;
  return Promise.all(selected.map(loadCase));
}

async function loadCase(id) {
  const dir = join(CORPUS, id);
  const spec = JSON.parse(await readFile(join(dir, 'case.json'), 'utf8'));
  if (!ENGINES.has(spec.engine)) throw new Error(`${id}: unknown engine ${spec.engine}`);
  const files = await readdir(dir);
  return { id, dir, spec, hasFixed: files.includes('fixed.tex') };
}

function commandFor(spec) {
  const flags = ['-interaction=nonstopmode', ...(spec.flags ?? [])];
  if (spec.run === 'once') return [spec.engine, ...flags, 'main.tex'];
  return ['latexmk', `-${spec.engine}`, ...flags, 'main.tex'];
}

function run(cmd, args) {
  return new Promise((done) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', (error) => done({ code: -1, output: String(error) }));
    child.on('close', (code) => done({ code, output }));
  });
}

/** Compiles a case (or its fixed.tex) in a scratch copy and returns the log text. */
async function compile(testCase, { fixed = false } = {}) {
  const work = await mkdtemp(join(tmpdir(), `overfull-corpus-${testCase.id}-`));
  try {
    await cp(testCase.dir, work, {
      recursive: true,
      filter: (src) => !CASE_ONLY_FILES.has(src.slice(testCase.dir.length + 1)),
    });
    if (fixed) await cp(join(testCase.dir, 'fixed.tex'), join(work, 'main.tex'));
    const user = typeof process.getuid === 'function' ? [`--user`, `${process.getuid()}:${process.getgid()}`] : [];
    const docker = ['run', '--rm', '--network', 'none', ...user, '-e', 'HOME=/tmp'];
    docker.push('-v', `${work}:/w`, '-w', '/w', IMAGE, ...commandFor(testCase.spec));
    const result = await run('docker', docker);
    let log;
    try {
      log = await readFile(join(work, 'main.log'), 'utf8');
    } catch {
      throw new Error(`${testCase.id}: no main.log produced\n${result.output.slice(-2000)}`);
    }
    return log;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function rulesIn(log) {
  const { build, output } = analyzeLog(log);
  return {
    build: new Set(build.problems.map((p) => p.rule)),
    output: new Set(output.problems.map((p) => p.rule)),
  };
}

/** Compares fired rules with the case's expectations. Returns a list of failure reasons. */
function judge(spec, fired) {
  const all = new Set([...fired.build, ...fired.output]);
  const reasons = [];
  for (const rule of spec.expect) if (!all.has(rule)) reasons.push(`missing ${rule}`);
  for (const rule of all) if (!spec.expect.includes(rule)) reasons.push(`unexpected ${rule}`);
  const primary = spec.expect[0];
  if (primary && !fired[spec.check].has(primary)) reasons.push(`${primary} not in ${spec.check}`);
  return reasons;
}

async function pool(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(lanes);
  return results;
}

function printTable(rows) {
  const header = ['case', 'engine', 'expected', 'fired', 'fixed', 'result'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(line(header));
  console.log(line(widths.map((w) => '-'.repeat(w))));
  for (const row of rows) console.log(line(row));
}

const list = (set) => [...set].join(',') || '-';

async function capture(cases) {
  const rows = await pool(cases, async (c) => {
    const log = await compile(c);
    await writeFile(join(c.dir, 'main.log'), log);
    const fired = rulesIn(log);
    const reasons = judge(c.spec, fired);
    const all = new Set([...fired.build, ...fired.output]);
    return [c.id, c.spec.engine, c.spec.expect.join(',') || '-', list(all), '', reasons.length ? 'MISMATCH' : 'ok'];
  });
  printTable(rows);
  return rows.every((r) => r[5] === 'ok');
}

async function verify(cases, { recompile }) {
  const rows = await pool(cases, async (c) => {
    const log = recompile ? await compile(c) : await readFile(join(c.dir, 'main.log'), 'utf8');
    const fired = rulesIn(log);
    const reasons = judge(c.spec, fired);
    let fixedCell = '';
    if (recompile && c.hasFixed) {
      const fixedFired = rulesIn(await compile(c, { fixed: true }));
      const leaked = c.spec.expect.filter((r) => fixedFired.build.has(r) || fixedFired.output.has(r));
      fixedCell = leaked.length ? `FAIL(${leaked.join(',')})` : 'clean';
      if (leaked.length) reasons.push(`fixed.tex still fires ${leaked.join(',')}`);
    }
    const all = new Set([...fired.build, ...fired.output]);
    const result = reasons.length ? `FAIL: ${reasons.join('; ')}` : 'ok';
    return [c.id, c.spec.engine, c.spec.expect.join(',') || '-', list(all), fixedCell, result];
  });
  printTable(rows);
  const failed = rows.filter((r) => r[5] !== 'ok').length;
  console.log(`\n${rows.length - failed} passed, ${failed} failed (${rows.length} cases)`);
  return failed === 0;
}

async function main() {
  const [mode, ...ids] = process.argv.slice(2);
  const cases = await loadCases(ids);
  if (mode === '--capture') return capture(cases);
  if (mode === '--verify') return verify(cases, { recompile: true });
  if (mode === '--check') return verify(cases, { recompile: false });
  console.error('usage: node scripts/corpus.mjs --capture|--verify|--check [case-id...]');
  return false;
}

main().then(
  (ok) => {
    process.exitCode = ok ? 0 : 1;
  },
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  },
);
