import type { BibEntry, BibParseIssue } from '../bib/parse.js';
import { type CheckResult, type Problem, type RuleInfo, statusOf } from '../types.js';
import { citeLocations } from '../venue/tex.js';
import type { TexFile } from '../venue/types.js';
import { isAuthorProvided } from './entry.js';
import type { RefResult } from './types.js';
import { hasValidProvenance, isUnproven, sourceName } from './verify.js';

/**
 * The author-provided escape hatch is for people only: agent instructions (AGENTS.md,
 * skills) tell agents never to add it.
 */
const UNPROVEN_FIX =
  'Ask the author for a DOI/arXiv id and add it with `overfull cite`, or remove the \\cite. If you wrote this entry yourself, add `note = {overfull: author-provided}` to it.';

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
      'With `references.requireCite`, every entry that cannot be verified must have been added with `overfull cite`: it carries an intact `x-overfull = {cite … <hash>}` marker and a DOI, eprint or URL. The hash makes edits evident; it is not authentication. Entries the author vouches for carry `note = {overfull: author-provided}` (added by the author, never by an agent). A hand-written entry that no index confirms may not exist.',
    fix: UNPROVEN_FIX,
  },
  {
    id: 'reference-not-reverified',
    check: 'references',
    severity: 'warning',
    title: 'Cited entry could not be re-verified',
    summary:
      'The entry was added with `overfull cite` (its `x-overfull` marker is intact), but this run could not confirm it again: the check ran offline or the indexes could not be reached.',
    fix: 'Run `overfull check` again with network access. If an index stays unreachable, the DOI or arXiv id in the entry lets doi.org or arXiv confirm it.',
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
    detail: `Status: ${r.status}${r.reason ? ` (${r.reason})` : ''}. The entry has no intact \`x-overfull = {cite … <hash>}\` marker (missing, hand-written, or the entry was edited after \`overfull cite\`) with a DOI, eprint or URL beside it, so nothing shows it came from real metadata.`,
    fix: UNPROVEN_FIX,
    ...(entry?.raw ? { evidence: entry.raw } : {}),
    data: { key: r.key, status: r.status },
  };
}

function notReverifiedProblem(r: RefResult, entry?: BibEntry): Problem {
  const location =
    r.location ??
    (entry?.line ? { line: entry.line, ...(entry.file ? { file: entry.file } : {}) } : undefined);
  return {
    rule: 'reference-not-reverified',
    check: 'references',
    severity: 'warning',
    message: `\`${r.key}\` was added with \`overfull cite\` but could not be re-verified${r.reason === 'offline' ? ' (offline)' : r.reason ? `: ${r.reason}` : ''}`,
    ...(location ? { location } : {}),
    fix: 'Run the check again with network access; the entry’s DOI or arXiv id lets doi.org or arXiv confirm it.',
    data: { key: r.key, status: r.status },
  };
}

function authorProvidedProblem(r: RefResult, entry?: BibEntry): Problem {
  const location =
    r.location ??
    (entry?.line ? { line: entry.line, ...(entry.file ? { file: entry.file } : {}) } : undefined);
  return {
    rule: 'reference-unverifiable',
    check: 'references',
    severity: 'info',
    message: `\`${r.key}\` is marked \`overfull: author-provided\` and was not verified${r.reason ? ` (${r.reason})` : ''}`,
    ...(location ? { location } : {}),
    fix: 'The author vouches for this entry; check it by hand before submission.',
    data: { key: r.key, status: r.status, authorProvided: true },
  };
}

function problemFor(r: RefResult, entry?: BibEntry, requireProvenance = false): Problem | null {
  if (r.status !== 'verified' && r.status !== 'mismatch' && entry && isAuthorProvided(entry))
    return r.reason === 'offline' || r.reason === 'skipped by author'
      ? null
      : authorProvidedProblem(r, entry);
  if (
    requireProvenance &&
    entry &&
    (r.reason === 'offline' || r.status === 'error') &&
    hasValidProvenance(entry)
  )
    return notReverifiedProblem(r, entry);
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
          detail: [
            `arXiv has “${r.wrongWork.title}” as ${r.wrongWork.id}, not the cited work`,
            ...others,
          ].join('; '),
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

/** Entries whose lookups failed for network reasons before they are folded into one problem. */
const COLLAPSE_AT = 3;

/** Hosts that could not be reached (network error, timeout) in a lookup-failure reason. */
export function unreachableHosts(reason: string | undefined): string[] {
  const hosts: string[] = [];
  for (const part of (reason ?? '').replace(/^lookup incomplete: /, '').split('; ')) {
    const m = /^([A-Za-z0-9.-]+\.[A-Za-z]{2,}): (?:network error|timed out)/.exec(part);
    if (m?.[1]) hosts.push(m[1]);
  }
  return hosts;
}

/**
 * When many entries could not be looked up because an index was unreachable, the
 * per-entry warnings say the same thing N times: replace them (in place) with one
 * `reference-lookup-failed` problem. Per-entry detail stays in data and evidence.
 */
function collapseNetworkFailures(problems: Problem[], results: RefResult[]): void {
  const byKey = new Map(results.map((r) => [r.key, r]));
  const network = problems.filter((p) => {
    if (p.rule !== 'reference-lookup-failed' && p.rule !== 'reference-not-reverified') return false;
    const r = byKey.get(String(p.data?.key));
    return r?.status === 'error' && unreachableHosts(r.reason).length > 0;
  });
  if (network.length < COLLAPSE_AT) return;
  const entries = network.map((p) => {
    const r = byKey.get(String(p.data?.key)) as RefResult;
    return { key: r.key, reason: r.reason ?? '', ...(p.location ? { location: p.location } : {}) };
  });
  const hosts = [...new Set(entries.flatMap((e) => unreachableHosts(e.reason)))];
  const hostText =
    hosts.length === 1 ? hosts[0] : `${hosts.slice(0, -1).join(', ')} and ${hosts.at(-1)}`;
  const summary: Problem = {
    rule: 'reference-lookup-failed',
    check: 'references',
    severity: 'warning',
    message: `Could not reach ${hostText}; ${entries.length} entries were not re-verified. Run again when online.`,
    detail:
      'A network problem is not evidence against the references; they were neither confirmed nor ruled out.',
    fix: 'Run `overfull check` again with network access. Entries with a DOI or arXiv id can be confirmed by doi.org or arXiv even when a title search index is unreachable.',
    evidence: entries.map((e) => `${e.key}: ${e.reason}`).join('\n'),
    data: { keys: entries.map((e) => e.key), hosts, entries },
  };
  const drop = new Set(network);
  const at = problems.findIndex((p) => drop.has(p));
  const kept = problems.filter((p) => !drop.has(p));
  kept.splice(at, 0, summary);
  problems.splice(0, problems.length, ...kept);
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
    ...results
      .map((r) => problemFor(r, byKey.get(r.key), opts.requireProvenance))
      .filter((p): p is Problem => p !== null),
    ...results
      .filter((r) => {
        if (r.unproven) return true;
        const entry = byKey.get(r.key);
        return Boolean(opts.requireProvenance && entry && isUnproven(entry, r));
      })
      .map((r) => unprovenProblem(r, byKey.get(r.key))),
  ];
  collapseNetworkFailures(problems, results);
  if (problems.some((p) => p.rule === 'reference-unproven')) {
    stats.unproven = problems.filter((p) => p.rule === 'reference-unproven').length;
  }
  if (
    results.some((r) => r.reason === 'offline') &&
    results.every((r) => r.reason === 'offline' || r.reason === 'skipped by author')
  ) {
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
