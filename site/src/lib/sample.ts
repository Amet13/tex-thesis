/**
 * The preflight report shown on the landing page. The build and output checks
 * come from a real TeX Live log in the corpus; the other three are what the CLI
 * reports for a draft with one invented reference, one figure without alt text
 * and a page too many.
 */
import {
  analyzeLog,
  type CheckResult,
  type Problem,
  type Report,
  reportStatus,
  statusOf,
  VERSION,
} from '@overfull/core';
import { readText } from './repo';

function check(
  c: CheckResult['check'],
  problems: Problem[],
  summary: string,
  stats?: Record<string, number>,
): CheckResult {
  return { check: c, status: statusOf(problems), problems, summary, ...(stats ? { stats } : {}) };
}

export function sampleReport(): Report {
  const log = readText('corpus/undefined-reference/main.log') ?? '';
  const { build, output } = analyzeLog(log, { root: '.' });
  const outputProblems = output.problems.map((p) => ({
    ...p,
    location: { ...p.location, file: p.location?.file ?? 'main.tex' },
  }));
  const checks: CheckResult[] = [
    { ...build, summary: build.summary ?? 'No TeX errors' },
    { ...output, problems: outputProblems },
    check(
      'references',
      [
        {
          rule: 'reference-not-found',
          check: 'references',
          severity: 'error',
          message:
            'No index has a record of "Scaling Laws for Retrieval-Augmented Proof Search" (2024)',
          location: { file: 'references.bib', line: 88 },
          detail: 'Searched CrossRef, DBLP and arXiv by title; no candidate is similar.',
          fix: 'Ask the author for a DOI or arXiv id. If none exists, remove the entry and its `\\cite`.',
          data: { key: 'chen2024scaling' },
        },
        {
          rule: 'reference-metadata-mismatch',
          check: 'references',
          severity: 'warning',
          message: 'vaswani2017attention: year is 2018 in the .bib, 2017 in arXiv',
          location: { file: 'references.bib', line: 41 },
          fix: 'Run `overfull cite arXiv:1706.03762 --key vaswani2017attention` to rewrite the entry from the record.',
        },
      ],
      '29 of 31 references verified',
      { verified: 29, notFound: 1, mismatch: 1 },
    ),
    check(
      'accessibility',
      [
        {
          rule: 'figure-missing-alt',
          check: 'accessibility',
          severity: 'error',
          message: 'Figure on page 4 has no alternative text',
          location: { page: 4 },
          fix: 'Add `alt={…}` to `\\includegraphics`, describing what the figure shows.',
        },
      ],
      'Tagged PDF/UA-2, language en, 1 of 6 figures without alt text',
    ),
    check(
      'venue',
      [
        {
          rule: 'page-limit-exceeded',
          check: 'venue',
          severity: 'error',
          message: 'Main text runs to page 10; the limit is 9',
          location: { page: 10 },
          fix: 'Cut or move material to the appendix until `\\label{overfull:main-end}` lands on page 9.',
          data: { pages: 10, max: 9 },
        },
      ],
      'Profile: paper',
    ),
  ];
  return {
    tool: 'overfull',
    version: VERSION,
    target: 'paper.pdf',
    status: reportStatus(checks),
    checks,
  };
}
