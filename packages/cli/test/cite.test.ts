import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BibEntry, LookupResult } from '@overfull/core';
import { describe, expect, it } from 'vitest';
import { citeCommand, type LookupFn } from '../src/commands/cite.js';
import { memIo, tempCopy } from './helpers.js';

function entry(key: string, fields: Record<string, string>, type = 'inproceedings'): BibEntry {
  return { key, type, fields, line: 1, raw: '' };
}

const vaswani: LookupResult = {
  entry: entry('vaswani2017attention', {
    author: 'Vaswani, Ashish and Shazeer, Noam',
    title: 'Attention is All you Need',
    booktitle: 'Advances in Neural Information Processing Systems',
    year: '2017',
    doi: '10.48550/arXiv.1706.03762',
  }),
  source: 'crossref',
  confidence: 0.98,
};

const knuth: LookupResult = {
  entry: entry(
    'knuth1984literate',
    { author: 'Knuth, Donald E.', title: 'Literate Programming', journal: 'The Computer Journal', year: '1984', doi: '10.1093/COMJNL/27.2.97' },
    'article',
  ),
  source: 'doi.org',
  confidence: 1,
};

const fixed =
  (result: LookupResult | null): LookupFn =>
  async () =>
    result;

describe('overfull cite', () => {
  it('appends a formatted entry and prints the key last', async () => {
    const dir = tempCopy('project');
    const io = memIo(dir);
    const before = readFileSync(join(dir, 'references.bib'), 'utf8');
    expect(await citeCommand(['Attention is all you need'], io, fixed(vaswani))).toBe(0);
    const lines = io.stdoutText().trimEnd().split('\n');
    expect(lines.at(-1)).toBe('vaswani2017attention');
    const after = readFileSync(join(dir, 'references.bib'), 'utf8');
    expect(after.startsWith(before)).toBe(true);
    expect(after).toContain('@inproceedings{vaswani2017attention,');
    expect(after.endsWith('}\n')).toBe(true);
  });

  it('refuses a duplicate DOI and prints the existing key', async () => {
    const dir = tempCopy('project');
    const io = memIo(dir);
    const before = readFileSync(join(dir, 'references.bib'), 'utf8');
    expect(await citeCommand(['10.1093/comjnl/27.2.97'], io, fixed(knuth))).toBe(0);
    expect(io.stdoutText().trimEnd().split('\n').at(-1)).toBe('knuth1984');
    expect(readFileSync(join(dir, 'references.bib'), 'utf8')).toBe(before);
  });

  it('exits 1 and writes nothing without a confident match', async () => {
    const dir = tempCopy('project');
    const io = memIo(dir);
    const before = readFileSync(join(dir, 'references.bib'), 'utf8');
    expect(await citeCommand(['A paper that does not exist'], io, fixed(null))).toBe(1);
    expect(io.stdoutText()).toBe('');
    expect(io.stderrText()).toContain('Ask the author');
    expect(readFileSync(join(dir, 'references.bib'), 'utf8')).toBe(before);
  });

  it('supports --key, --dry-run and --json', async () => {
    const dir = tempCopy('project');
    const io = memIo(dir);
    const before = readFileSync(join(dir, 'references.bib'), 'utf8');
    expect(await citeCommand(['x', '--key', 'attn', '--dry-run', '--json'], io, fixed(vaswani))).toBe(0);
    const out = JSON.parse(io.stdoutText()) as Record<string, unknown>;
    expect(out).toMatchObject({ key: 'attn', source: 'crossref', confidence: 0.98, added: false });
    expect(out.entry).toMatch(/^@inproceedings\{attn,/);
    expect(readFileSync(join(dir, 'references.bib'), 'utf8')).toBe(before);
  });

  it('suffixes a generated key that is taken by a different work', async () => {
    const dir = tempCopy('project');
    writeFileSync(join(dir, 'references.bib'), '@misc{vaswani2017attention, title = {Something else}}\n');
    const io = memIo(dir);
    await citeCommand(['x'], io, fixed(vaswani));
    expect(io.stdoutText().trimEnd().split('\n').at(-1)).toBe('vaswani2017attentionb');
  });

  it('rejects an explicit key used by a different entry', async () => {
    const io = memIo(tempCopy('project'));
    await expect(citeCommand(['x', '--key', 'rfc9110'], io, fixed(vaswani))).rejects.toThrow(/already used/);
  });

  it('writes to --bib', async () => {
    const dir = tempCopy('project');
    const io = memIo(dir);
    await citeCommand(['x', '--bib', 'extra.bib'], io, fixed(vaswani));
    expect(readFileSync(join(dir, 'extra.bib'), 'utf8')).toMatch(/^@inproceedings\{vaswani2017attention,/);
  });
});
