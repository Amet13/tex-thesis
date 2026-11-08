import type { BibEntry } from './parse.js';

const FIELD_ORDER = [
  'author',
  'editor',
  'title',
  'booktitle',
  'journal',
  'year',
  'volume',
  'number',
  'pages',
  'publisher',
  'doi',
  'url',
  'eprint',
  'archiveprefix',
];

function orderFields(names: string[]): string[] {
  const known = FIELD_ORDER.filter((n) => names.includes(n));
  const rest = names.filter((n) => !FIELD_ORDER.includes(n)).sort();
  return [...known, ...rest];
}

/**
 * Serializes an entry as clean, deterministic BibTeX: lowercase type and
 * field names, a fixed field order, aligned `=`, braced values, empty fields
 * dropped.
 */
export function formatBibEntry(entry: BibEntry): string {
  const names = orderFields(
    Object.keys(entry.fields)
      .map((n) => n.toLowerCase())
      .filter((n) => (entry.fields[n] ?? '').trim() !== ''),
  );
  const width = Math.max(0, ...names.map((n) => n.length));
  const lines = names.map((n) => `  ${n.padEnd(width)} = {${(entry.fields[n] as string).trim()}}`);
  const body = lines.length ? `\n${lines.join(',\n')},\n` : '\n';
  return `@${entry.type.toLowerCase()}{${entry.key},${body}}\n`;
}
