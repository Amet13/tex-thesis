import { describe, expect, it } from 'vitest';
import {
  escapeData,
  escapeProperty,
  formatHuman,
  formatJson,
  formatMarkdown,
  githubAnnotations,
} from '../src/report/index.js';
import type { Report } from '../src/types.js';

const report: Report = {
  tool: 'overfull',
  version: '3.0.0',
  target: 'thesis.pdf',
  status: 'fail',
  checks: [
    { check: 'build', status: 'pass', problems: [], summary: 'No TeX errors' },
    {
      check: 'output',
      status: 'fail',
      summary: '1 problem',
      problems: [
        {
          rule: 'pdf-unresolved-reference',
          check: 'output',
          severity: 'error',
          message: '"??" printed instead of a reference number',
          location: { page: 3 },
          fix: 'Check `\\label` spelling',
        },
      ],
    },
    {
      check: 'references',
      status: 'warn',
      problems: [
        {
          rule: 'reference-mismatch',
          check: 'references',
          severity: 'warning',
          message: 'Year differs: 2019 vs 2020, a|b *c*',
          location: { file: 'references.bib', line: 40 },
          detail: 'CrossRef says 2020',
          data: { z: 1, a: 2 },
        },
        {
          rule: 'undefined-control-sequence',
          check: 'references',
          severity: 'error',
          message: 'Undefined control sequence \\foo',
          location: { file: 'chapters/intro.tex', line: 12 },
          related: 2,
        },
        {
          rule: 'reference-unverifiable',
          check: 'references',
          severity: 'info',
          message: 'Website, not checked',
        },
      ],
    },
    {
      check: 'accessibility',
      status: 'skipped',
      problems: [],
      skippedReason: 'No thesis.pdf — run `overfull build` first',
    },
    { check: 'venue', status: 'pass', problems: [] },
  ],
};

describe('formatHuman', () => {
  const out = formatHuman(report);

  it('prints a header, aligned check lines, sorted problems and a tally', () => {
    const lines = out.split('\n');
    expect(lines[0]).toBe('overfull thesis.pdf  FAIL');
    expect(lines[1]).toBe('  ✓ build          No TeX errors');
    expect(lines[4]).toBe('  – accessibility  skipped: No thesis.pdf — run `overfull build` first');
    expect(lines[5]).toBe('  ✓ venue          no problems');
    const problems = lines.slice(7, 11);
    expect(problems[1]).toMatch(
      /^ {2}✕ chapters\/intro\.tex:12 {2}Undefined control sequence \\foo \(\+2 follow-on\) {2}undefined-control-sequence$/,
    );
    expect(problems[0]).toMatch(/^ {2}✕ p\.3 +"\?\?" printed/);
    expect(problems[2]).toMatch(/^ {2}! references\.bib:40 +Year differs/);
    expect(problems[3]).toMatch(/^ {2}i {24}Website, not checked/);
    expect(out).toContain('2 to fix · 1 to review · 1 note · 2 passed · 1 skipped');
  });

  it('uses no ANSI codes unless asked and adds them with color', () => {
    expect(out).not.toContain('\u001b[');
    expect(formatHuman(report, { color: true })).toContain('\u001b[31m✕\u001b[39m');
  });

  it('shows why/fix only when verbose', () => {
    expect(out).not.toContain('fix:');
    const verbose = formatHuman(report, { verbose: true });
    expect(verbose).toContain('fix: Check `\\label` spelling');
    expect(verbose).toContain('why: CrossRef says 2020');
  });
});

describe('workflow-command injection', () => {
  const evil = 'a}\n::warning file=README.md::x';
  const injected: Report = {
    tool: 'overfull',
    version: '0.0.0',
    target: 'x.pdf\n::error::target',
    status: 'fail',
    checks: [
      {
        check: 'output',
        status: 'fail',
        summary: 'summary\r\n::notice::s',
        problems: [
          {
            rule: 'missing-figure',
            check: 'output',
            severity: 'error',
            message: `File \`${evil}\` not found`,
            location: { file: 'main.tex\n::error::loc', line: 3 },
            detail: `why\r::add-mask::secret`,
            fix: `Check \\includegraphics{${evil}}`,
            evidence: `l.3 \\includegraphics{${evil}}\n::stop-commands::tok\r::warning::cr\u2028::x`,
          },
        ],
      },
    ],
  };
  const commandLine = /^\s*::/m;

  it('formatHuman prints no line that starts with ::', () => {
    for (const verbose of [false, true]) {
      for (const color of [false, true]) {
        const out = formatHuman(injected, { verbose, color });
        for (const line of out.split(/\r\n|[\r\n\u2028\u2029\u0085]/)) {
          expect(line).not.toMatch(commandLine);
        }
      }
    }
    const verbose = formatHuman(injected, { verbose: true });
    expect(verbose).toContain('File `a} ::warning file=README.md::x` not found');
    expect(verbose).toContain('| ::stop-commands::tok');
  });

  it('formatMarkdown prints no line that starts with ::', () => {
    const md = formatMarkdown(injected);
    for (const line of md.split(/\r\n|[\r\n\u2028\u2029\u0085]/)) {
      expect(line).not.toMatch(commandLine);
    }
  });

  it('strips terminal escape sequences from user text', () => {
    const check = injected.checks[0] as Report['checks'][0];
    const p = check.problems[0] as Report['checks'][0]['problems'][0];
    const out = formatHuman({
      ...injected,
      checks: [{ ...check, problems: [{ ...p, message: 'x\u001b[2Jy' }] }],
    });
    expect(out).toContain('x[2Jy');
  });
});

describe('formatJson', () => {
  it('is pretty, parseable and has a stable key order', () => {
    const json = formatJson(report);
    const parsed = JSON.parse(json) as Report;
    expect(Object.keys(parsed)).toEqual(['tool', 'version', 'target', 'status', 'checks']);
    expect(Object.keys(parsed.checks[1] ?? {})).toEqual(['check', 'status', 'summary', 'problems']);
    const p = parsed.checks[2]?.problems[0];
    expect(Object.keys(p ?? {})).toEqual([
      'rule',
      'check',
      'severity',
      'message',
      'location',
      'detail',
      'data',
    ]);
    expect(Object.keys(p?.data ?? {})).toEqual(['a', 'z']);
    expect(json).toContain('\n  "checks": [');
    expect(formatJson(JSON.parse(json) as Report)).toBe(json);
  });
});

describe('formatMarkdown', () => {
  const md = formatMarkdown(report);

  it('renders a check table and details lists', () => {
    expect(md).toContain('## Overfull preflight: FAIL');
    expect(md).toContain('| Check | Status | Summary |');
    expect(md).toContain(
      '| accessibility | skipped | skipped: No thesis.pdf — run <code>overfull build</code> first |',
    );
    expect(md).toContain('<details open><summary><b>output</b>: 1 item</summary>');
    expect(md).toContain('  - Fix: Check <code>\\label</code> spelling');
  });

  it('escapes Markdown and HTML in messages', () => {
    expect(md).toContain('a\\|b \\*c\\*');
    expect(md).toContain('Undefined control sequence \\\\foo');
    expect(formatMarkdown({ ...report, target: '<x>' })).toContain('&lt;x&gt;');
  });
});

describe('githubAnnotations', () => {
  it('emits workflow commands, errors first in check order, notices for info', () => {
    const a = githubAnnotations(report, { root: 'thesis' });
    expect(a[1]).toBe(
      '::error file=thesis/chapters/intro.tex,line=12,title=overfull undefined-control-sequence::Undefined control sequence \\foo',
    );
    expect(a[0]).toBe(
      '::error title=overfull pdf-unresolved-reference::Page 3: "??" printed instead of a reference number%0AFix: Check `\\label` spelling',
    );
    expect(a[2]?.startsWith('::warning file=thesis/references.bib,line=40,')).toBe(true);
    expect(a[3]?.startsWith('::notice title=')).toBe(true);
  });

  it('escapes per GitHub rules', () => {
    expect(escapeData('50% done\r\nnext')).toBe('50%25 done%0D%0Anext');
    expect(escapeProperty('a:b,c%')).toBe('a%3Ab%2Cc%25');
  });
});
