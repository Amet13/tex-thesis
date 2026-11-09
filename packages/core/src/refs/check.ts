import type { BibEntry, BibParseIssue } from '../bib/parse.js';
import { type CheckResult, type Problem, type RuleInfo, statusOf } from '../types.js';
import { citeLocations } from '../venue/tex.js';
import type { TexFile } from '../venue/types.js';
import type { RefResult } from './types.js';
import { isUnproven, sourceName } from './verify.js';

export const refsRules: RuleInfo[] = [
  {
    id: 'bib-file-missing',
    check: 'references',
    severity: 'error',
    title: 'Bibliography file not found',
    summary:
      'A .bib file named in overfull.yml (`bib:`) or in `\\addbibresource`/`\\bibliography` does not exist, so its entries cannot be checked and LaTeX cannot use them.',
    fix: 'Fix the path in `bib:` (overfull.yml) or in `\\addbibresource`, relative to the project root.',
  },
  {
    id: 'refs-cache-ignored',
    check: 'references',
    severity: 'info',
    title: 'Project reference cache ignored',
    summary:
      'With `references.cache: project`, lookups are cached in `.overfull/cache/refs.json` inside the project. That file is repository content: in CI (any provider, with or without a .git directory) it is never read, and anywhere a cache reached through a symlink is not used, because it could mark references as verified that were never looked up. Every reference is looked up again.',
    fix: 'Keep `.overfull/` out of git (add it to .gitignore) and make sure it is a real directory, not a symlink; or drop `references.cache: project` to use the user cache directory.',
  },
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
      'A matching record was found, but its year, authors or title differ meaningfully from the .bib entry.',
    fix: 'Compare the entry with the record shown and correct it, or replace it with `overfull cite <doi>`.',
  },
  {
    id: 'reference-doi-wrong-work',
    check: 'references',
    severity: 'error',
    title: 'DOI points to a different work',
    summary:
      'The entry’s DOI resolves at doi.org, but to a paper with a different title or authors. Readers who follow the DOI land on an unrelated work.',
    fix: 'Find the correct DOI for the cited title on the publisher page, or re-add the entry with `overfull cite "<title>"`. Do not re-add it from this DOI: that would cite the unrelated paper.',
  },
  {
    id: 'reference-arxiv-wrong-work',
    check: 'references',
    severity: 'error',
    title: 'arXiv id points to a different work',
    summary:
      'The entry’s arXiv id exists, but arXiv has a paper with a different title or authors under it. Readers who follow the id land on an unrelated work.',
    fix: 'Find the correct arXiv id for the cited title on arxiv.org, or re-add the entry with `overfull cite "<title>"`. Do not re-add it from this id: that would cite the unrelated paper.',
  },
  {
    id: 'bib-outside-project',
    check: 'references',
    severity: 'warning',
    title: 'Bibliography outside the project not checked',
    summary:
      'The document names a .bib file outside the project directory (for example `\\bibliography{../shared/refs}`). Overfull only reads files inside the project, so the references in it were not checked.',
    fix: 'Pass the file explicitly with `--bib` (or `bib:` in overfull.yml) from a project that contains it, or move it into the project.',
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
    fix: 'The message names the index that could not answer. Add the DOI or arXiv id to the entry: doi.org and arXiv can confirm it even when the title search fails. Or re-add the entry with `overfull cite <doi | arXiv:id>`.',
  },
  {
    id: 'reference-unproven',
    check: 'references',
    severity: 'error',
    title: 'Reference neither verified nor added with overfull cite',
    summary:
      'With `references.requireCite`, every entry that cannot be verified must have been added with `overfull cite`: it carries `x-overfull = {cite …}` and a DOI, eprint or URL. The marker is a convenience, not proof; a hand-written entry that no index confirms may not exist.',
    fix: 'Ask the author for a DOI/arXiv id and add it with `overfull cite`, or remove the \\cite',
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
    summary:
      'The document cites a key that no .bib file defines; the PDF shows `[?]` or the key in bold.',
    fix: 'Add the entry with `overfull cite <doi | arXiv:id | "title">`, or fix the key in `\\cite{}`.',
  },
];

function fieldList(r: RefResult): string {
  return (r.differences ?? []).map((d) => (d.field === 'author' ? 'authors' : d.field)).join(', ');
}

function titleHint(r: RefResult, entry?: BibEntry): string | undefined {
  const title = entry?.fields.title ?? (r.wrongWork ? undefined : r.matched?.title);
  return title ? `overfull cite "${title.replace(/[{}]/g, '').replace(/"/g, "'")}"` : undefined;
}

function citeHint(r: RefResult, entry?: BibEntry): string {
  // A DOI that points to another work must never be suggested: it would cite that work.
  if (r.wrongWork) return titleHint(r, entry) ?? 'overfull cite "<title>"';
  if (r.matched?.doi) return `overfull cite ${r.matched.doi}`;
  const title = entry?.fields.title ?? r.matched?.title;
  return title
    ? `overfull cite "${title.replace(/[{}]/g, '').replace(/"/g, "'")}"`
    : 'overfull cite <doi>';
}

function searchedText(r: RefResult): string {
  const names = (r.searched ?? []).map(sourceName);
  if (!names.length) return 'the indexes';
  return names.length === 1
    ? (names[0] as string)
    : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
}

function failedText(r: RefResult): string {
  const names = (r.failed ?? []).map(sourceName);
  if (!names.length) return 'A source';
  return names.length === 1
    ? (names[0] as string)
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function unprovenProblem(r: RefResult, entry?: BibEntry): Problem {
  const location =
    r.location ??
    (entry?.line ? { line: entry.line, ...(entry.file ? { file: entry.file } : {}) } : undefined);
  return {
    rule: 'reference-unproven',
    check: 'references',
    severity: 'error',
    message: `\`${r.key}\` was not added with \`overfull cite\` and could not be verified`,
    ...(location ? { location } : {}),
    detail: `Status: ${r.status}${r.reason ? ` (${r.reason})` : ''}. The entry has no \`x-overfull = {cite …}\` field with a DOI, eprint or URL beside it, so nothing shows it came from real metadata.`,
    fix: 'Ask the author for a DOI/arXiv id and add it with `overfull cite`, or remove the \\cite',
    ...(entry?.raw ? { evidence: entry.raw } : {}),
    data: { key: r.key, status: r.status },
  };
}

function problemFor(r: RefResult, entry?: BibEntry): Problem | null {
  const location =
    r.location ??
    (entry?.line ? { line: entry.line, ...(entry.file ? { file: entry.file } : {}) } : undefined);
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
      if (r.wrongWork?.field === 'eprint') {
        const others = (r.differences ?? [])
          .filter((d) => d.field !== 'eprint')
          .map((d) => `${d.field}: bib “${d.bib}”, record “${d.record}”`);
        return {
          ...common,
          ...evidence,
          rule: 'reference-arxiv-wrong-work',
          severity: 'error',
          message: `\`${r.key}\`: the arXiv id ${r.wrongWork.id} points to a different paper, “${r.wrongWork.title}”`,
          detail: [`arXiv has “${r.wrongWork.title}” as ${r.wrongWork.id}, not the cited work`, ...others].join('; '),
          fix: `Find the correct arXiv id for the cited title, or re-add the entry with \`${citeHint(r, entry)}\`. Do not re-add it from this id: that would cite the unrelated paper.`,
        };
      }
      if (r.wrongWork) {
        const others = (r.differences ?? [])
          .filter((d) => d.field !== 'doi')
          .map((d) => `${d.field}: bib “${d.bib}”, record “${d.record}”`);
        return {
          ...common,
          ...evidence,
          rule: 'reference-doi-wrong-work',
          severity: 'error',
          message: `\`${r.key}\`: the DOI ${r.wrongWork.id} points to a different paper, “${r.wrongWork.title}”`,
          detail: [
            `doi.org resolves ${r.wrongWork.id} to “${r.wrongWork.title}”, not to the cited work`,
            ...others,
          ].join('; '),
          fix: `Find the correct DOI for the cited title on the publisher page, or re-add the entry with \`${citeHint(r, entry)}\`. Do not re-add it from this DOI: that would cite the unrelated paper.`,
        };
      }
      const diffs = (r.differences ?? []).map(
        (d) => `${d.field}: bib “${d.bib}”, record “${d.record}”`,
      );
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
        detail:
          'A network problem is not evidence against the reference; it was neither confirmed nor ruled out.',
        fix: `${failedText(r)} could not answer. Add the DOI or arXiv id to the entry (doi.org and arXiv can confirm it even when the title search fails), or re-add it with \`overfull cite <doi | arXiv:id>\`.`,
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
export function missingKeys(cited: string[], entries: BibEntry[], texFiles?: TexFile[]): Problem[] {
  const defined = new Set(entries.map((e) => e.key));
  const missing = cited.filter((k) => !defined.has(k));
  const where = texFiles?.length ? citeLocations(texFiles, missing) : undefined;
  return missing.map((key) => {
    const location = where?.get(key);
    return {
      rule: 'citation-key-missing',
      check: 'references' as const,
      severity: 'error' as const,
      message: `\`${key}\` is cited but not defined in any .bib file`,
      ...(location ? { location } : {}),
      fix: `Add it with \`overfull cite <doi | arXiv:id | "title">\` (then use the key it prints), fix the key in \`\\cite{${key}}\`, or remove the \`\\cite\` if the source is not known.`,
      data: { key },
    };
  });
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
  /**
   * Report unverified entries without `x-overfull` provenance as `reference-unproven`
   * (needs `entries`). Results marked `unproven` by `verifyEntries` are always reported.
   */
  requireProvenance?: boolean;
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
    ...results
      .filter((r) => {
        if (r.reason === 'offline') return false;
        if (r.unproven) return true;
        const entry = byKey.get(r.key);
        return Boolean(opts.requireProvenance && entry && isUnproven(entry, r));
      })
      .map((r) => unprovenProblem(r, byKey.get(r.key))),
  ];
  if (problems.some((p) => p.rule === 'reference-unproven')) {
    stats.unproven = problems.filter((p) => p.rule === 'reference-unproven').length;
  }
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
  return {
    check: 'references',
    status: statusOf(problems),
    problems,
    summary: summaryOf(results, stats),
    stats,
  };
}
