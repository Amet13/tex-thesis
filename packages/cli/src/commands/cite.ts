import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  AmbiguousLookupError,
  type BibEntry,
  lookup as coreLookup,
  formatBibEntry,
  type LookupResult,
  parseBib,
  parseDoi,
  type RefsOptions,
  titleSimilarity,
} from '@overfull/core';
import { parse, str } from '../args.js';
import { loadConfig } from '../config.js';
import { type Io, UsageError } from '../io.js';
import { insideRoot } from '../safety.js';

export const citeHelp = `Usage: overfull cite <doi | arXiv:id | "title"> [options]

Look a reference up in CrossRef / doi.org / arXiv / dblp and append a clean
BibTeX entry to your .bib file. Prints the citation key as the last line.
Never invents an entry: without a confident match it exits 1 and writes nothing.

Options:
  --bib file      Bibliography to append to (default: first \`bib\` in overfull.yml)
  --key key       Use this citation key instead of the generated one
  --author name   Disambiguate a title: an author's surname
  --year yyyy     Disambiguate a title: the publication year
  --dry-run       Print the entry without writing it
  --json          Print {key, entry, source, confidence, added}
  --mailto addr   Contact address for CrossRef's polite pool
  --config file   Config file (default overfull.yml)
  -h, --help      Show this help

Examples:
  overfull cite 10.1145/359545.359563
  overfull cite arXiv:1706.03762
  overfull cite "Attention is all you need"
  overfull cite "Literate programming" --author Knuth

Short or shared titles are ambiguous: cite lists the candidates with their DOIs
and adds nothing. Pick one by DOI, or rerun with --author/--year.
`;

export type LookupFn = (query: string, opts: RefsOptions) => Promise<LookupResult | null>;

function doiOf(e: BibEntry): string | undefined {
  const d = e.fields.doi;
  return d ? (parseDoi(d) ?? d.toLowerCase()) : undefined;
}

/** An existing entry for the same work: same DOI, or same key with a matching title. */
export function findExisting(entries: BibEntry[], entry: BibEntry): BibEntry | undefined {
  const doi = doiOf(entry);
  if (doi) {
    const byDoi = entries.find((e) => doiOf(e) === doi);
    if (byDoi) return byDoi;
  }
  const arxiv = entry.fields.eprint?.toLowerCase();
  if (arxiv) {
    const byEprint = entries.find((e) => e.fields.eprint?.toLowerCase() === arxiv);
    if (byEprint) return byEprint;
  }
  const sameKey = entries.find((e) => e.key === entry.key);
  if (sameKey && titleSimilarity(sameKey.fields.title ?? '', entry.fields.title ?? '') >= 0.9)
    return sameKey;
  return undefined;
}

const SOURCE_NAMES: Record<string, string> = {
  'api.crossref.org': 'CrossRef',
  'data.crossref.org': 'CrossRef',
  'doi.org': 'doi.org',
  'export.arxiv.org': 'arXiv',
  'dblp.org': 'dblp',
  'api.openalex.org': 'OpenAlex',
};

/** Which reference indexes a lookup actually reached, and which failed (and why). */
export class SourceTracker {
  private readonly ok = new Set<string>();
  private readonly failed = new Map<string, string>();

  /** Wraps `fetch` so every request is recorded by source. */
  wrap(base: typeof fetch): typeof fetch {
    return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      let host = '';
      try {
        host = new URL(url).hostname;
      } catch {
        /* not a URL */
      }
      const name = SOURCE_NAMES[host] ?? host;
      try {
        const res = await base.call(globalThis, input, init);
        if (res.status >= 500 || res.status === 429) this.fail(name, `HTTP ${res.status}`);
        else this.ok.add(name);
        return res;
      } catch (err) {
        const cause =
          err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : '';
        this.fail(name, `${err instanceof Error ? err.message : String(err)}${cause}`);
        throw err;
      }
    }) as typeof fetch;
  }

  private fail(name: string, reason: string): void {
    if (!this.failed.has(name)) this.failed.set(name, reason);
  }

  /** Sources that answered at least once. */
  get searched(): string[] {
    return [...this.ok];
  }

  /** Sources that never answered, with the first reason. */
  get failures(): { source: string; reason: string }[] {
    return [...this.failed]
      .filter(([source]) => !this.ok.has(source))
      .map(([source, reason]) => ({ source, reason }));
  }
}

const list = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;

/**
 * Records where an entry came from: `x-overfull = {cite <source> <yyyy-mm-dd>}`.
 * BibTeX and biber ignore unknown fields; `overfull check` can require it.
 */
export function markCited(entry: BibEntry, source: string, date: Date = new Date()): BibEntry {
  const day = date.toISOString().slice(0, 10);
  return { ...entry, fields: { ...entry.fields, 'x-overfull': `cite ${source} ${day}` } };
}

function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (const suffix of 'bcdefghijklmnopqrstuvwxyz') {
    if (!taken.has(base + suffix)) return base + suffix;
  }
  return `${base}-${taken.size}`;
}

export async function citeCommand(
  args: string[],
  io: Io,
  lookup: LookupFn = coreLookup,
): Promise<number> {
  const { values, positionals } = parse(
    args,
    {
      bib: { type: 'string' },
      key: { type: 'string' },
      author: { type: 'string' },
      year: { type: 'string' },
      'dry-run': { type: 'boolean' },
      json: { type: 'boolean' },
      mailto: { type: 'string' },
      config: { type: 'string' },
    },
    'cite',
  );
  if (values.help) {
    io.stdout(citeHelp);
    return 0;
  }
  const query = positionals.join(' ').trim();
  if (!query)
    throw new UsageError('Give a DOI, arXiv id or title: `overfull cite 10.1145/359545.359563`');
  const config = loadConfig(io.cwd, str(values.config), io.env);
  const bibRel = str(values.bib) ?? config.bib[0] ?? 'references.bib';
  const bibPath = insideRoot(config.root, bibRel, 'Bibliography file');
  const text = existsSync(bibPath) ? readFileSync(bibPath, 'utf8') : '';
  const entries = parseBib(text);

  const mailto = str(values.mailto) ?? config.references.mailto;
  const openalexKey = io.env.OPENALEX_API_KEY;
  const author = str(values.author);
  const yearText = str(values.year);
  const year = yearText === undefined ? undefined : Number(yearText);
  if (year !== undefined && !(Number.isInteger(year) && year > 1000 && year < 3000)) {
    throw new UsageError(`--year must be a four-digit year, got \`${yearText}\``);
  }
  const hint =
    author || year !== undefined
      ? { ...(author ? { author } : {}), ...(year !== undefined ? { year } : {}) }
      : undefined;
  const tracker = new SourceTracker();
  const baseFetch = io.fetch ?? globalThis.fetch;
  const notFound = (message: string, failures: { source: string; reason: string }[]) => {
    if (values.json) {
      io.stdout(
        `${JSON.stringify({ found: false, query, searched: tracker.searched, failures, message }, null, 2)}\n`,
      );
    } else io.stderr(`${message}\n`);
    return 1;
  };
  let found: LookupResult | null;
  try {
    found = await lookup(query, {
      ...(baseFetch ? { fetch: tracker.wrap(baseFetch) } : {}),
      ...(mailto ? { mailto } : {}),
      ...(openalexKey ? { openalexKey } : {}),
      ...(hint ? { hint } : {}),
    });
  } catch (error) {
    if (!(error instanceof AmbiguousLookupError)) {
      // No source could be reached: a normal failure, not an internal error.
      const failures = tracker.failures.length
        ? tracker.failures
        : [{ source: 'lookup', reason: error instanceof Error ? error.message : String(error) }];
      return notFound(
        `Could not reach ${list(failures.map((f) => f.source))}: ${failures.map((f) => `${f.source}: ${f.reason}`).join('; ')}. ` +
          'Check your network or give a DOI/arXiv id later. Nothing was added.',
        failures,
      );
    }
    if (values.json) {
      io.stdout(
        `${JSON.stringify({ ambiguous: true, message: error.message, candidates: error.candidates }, null, 2)}\n`,
      );
    } else {
      const lines = error.candidates.map((c) => {
        const who = c.authors.length
          ? `${c.authors[0]}${c.authors.length > 1 ? ' et al.' : ''}`
          : 'unknown author';
        const id = c.doi
          ? `doi ${c.doi}`
          : c.arxivId
            ? `arXiv:${c.arxivId}`
            : `${c.source}, no DOI`;
        return `  - ${c.title} (${who}${c.year ? `, ${c.year}` : ''}${c.venue ? `, ${c.venue}` : ''}) — ${id}`;
      });
      io.stderr(
        `${error.message} Nothing was added.\n${lines.join('\n')}\n` +
          'Cite the right one by DOI (`overfull cite <doi>`), or rerun with --author/--year. If none is right, ask the author.\n',
      );
    }
    return 1;
  }
  if (!found) {
    const { searched, failures } = tracker;
    if (!searched.length && failures.length) {
      return notFound(
        `Could not reach ${list(failures.map((f) => f.source))}: ${failures.map((f) => `${f.source}: ${f.reason}`).join('; ')}. ` +
          'Check your network or give a DOI/arXiv id later. Nothing was added.',
        failures,
      );
    }
    const where = searched.length ? ` in ${list(searched)}` : '';
    const down = failures.length
      ? ` (${list(failures.map((f) => f.source))} could not be reached: ${failures.map((f) => f.reason).join('; ')})`
      : '';
    return notFound(
      `No confident match for "${query}"${where}${down}. Nothing was added.\n` +
        'Ask the author for the DOI or arXiv id (or the exact title), then run `overfull cite` again. Do not write the entry by hand from memory.',
      failures,
    );
  }
  const entry: BibEntry = { ...found.entry, fields: { ...found.entry.fields } };
  const explicitKey = str(values.key);
  if (explicitKey) entry.key = explicitKey;
  const existing = findExisting(entries, entry);
  const emit = (key: string, entryText: string, added: boolean, message: string) => {
    if (values.json) {
      io.stdout(
        `${JSON.stringify({ key, entry: entryText, source: found.source, confidence: found.confidence, added, bib: bibRel }, null, 2)}\n`,
      );
    } else {
      io.stdout(`${message}\n${key}\n`);
    }
  };
  if (existing) {
    emit(
      existing.key,
      existing.raw,
      false,
      `Already in ${bibRel} as \`${existing.key}\`; nothing added.`,
    );
    return 0;
  }
  const taken = new Set(entries.map((e) => e.key));
  if (explicitKey && taken.has(explicitKey)) {
    throw new UsageError(
      `Key \`${explicitKey}\` is already used in ${bibRel} by a different entry. Choose another --key.`,
    );
  }
  entry.key = uniqueKey(entry.key, taken);
  // Keep the file's line endings: a CRLF .bib gets CRLF entries.
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const formatted = formatBibEntry(markCited(entry, found.source)).replace(/\r?\n/g, eol);
  const where = `from ${found.source} (confidence ${found.confidence.toFixed(2)})`;
  if (values['dry-run']) {
    emit(
      entry.key,
      formatted,
      false,
      `${formatted}\nDry run: not written to ${bibRel}. Match ${where}.`,
    );
    return 0;
  }
  const sep =
    text === '' ? '' : /(\r?\n){2}$/.test(text) ? '' : /\r?\n$/.test(text) ? eol : eol + eol;
  writeFileSync(bibPath, `${text}${sep}${formatted}`);
  emit(
    entry.key,
    formatted,
    true,
    `Added \`${entry.key}\` to ${bibRel} ${where}. Cite it with \\cite{${entry.key}}.`,
  );
  return 0;
}
