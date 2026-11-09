/** Regressions from the round-4 persona walkthroughs (core side). */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBib } from '../src/bib/index.js';
import {
  accessibilityCheck,
  contextPage,
  type PdfFacts,
  parseVeraPdfReport,
  type VeraPdfResult,
} from '../src/pdf/index.js';
import { refsCheck, verifyEntries } from '../src/refs/index.js';
import { getRule } from '../src/rules.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/pdf/${name}`, import.meta.url), 'utf8');

function facts(overrides: Partial<PdfFacts> = {}): PdfFacts {
  return {
    pageCount: 40,
    pages: [{ number: 1, text: '', widthMm: 210, heightMm: 297 }],
    info: {},
    xmp: {},
    tagged: true,
    hasStructTree: true,
    figures: [],
    language: 'en',
    title: 'T',
    displayDocTitle: true,
    pdfua: 2,
    ...overrides,
  };
}

describe('veraPDF root-cause grouping', () => {
  const untaggedReport = parseVeraPdfReport(fixture('verapdf-untagged-ua2.json'));

  it('folds every verapdf-* failure into pdf-not-tagged when the PDF is untagged', () => {
    expect(untaggedReport.failures.length).toBeGreaterThan(1);
    const r = accessibilityCheck(facts({ tagged: false, hasStructTree: false }), {
      verapdf: untaggedReport,
      level: 'required',
    });
    const rules = r.problems.map((p) => p.rule);
    expect(rules.filter((id) => id.startsWith('verapdf-'))).toEqual([]);
    const root = r.problems.find((p) => p.rule === 'pdf-not-tagged');
    expect(root?.related).toBe(untaggedReport.failures.length);
    expect(root?.evidence?.split('\n')).toHaveLength(untaggedReport.failures.length);
    expect(root?.fix).toBe(
      'Add `\\DocumentMetadata{lang=en, pdfstandard=ua-2, pdfversion=2.0, tagging=on}` as the first line of main.tex and build with LuaLaTeX',
    );
  });

  it('demotes verapdf-* to info when the build failed', () => {
    const r = accessibilityCheck(facts(), {
      verapdf: untaggedReport,
      level: 'required',
      buildFailed: true,
    });
    const vera = r.problems.filter((p) => p.rule.startsWith('verapdf-'));
    expect(vera.length).toBeGreaterThan(0);
    for (const p of vera) {
      expect(p.severity).toBe('info');
      expect(p.message).toContain('fix build errors first; a broken build produces these');
    }
    expect(r.status).toBe('pass');
  });

  it('gives each failure 1-based page numbers from pages[n] contexts', () => {
    expect(contextPage('root/document[0]/pages[31](12 0 obj PDPage)/contentStream[0]')).toBe(32);
    expect(contextPage('root/document[0]')).toBeUndefined();
    const json = JSON.stringify({
      report: {
        jobs: [
          {
            validationResult: [
              {
                compliant: false,
                details: {
                  ruleSummaries: [
                    {
                      ruleStatus: 'FAILED',
                      specification: 'ISO 14289-2:2024',
                      clause: '8.2.2',
                      testNumber: 1,
                      failedChecks: 5,
                      description: 'Content shall be marked as Artifact or tagged as real content',
                      checks: [31, 31, 2, 3, 4].map((n) => ({
                        status: 'failed',
                        context: `root/document[0]/pages[${n}](9 0 obj PDPage)/contentStream[0]/content[0]`,
                      })),
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    });
    const v: VeraPdfResult = parseVeraPdfReport(json);
    expect(v.failures[0]?.pages).toEqual([3, 4, 5, 32]);
    const r = accessibilityCheck(facts(), { verapdf: v, level: 'required' });
    const p = r.problems.find((x) => x.rule === 'verapdf-8-2-2');
    expect(p?.location).toEqual({ page: 3 });
    expect(p?.message).toContain('on pages 3, 4, 5, 32');
    expect(p?.data?.pages).toEqual([3, 4, 5, 32]);
    expect(p?.fix).toContain('artifact');
  });

  it('explains common clauses, and falls back to the generic rule', () => {
    expect(getRule('verapdf-8-2-2-1')?.summary).toMatch(/artifact/i);
    expect(getRule('verapdf-8-2-5-26')?.summary).toMatch(/structure tree/i);
    expect(getRule('verapdf-7-1-3')?.fix).toContain('\\DocumentMetadata');
    expect(getRule('verapdf-7-18-5')?.summary).toMatch(/Link/);
    expect(getRule('verapdf-7-21-4-1')?.summary).toMatch(/font/i);
    expect(getRule('verapdf-7-3')?.summary).toMatch(/Alt/);
    expect(getRule('verapdf-6-2')?.summary).toBe(getRule('verapdf')?.summary);
  });
});

describe('verapdf-not-run severity', () => {
  it('is info by default (browser, Action) even when accessibility is required', () => {
    const r = accessibilityCheck(facts(), { verapdf: null, level: 'required' });
    expect(r.problems.map((p) => [p.rule, p.severity])).toEqual([['verapdf-not-run', 'info']]);
  });

  it('is a warning only when required and it could have run', () => {
    const r = accessibilityCheck(facts(), {
      verapdf: null,
      level: 'required',
      verapdfNotRun: { couldRun: true },
    });
    expect(r.problems[0]?.severity).toBe('warning');
    const rec = accessibilityCheck(facts(), {
      verapdf: null,
      level: 'recommended',
      verapdfNotRun: { couldRun: true },
    });
    expect(rec.problems[0]?.severity).toBe('info');
  });
});

describe('reference-unproven advice', () => {
  it('tells authors how to vouch for their own entry, in the problem and the rule', () => {
    const bib = parseBib('@article{own, title = {My Own Work}, author = {Me, A}, year = {2020}}');
    const check = refsCheck(
      [{ key: 'own', status: 'unverifiable', reason: 'offline', unproven: true }],
      { entries: bib, requireProvenance: true },
    );
    const text =
      'If you wrote this entry yourself, add `note = {overfull: author-provided}` to it.';
    expect(check.problems.find((p) => p.rule === 'reference-unproven')?.fix).toContain(text);
    expect(getRule('reference-unproven')?.fix).toContain(text);
  });
});

describe('network failures collapse into one problem', () => {
  const offlineFetch = (() =>
    Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
  const bib = (n: number) =>
    Array.from(
      { length: n },
      (_, i) =>
        `@inproceedings{k${i}, author = {Smith, John}, title = {A Study of Thing Number ${i}}, booktitle = {SOSP}, year = {2020}}`,
    ).join('\n');
  const fast = { arxivIntervalMs: 0, retryDelayMs: 0 };

  it('many unreachable lookups become one reference-lookup-failed', async () => {
    const entries = parseBib(bib(5));
    const results = await verifyEntries(entries, { fetch: offlineFetch, ...fast });
    expect(results.every((r) => r.status === 'error')).toBe(true);
    const check = refsCheck(results, { entries });
    const failed = check.problems.filter((p) => p.rule === 'reference-lookup-failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.message).toMatch(
      /^Could not reach \S+(?:, \S+)*(?: and \S+)?; 5 entries were not re-verified\. Run again when online\.$/,
    );
    expect(failed[0]?.message).toContain('api.crossref.org');
    expect(failed[0]?.data?.keys).toEqual(['k0', 'k1', 'k2', 'k3', 'k4']);
    expect(failed[0]?.evidence?.split('\n')).toHaveLength(5);
  });

  it('a couple of failures stay per entry', async () => {
    const entries = parseBib(bib(2));
    const results = await verifyEntries(entries, { fetch: offlineFetch, ...fast });
    const check = refsCheck(results, { entries });
    expect(check.problems.filter((p) => p.rule === 'reference-lookup-failed')).toHaveLength(2);
  });
});
