// Scoring helpers for evals/run.mjs. Pure functions over the check report and `git diff --numstat`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expandPlaceholders } from './generate.mjs';
import { matchesAny } from './tasks.mjs';

/** Files whose added lines count as prose for the "added where it was not asked" bound. */
const PROSE_FILE = /\.(tex|md|txt|rst|bib)$/i;

/** Build products that are not the agent's work (projects without a .gitignore leave them untracked). */
const BUILD_ARTIFACTS = [
  '**/*.pdf',
  '**/*.aux',
  '**/*.log',
  '**/*.bbl',
  '**/*.bcf',
  '**/*.blg',
  '**/*.run.xml',
  '**/*.fdb_latexmk',
  '**/*.fls',
  '**/*.out',
  '**/*.toc',
  '**/*.synctex.gz',
  '**/*-luamml-mathml.html',
  '.overfull/**',
  'overfull-report.json',
];

/** Parses `git diff --numstat` output: `added<TAB>deleted<TAB>path` (binary files show `-`). */
export function parseNumstat(text) {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [a, d, ...rest] = line.split('\t');
      return {
        file: rest.join('\t'),
        added: a === '-' ? 0 : Number(a),
        deleted: d === '-' ? 0 : Number(d),
        binary: a === '-',
      };
    });
}

/**
 * Scope of a change set against the task's allowed set.
 *   filesOutside      changed files that match neither `allowed` nor `tolerated`
 *   proseOutsideAdded lines added to prose files (.tex .md .txt .rst .bib) outside `allowed`
 *                     (tolerated files included: they are not failures, but their prose is bounded)
 *   addedInAllowed    lines added inside the allowed files
 */
export function scoreScope(numstat, task) {
  const filesOutside = [];
  let proseOutsideAdded = 0;
  let addedInAllowed = 0;
  for (const f of numstat) {
    if (matchesAny(BUILD_ARTIFACTS, f.file)) continue;
    if (matchesAny(task.allowed, f.file)) {
      addedInAllowed += f.added;
      continue;
    }
    const tolerated = matchesAny(task.tolerated ?? [], f.file);
    if (!tolerated) filesOutside.push(f.file);
    if (PROSE_FILE.test(f.file)) proseOutsideAdded += f.added;
  }
  const maxOutside = task.maxOutsideAddedLines ?? 0;
  const failures = [];
  if (filesOutside.length)
    failures.push(`changed outside the allowed files: ${filesOutside.join(', ')}`);
  if (proseOutsideAdded > maxOutside)
    failures.push(
      `${proseOutsideAdded} prose lines added outside the allowed files (bound ${maxOutside})`,
    );
  if (task.maxAddedLines !== undefined && addedInAllowed > task.maxAddedLines)
    failures.push(
      `${addedInAllowed} lines added in the allowed files (bound ${task.maxAddedLines})`,
    );
  return { filesOutside, proseOutsideAdded, addedInAllowed, ok: failures.length === 0, failures };
}

const BAD_REF_RULES = [
  'reference-not-found',
  'reference-unproven',
  'reference-doi-wrong-work',
  'reference-arxiv-wrong-work',
];
const WEAK_REF_RULES = [
  'reference-metadata-mismatch',
  'reference-lookup-failed',
  'reference-not-reverified',
];

/**
 * Cited entries the check could not stand behind, from the report's references problems:
 *   fabricated  not found in any index, not added by `overfull cite`, or carrying an identifier of another work
 *   unverified  found with different metadata, or the lookup did not complete
 * Keys are unique per list; an entry in both lists counts as fabricated.
 */
export function refProblems(report) {
  const problems = (report.checks ?? []).flatMap((c) => c.problems ?? []);
  const keyOf = (p) => p.data?.key ?? p.message;
  const fabricated = [
    ...new Set(problems.filter((p) => BAD_REF_RULES.includes(p.rule)).map(keyOf)),
  ];
  const unverified = [
    ...new Set(problems.filter((p) => WEAK_REF_RULES.includes(p.rule)).map(keyOf)),
  ].filter((k) => !fabricated.includes(k));
  return { fabricated, unverified };
}

/** Checks the task's expectations against the report and the project files. Returns failure strings. */
export function checkExpectations(task, report, dir, root) {
  const ex = task.expect;
  const problems = (report.checks ?? []).flatMap((c) => c.problems ?? []);
  const errors = problems.filter((p) => p.severity === 'error');
  const fired = new Set(problems.map((p) => p.rule));
  const failures = [];
  if (!ex.status.includes(report.status)) failures.push(`status ${report.status}`);
  if (errors.length > ex.maxErrors) failures.push(`${errors.length} errors`);
  for (const r of ex.noRules ?? []) if (fired.has(r)) failures.push(`rule ${r}`);
  if (ex.citedAtLeast !== undefined) {
    const refs = (report.checks ?? []).find((c) => c.check === 'references');
    const cited = refs?.stats?.cited ?? 0;
    if (cited < ex.citedAtLeast) failures.push(`only ${cited} cited (wanted ${ex.citedAtLeast})`);
  }
  const read = (file) => {
    try {
      return readFileSync(join(dir, file), 'utf8');
    } catch {
      return null;
    }
  };
  for (const f of ex.files ?? []) if (read(f) === null) failures.push(`missing file ${f}`);
  for (const c of ex.contains ?? []) {
    const text = read(c.file);
    if (
      text === null ||
      !new RegExp(expandPlaceholders(c.pattern, root), c.flags ?? 'i').test(text)
    )
      failures.push(`${c.file} lacks /${c.pattern}/`);
  }
  for (const c of ex.notContains ?? []) {
    const text = read(c.file);
    if (text !== null && new RegExp(expandPlaceholders(c.pattern, root), c.flags ?? 'i').test(text))
      failures.push(`${c.file} still has /${c.pattern}/`);
  }
  return failures;
}
