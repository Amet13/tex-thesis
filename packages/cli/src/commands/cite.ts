import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BibEntry,
  formatBibEntry,
  type LookupResult,
  lookup as coreLookup,
  parseBib,
  parseDoi,
  type RefsOptions,
  titleSimilarity,
} from '@overfull/core';
import { parse, str } from '../args.js';
import { loadConfig } from '../config.js';
import { type Io, UsageError } from '../io.js';

export const citeHelp = `Usage: overfull cite <doi | arXiv:id | "title"> [options]

Look a reference up in CrossRef / doi.org / arXiv / dblp and append a clean
BibTeX entry to your .bib file. Prints the citation key as the last line.
Never invents an entry: without a confident match it exits 1 and writes nothing.

Options:
  --bib file      Bibliography to append to (default: first \`bib\` in overfull.yml)
  --key key       Use this citation key instead of the generated one
  --dry-run       Print the entry without writing it
  --json          Print {key, entry, source, confidence, added}
  --mailto addr   Contact address for CrossRef's polite pool
  --config file   Config file (default overfull.yml)
  -h, --help      Show this help

Examples:
  overfull cite 10.1145/359545.359563
  overfull cite arXiv:1706.03762
  overfull cite "Attention is all you need"
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
  if (sameKey && titleSimilarity(sameKey.fields.title ?? '', entry.fields.title ?? '') >= 0.9) return sameKey;
  return undefined;
}

function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (const suffix of 'bcdefghijklmnopqrstuvwxyz') {
    if (!taken.has(base + suffix)) return base + suffix;
  }
  return `${base}-${taken.size}`;
}

export async function citeCommand(args: string[], io: Io, lookup: LookupFn = coreLookup): Promise<number> {
  const { values, positionals } = parse(
    args,
    {
      bib: { type: 'string' },
      key: { type: 'string' },
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
  if (!query) throw new UsageError('Give a DOI, arXiv id or title: `overfull cite 10.1145/359545.359563`');
  const config = loadConfig(io.cwd, str(values.config), io.env);
  const bibRel = str(values.bib) ?? config.bib[0] ?? 'references.bib';
  const bibPath = join(config.root, bibRel);
  const text = existsSync(bibPath) ? readFileSync(bibPath, 'utf8') : '';
  const entries = parseBib(text);

  const mailto = str(values.mailto) ?? config.references.mailto;
  const openalexKey = io.env.OPENALEX_API_KEY;
  const found = await lookup(query, {
    ...(io.fetch ? { fetch: io.fetch } : {}),
    ...(mailto ? { mailto } : {}),
    ...(openalexKey ? { openalexKey } : {}),
  });
  if (!found) {
    io.stderr(
      `No confident match for "${query}" in CrossRef, arXiv or dblp. Nothing was added.\n` +
        'Ask the author for the DOI or arXiv id (or the exact title), then run `overfull cite` again. Do not write the entry by hand from memory.\n',
    );
    return 1;
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
    emit(existing.key, existing.raw, false, `Already in ${bibRel} as \`${existing.key}\`; nothing added.`);
    return 0;
  }
  const taken = new Set(entries.map((e) => e.key));
  if (explicitKey && taken.has(explicitKey)) {
    throw new UsageError(`Key \`${explicitKey}\` is already used in ${bibRel} by a different entry. Choose another --key.`);
  }
  entry.key = uniqueKey(entry.key, taken);
  const formatted = formatBibEntry(entry);
  const where = `from ${found.source} (confidence ${found.confidence.toFixed(2)})`;
  if (values['dry-run']) {
    emit(entry.key, formatted, false, `${formatted}\nDry run: not written to ${bibRel}. Match ${where}.`);
    return 0;
  }
  const sep = text === '' ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  writeFileSync(bibPath, `${text}${sep}${formatted}`);
  emit(entry.key, formatted, true, `Added \`${entry.key}\` to ${bibRel} ${where}. Cite it with \\cite{${entry.key}}.`);
  return 0;
}
