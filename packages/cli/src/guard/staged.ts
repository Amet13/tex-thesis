/**
 * `overfull guard --staged`: the pre-commit check for .bib files.
 *
 * Reads the staged version of every changed .bib file and, for each entry that
 * was added or changed since HEAD, requires one of: a valid `overfull cite`
 * provenance marker, `note = {overfull: author-provided}` or `overfull: skip`,
 * or (unless offline) a match in the indexes. Removed entries, entries that
 * only moved, and whitespace or field-order changes pass.
 */

import { execFile } from 'node:child_process';
import {
  type BibEntry,
  citeHint,
  hasValidProvenance,
  isAuthorProvided,
  parseBib,
  type RefResult,
  type RefsOptions,
  verifyEntries,
} from '@overfull/core';

export type GuardVia = 'provenance' | 'author-provided' | 'skip' | 'verified';

export interface GuardPassed {
  file: string;
  key: string;
  line: number;
  via: GuardVia;
}

export interface GuardBlocked {
  file: string;
  key: string;
  line: number;
  reason: string;
  /** The command that adds the reference properly. */
  cite: string;
  /** The line the author adds to vouch for an entry they wrote themselves. */
  authorProvided: string;
}

export interface StagedReport {
  status: 'pass' | 'blocked';
  /** .bib files with staged changes. */
  files: string[];
  /** Entries that were added or changed. */
  checked: number;
  passed: GuardPassed[];
  blocked: GuardBlocked[];
}

export const AUTHOR_PROVIDED_LINE = 'note = {overfull: author-provided}';

const MAX_BLOB_BYTES = 32 * 1024 * 1024;

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolveP, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=off', ...args],
      { cwd, encoding: 'utf8', maxBuffer: MAX_BLOB_BYTES, ...(env ? { env } : {}) },
      (err, stdout) => (err ? reject(err) : resolveP(stdout)),
    );
  });
}

/** A blob's text, or '' when it does not exist (no HEAD yet, a new file). */
async function blob(cwd: string, spec: string): Promise<string> {
  try {
    return await git(cwd, ['cat-file', 'blob', spec]);
  } catch {
    return '';
  }
}

interface Change {
  /** Path in the index. */
  path: string;
  /** Path at HEAD (differs on a rename). */
  oldPath: string;
}

const isBib = (p: string) => /\.bib$/i.test(p);

/** Staged additions, modifications and renames of .bib files (deletions have nothing to check). */
async function stagedBibChanges(cwd: string): Promise<Change[]> {
  const out = await git(cwd, [
    'diff',
    '--cached',
    '-M',
    '--name-status',
    '--diff-filter=ACMR',
    '-z',
  ]);
  const tok = out.split('\0');
  const changes: Change[] = [];
  for (let i = 0; i < tok.length; ) {
    const status = tok[i++] ?? '';
    if (!status) continue;
    const kind = status[0];
    if (kind === 'R' || kind === 'C') {
      const from = tok[i++] ?? '';
      const to = tok[i++] ?? '';
      if (isBib(to)) changes.push({ path: to, oldPath: kind === 'R' ? from : '' });
    } else {
      const p = tok[i++] ?? '';
      if (isBib(p)) changes.push({ path: p, oldPath: kind === 'M' ? p : '' });
    }
  }
  return changes;
}

/** Entry text with whitespace and field order removed, so only real changes differ. */
function canonical(e: BibEntry): string {
  const ws = (s: string) => s.replace(/\s+/g, ' ').trim();
  const fields = Object.entries(e.fields)
    .map(([k, v]) => `${k}=${ws(v)}`)
    .sort();
  return `${e.type.toLowerCase()}\u0000${e.key}\u0000${fields.join('\u0001')}`;
}

function citeCommandFor(entry: BibEntry, result: RefResult): string {
  // The title is untrusted text that may be pasted into a shell: no `$`, backtick or backslash.
  const title = entry.fields.title?.replace(/[`$\\!]/g, ' ');
  const safe: BibEntry = { ...entry, fields: { ...entry.fields, ...(title ? { title } : {}) } };
  return citeHint(result, safe);
}

export interface StagedOptions {
  cwd: string;
  offline: boolean;
  refs?: RefsOptions;
}

export async function guardStaged(opts: StagedOptions): Promise<StagedReport> {
  // `--show-toplevel` fails outside a repository: the caller reports it.
  const root = (await git(opts.cwd, ['rev-parse', '--show-toplevel'])).trim();
  const changes = await stagedBibChanges(root);
  const report: StagedReport = {
    status: 'pass',
    files: changes.map((c) => c.path),
    checked: 0,
    passed: [],
    blocked: [],
  };

  // Everything already at HEAD in the changed files: an entry that only moved between them is unchanged.
  const known = new Set<string>();
  for (const c of changes) {
    if (!c.oldPath) continue;
    for (const e of parseBib(await blob(root, `HEAD:${c.oldPath}`))) known.add(canonical(e));
  }

  const pending: { entry: BibEntry; file: string }[] = [];
  for (const c of changes) {
    for (const e of parseBib(await blob(root, `:${c.path}`))) {
      if (known.has(canonical(e))) continue;
      const entry = { ...e, file: c.path };
      const f = entry.fields;
      const note = `${f.note ?? ''} ${f.annote ?? ''}`;
      let via: GuardVia | undefined;
      if (hasValidProvenance(entry)) via = 'provenance';
      else if (isAuthorProvided(entry)) via = 'author-provided';
      else if (/overfull\s*:\s*skip/i.test(note)) via = 'skip';
      report.checked++;
      if (via) report.passed.push({ file: c.path, key: e.key, line: e.line, via });
      else pending.push({ entry, file: c.path });
    }
  }

  let results: RefResult[] = [];
  if (pending.length > 0 && !opts.offline) {
    results = await verifyEntries(
      pending.map((p) => p.entry),
      { ...opts.refs, requireProvenance: false },
    );
  }
  pending.forEach((p, i) => {
    const r = results[i];
    if (r?.status === 'verified') {
      report.passed.push({ file: p.file, key: p.entry.key, line: p.entry.line, via: 'verified' });
      return;
    }
    const why = opts.offline
      ? 'not added by `overfull cite`, and --offline skips the lookup'
      : r?.status === 'error' || r?.status === 'unverifiable'
        ? `not added by \`overfull cite\`, and the indexes could not be asked${r.reason ? ` (${r.reason})` : ''}`
        : 'not added by `overfull cite`, and no index confirms it';
    const result: RefResult = r ?? { key: p.entry.key, status: 'unverifiable' };
    report.blocked.push({
      file: p.file,
      key: p.entry.key,
      line: p.entry.line,
      reason: why,
      cite: citeCommandFor(p.entry, result),
      authorProvided: AUTHOR_PROVIDED_LINE,
    });
  });
  if (report.blocked.length > 0) report.status = 'blocked';
  return report;
}
