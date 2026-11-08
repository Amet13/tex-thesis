import type { BibEntry, BibParseIssue } from '../bib/parse.js';
import { type CheckResult, type Problem, type RuleInfo, statusOf } from '../types.js';
import type { RefResult } from './types.js';
import { sourceName } from './verify.js';

export const refsRules: RuleInfo[] = [
  {
    id: 'reference-not-found',
    check: 'references',
    severity: 'error',
    title: 'Reference not found in any index',
    summary:
      'A journal or conference reference matched nothing in CrossRef, dblp or arXiv, or its DOI / arXiv id does not exist. The reference may be mistyped, or may not exist.',
    fix: 'Check the title and DOI against the publisher page, then re-add the reference from real metadata with `overfull cite "<title>"` or `overfull cite <doi>`. If it is real but unindexed, add `note = {overfull: skip}`.',
  },
  {
    id: 'reference-metadata-mismatch',
    check: 'references',
    severity: 'warning',
    title: 'Reference metadata differs from the index record',
    summary:
      'A matching record was found, but its year, authors or title differ meaningfully from the .bib entry, or the entry’s DOI points to a different work.',
    fix: 'Compare the entry with the record shown and correct it, or replace it with `overfull cite <doi>`.',
  },
  {
    id: 'reference-unverifiable',
    check: 'references',
    severity: 'info',
    title: 'Reference could not be checked automatically',
    summary:
      'Websites, software, standards, books and theses are often not in scholarly indexes, so their existence cannot be confirmed automatically.',
    fix: 'Check these entries by hand. Add a DOI or ISBN where one exists.',
  },
  {
    id: 'reference-lookup-failed',
    check: 'references',
    severity: 'warning',
    title: 'Reference lookup failed',
    summary:
      'An index could not be reached (network error, timeout, rate limit), so the reference was neither confirmed nor ruled out.',
    fix: 'Re-run the check when online. Results are cached, so a second run only retries what failed.',
  },
  {
    id: 'bib-parse-error',
    check: 'references',
    severity: 'error',
    title: 'Malformed .bib entry',
    summary: 'A .bib entry could not be parsed, so BibTeX/biber will skip or misread it.',
    fix: 'Fix the syntax at the reported line: usually a missing comma, `=`, or closing brace.',
  },
  {
    id: 'citation-key-missing',
    check: 'references',
    severity: 'error',
    title: 'Cited key not in any .bib file',
    summary: 'The document cites a key that no .bib file defines; the PDF shows `[?]` or the key in bold.',
    fix: 'Add the entry with `overfull cite <doi | arXiv:id | "title">`, or fix the key in `\\cite{}`.',
  },
];

function fieldList(r: RefResult): string {
  return (r.differences ?? []).map((d) => (d.field === 'author' ? 'authors' : d.field)).join(', ');
}

function citeHint(r: RefResult, entry?: BibEntry): string {
  if (r.matched?.doi) return `overfull cite ${r.matched.doi}`;
  const title = entry?.fields.title ?? r.matched?.title;
  return title ? `overfull cite "${title.replace(/[{}]/g, '').replace(/"/g, "'")}"` : 'overfull cite <doi>';
}

function searchedText(r: RefResult): string {
  const names = (r.searched ?? []).map(sourceName);
  if (!names.length) return 'the indexes';
  return names.length === 1 ? (names[0] as string) : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
}

function problemFor(r: RefResult, entry?: BibEntry): Problem | null {
  const location = r.location ?? (entry?.line ? { line: entry.line, ...(entry.file ? { file: entry.file } : {}) } : undefined);
  const data: Record<string, unknown> = { key: r.key, status: r.status };
  if (r.source) data.source = r.source;
  if (r.query) data.query = r.query;
  if (r.differences) data.differences = r.differences;
  if (r.matched) data.matched = r.matched;
  const common = { check: 'references' as const, ...(location ? { location } : {}), data };
  const evidence = entry?.raw ? { evidence: entry.raw } : {};
  switch (r.status) {
    case 'verified':
      return null;
    case 'not-found':
      return {
        ...common,
        ...evidence,
        rule: 'reference-not-found',
        severity: 'error',
        message: `\`${r.key}\` was not found in ${searchedText(r)}`,
        detail: `Searched ${searchedText(r)}: ${r.reason ?? 'no similar record'}. The reference may be mistyped or may not exist; Overfull cannot tell which.`,
        fix: `Check the DOI and title against the publisher page, or re-add it from real metadata with \`${citeHint(r, entry)}\`. If it is real but unindexed, add \`note = {overfull: skip}\`.`,
      };
    case 'mismatch': {
      const diffs = (r.differences ?? []).map((d) => `${d.field}: bib “${d.bib}”, record “${d.record}”`);
      return {
        ...common,
        ...evidence,
        rule: 'reference-metadata-mismatch',
        severity: 'warning',
        message: `\`${r.key}\`: ${fieldList(r) || 'metadata'} differ${r.differences?.length === 1 ? 's' : ''} from the ${r.source ? sourceName(r.source) : 'index'} record`,
        detail: [r.reason, ...diffs].filter(Boolean).join('; '),
        fix: `Compare the entry with the record${r.matched?.doi ? ` (doi ${r.matched.doi})` : ''} and correct it, or replace it with \`${citeHint(r, entry)}\`.`,
      };
    }
    case 'unverifiable':
      return {
        ...common,
        rule: 'reference-unverifiable',
        severity: 'info',
        message: `\`${r.key}\` could not be checked automatically${r.reason ? ` (${r.reason})` : ''}`,
        fix: 'Check this entry by hand; add a DOI where one exists.',
      };
    case 'error':
      return {
        ...common,
        rule: 'reference-lookup-failed',
        severity: 'warning',
        message: `\`${r.key}\` could not be checked: ${r.reason ?? 'lookup failed'}`,
        detail: 'A network problem is not evidence against the reference; it was neither confirmed nor ruled out.',
        fix: 'Re-run the check when online.',
      };
  }
}

/** Problems for `.bib` syntax issues (rule `bib-parse-error`). */
export function bibIssueProblems(issues: BibParseIssue[], file?: string): Problem[] {
  return issues.map((i) => ({
    rule: 'bib-parse-error',
    check: 'references',
    severity: /^(duplicate field|undefined macro)/.test(i.message) ? 'warning' : 'error',
    message: i.message,
    location: { line: i.line, ...(file ? { file } : {}) },
    ...(i.key ? { data: { key: i.key } } : {}),
  }));
}

/** Cited keys that no .bib entry defines (rule `citation-key-missing`). Case-sensitive like BibTeX. */
export function missingKeys(cited: string[], entries: BibEntry[]): Problem[] {
  const defined = new Set(entries.map((e) => e.key));
  return cited
    .filter((k) => !defined.has(k))
    .map((key) => ({
      rule: 'citation-key-missing',
      check: 'references' as const,
      severity: 'error' as const,
      message: `\`${key}\` is cited but not defined in any .bib file`,
      fix: `Add it with \`overfull cite <doi | arXiv:id | "title">\` (then use the key it prints), or fix the key in \`\\cite{${key}}\`.`,
      data: { key },
    }));
}

export interface RefsCheckOptions {
  /** Entries the results came from (adds evidence and locations). */
  entries?: BibEntry[];
  /** Parse issues to report as `bib-parse-error`. */
  issues?: BibParseIssue[];
  /** File for parse issues. */
  bibFile?: string;
  /** Extra problems, e.g. from `missingKeys`. */
  extra?: Problem[];
}

function summaryOf(results: RefResult[], stats: Record<string, number>): string {
  const parts: string[] = [];
  if (stats.notFound) parts.push(`${stats.notFound} not found`);
  if (stats.mismatch) parts.push(`${stats.mismatch} with differing metadata`);
  if (stats.error) parts.push(`${stats.error} could not be checked`);
  if (stats.unverifiable) parts.push(`${stats.unverifiable} not checkable automatically`);
  const head = `${stats.verified} of ${results.length} references verified`;
  return parts.length ? `${head} (${parts.join(', ')})` : head;
}

/** Builds the `references` CheckResult. */
export function refsCheck(results: RefResult[], opts: RefsCheckOptions = {}): CheckResult {
  const byKey = new Map((opts.entries ?? []).map((e) => [e.key, e]));
  const stats: Record<string, number> = {
    total: results.length,
    verified: results.filter((r) => r.status === 'verified').length,
    mismatch: results.filter((r) => r.status === 'mismatch').length,
    notFound: results.filter((r) => r.status === 'not-found').length,
    unverifiable: results.filter((r) => r.status === 'unverifiable').length,
    error: results.filter((r) => r.status === 'error').length,
  };
  const problems = [
    ...bibIssueProblems(opts.issues ?? [], opts.bibFile),
    ...(opts.extra ?? []),
    ...results.map((r) => problemFor(r, byKey.get(r.key))).filter((p): p is Problem => p !== null),
  ];
  if (results.length > 0 && results.every((r) => r.reason === 'offline')) {
    const blocking = problems.filter((p) => p.rule !== 'reference-unverifiable');
    return {
      check: 'references',
      status: 'skipped',
      skippedReason: 'offline: references were not looked up',
      problems: blocking,
      summary: `${results.length} references not checked (offline)`,
      stats,
    };
  }
  return { check: 'references', status: statusOf(problems), problems, summary: summaryOf(results, stats), stats };
}
