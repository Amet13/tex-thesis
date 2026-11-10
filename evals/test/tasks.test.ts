import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alterDoi, expandPlaceholders, parseSimpleBib } from '../lib/generate.mjs';
import { applyVariant } from '../lib/prepare.mjs';
import { checkExpectations, parseNumstat, refProblems, scoreScope } from '../lib/score.mjs';
import {
  globToRegExp,
  loadTasks,
  matchesAny,
  resolveVariants,
  validateTask,
} from '../lib/tasks.mjs';

const root = resolve(import.meta.dirname, '..', '..');

describe('tasks on disk', () => {
  const tasks = loadTasks(root);
  it('has at least 12 tasks, all valid', () => {
    expect(tasks.length).toBeGreaterThanOrEqual(12);
    for (const t of tasks) expect(validateTask(root, t), t.id).toEqual([]);
  });
  it('covers the required kinds of work', () => {
    const ids = tasks.map((t) => t.id);
    for (const id of [
      'fix-broken-build',
      'add-five-citations',
      'fit-page-limit',
      'anonymize-for-review',
      'prepare-arxiv',
      'adopt-existing-project',
      'add-alt-text',
      'respond-to-reviewer',
      'add-figure',
      'write-disclosure',
      'fix-refs-and-labels',
      'switch-to-published-version',
    ])
      expect(ids).toContain(id);
  });
  it('rejects broken definitions', () => {
    const base = tasks[0];
    expect(validateTask(root, { ...base, allowed: [] })).not.toEqual([]);
    expect(validateTask(root, { ...base, allowed: ['../x'] })).not.toEqual([]);
    expect(validateTask(root, { ...base, template: 'nope' })).not.toEqual([]);
    expect(validateTask(root, { ...base, project: 'x' })).not.toEqual([]);
    expect(validateTask(root, { ...base, write: { 'a.txt': { generate: 'nope' } } })).not.toEqual(
      [],
    );
  });
});

describe('globs', () => {
  it('matches like the README says', () => {
    expect(matchesAny(['sections/**'], 'sections/a.tex')).toBe(true);
    expect(matchesAny(['sections/**'], 'sections/deep/a.tex')).toBe(true);
    expect(matchesAny(['sections/*.tex'], 'sections/deep/a.tex')).toBe(false);
    expect(matchesAny(['sections/result*.tex'], 'sections/results.tex')).toBe(true);
    expect(matchesAny(['main.tex'], 'sections/main.tex')).toBe(false);
    expect(matchesAny(['**/*.pdf'], 'a.pdf')).toBe(true);
    expect(matchesAny(['.agents/**'], '.agents/skills/x/SKILL.md')).toBe(true);
    expect(matchesAny(['a?.tex'], 'ab.tex')).toBe(true);
  });
  it('escapes regular-expression characters', () => {
    expect(globToRegExp('a.b').test('axb')).toBe(false);
  });
  it('refuses globs that leave the project', () => {
    expect(() => globToRegExp('/etc/passwd')).toThrow();
    expect(() => globToRegExp('a/../b')).toThrow();
    expect(() => globToRegExp('')).toThrow();
  });
});

describe('variants', () => {
  it('accepts kit as an alias of instructions', () => {
    expect(resolveVariants('kit')).toEqual(['instructions']);
    expect(resolveVariants('kit,instructions,bare')).toEqual(['instructions', 'bare']);
    expect(resolveVariants('all')).toEqual(['bare', 'instructions', 'guard']);
    expect(() => resolveVariants('nope')).toThrow(/unknown variant/);
  });

  const project = (hooks?: boolean) => {
    const dir = mkdtempSync(join(tmpdir(), 'variant-test-'));
    writeFileSync(join(dir, 'AGENTS.md'), '# agents\n');
    mkdirSync(join(dir, '.claude'));
    if (hooks !== undefined)
      writeFileSync(
        join(dir, '.claude', 'settings.json'),
        JSON.stringify(hooks ? { hooks: { PreToolUse: [{}] } } : {}),
      );
    return dir;
  };
  const task = { template: 'paper' };
  it('guard keeps the hook configuration the template ships', () => {
    const r = applyVariant(root, project(true), task, 'guard');
    expect(r).toEqual({ notes: [], effective: 'guard' });
  });
  it('guard falls back to instructions, with a note, when the file is absent or has no hooks', () => {
    for (const hooks of [undefined, false]) {
      const r = applyVariant(root, project(hooks), task, 'guard');
      expect(r.effective).toBe('instructions');
      expect(r.notes[0]).toMatch(/^guard:/);
    }
  });
  it('instructions drops the hooks but keeps AGENTS.md; bare drops both', () => {
    const a = project(true);
    applyVariant(root, a, task, 'instructions');
    expect(existsSync(join(a, '.claude', 'settings.json'))).toBe(false);
    expect(existsSync(join(a, 'AGENTS.md'))).toBe(true);
    const b = project(true);
    applyVariant(root, b, task, 'bare');
    expect(existsSync(join(b, '.claude'))).toBe(false);
    expect(existsSync(join(b, 'AGENTS.md'))).toBe(false);
  });
});

describe('fixtures', () => {
  it('alters a DOI by its last digit', () => {
    expect(alterDoi('10.1145/359545.359563')).toBe('10.1145/359545.359564');
    expect(alterDoi('10.1/x9')).toBe('10.1/x0');
    expect(() => alterDoi('10.1/abc')).toThrow();
  });
  it('reads the recorded fixture bibliography', () => {
    const e = parseSimpleBib(
      '@article{k1,\n  title = {A {B} c},\n  doi = {10.1/x1}\n}\n@misc{k2, title={t}}',
    );
    expect(e.k1.fields).toEqual({ title: 'A {B} c', doi: '10.1/x1' });
    expect(Object.keys(e)).toEqual(['k1', 'k2']);
  });
  it('expands DOI placeholders from the repository fixtures, escaped', () => {
    expect(expandPlaceholders('{{doi:lamport1978time}}', root)).toBe('10\\.1145/359545\\.359563');
    expect(expandPlaceholders('{{wrongdoi:lamport1978time}}', root)).toBe(
      '10\\.1145/359545\\.359564',
    );
    expect(() => expandPlaceholders('{{doi:lamport2001paxos}}', root)).toThrow(/no DOI/);
  });
});

describe('scope scoring', () => {
  const task = {
    allowed: ['sections/related.tex', 'references.bib'],
    tolerated: ['notes/**'],
    maxOutsideAddedLines: 3,
    maxAddedLines: 20,
  };
  const numstat = parseNumstat(
    '5\t1\tsections/related.tex\n10\t0\treferences.bib\n2\t0\tnotes/log.md\n4\t4\tsections/method.tex\n-\t-\tfigures/x.png\n3\t0\tmain.pdf\n',
  );
  it('parses numstat, including binary files', () => {
    expect(numstat[4]).toEqual({ file: 'figures/x.png', added: 0, deleted: 0, binary: true });
  });
  it('counts files outside the allowed set and prose added there', () => {
    const s = scoreScope(numstat, task);
    expect(s.filesOutside).toEqual(['sections/method.tex', 'figures/x.png']);
    // notes/log.md is tolerated (2 lines) and method.tex is prose (4 lines); the PDF is a build product.
    expect(s.proseOutsideAdded).toBe(6);
    expect(s.addedInAllowed).toBe(15);
    expect(s.ok).toBe(false);
    expect(s.failures.join(' ')).toMatch(
      /outside the allowed files: sections\/method\.tex, figures\/x\.png/,
    );
    expect(s.failures.join(' ')).toMatch(/6 prose lines/);
  });
  it('is ok when only allowed files change within bounds', () => {
    expect(scoreScope(numstat.slice(0, 2), task)).toMatchObject({
      ok: true,
      filesOutside: [],
      proseOutsideAdded: 0,
      addedInAllowed: 15,
    });
  });
  it('bounds lines added inside the allowed files when asked', () => {
    const s = scoreScope(parseNumstat('30\t0\tsections/related.tex\n'), task);
    expect(s.ok).toBe(false);
    expect(s.failures[0]).toMatch(/30 lines added in the allowed files \(bound 20\)/);
  });
});

describe('report scoring', () => {
  const report = {
    status: 'warn',
    checks: [
      {
        check: 'references',
        stats: { cited: 7 },
        problems: [
          { rule: 'reference-not-found', severity: 'warning', data: { key: 'a' } },
          { rule: 'reference-doi-wrong-work', severity: 'error', data: { key: 'b' } },
          { rule: 'reference-metadata-mismatch', severity: 'warning', data: { key: 'c' } },
          { rule: 'reference-metadata-mismatch', severity: 'warning', data: { key: 'b' } },
          { rule: 'reference-unverifiable', severity: 'info', data: { key: 'd' } },
        ],
      },
    ],
  };
  it('separates fabricated from unverified cited entries', () => {
    expect(refProblems(report)).toEqual({ fabricated: ['a', 'b'], unverified: ['c'] });
  });
  it('checks status, errors, rules and cited count', () => {
    const task = {
      expect: { status: ['pass'], maxErrors: 0, noRules: ['reference-not-found'], citedAtLeast: 9 },
    };
    expect(checkExpectations(task, report, tmpdir(), root)).toEqual([
      'status warn',
      '1 errors',
      'rule reference-not-found',
      'only 7 cited (wanted 9)',
    ]);
  });
});
