import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { chooseMain, selectForMain } from '../src/scripts/project';
import { readZip, selectPaths, ZipError } from '../src/scripts/zip';

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface TestEntry {
  name: string;
  data?: string | Buffer;
  method?: 0 | 8;
  flags?: number;
  /** Override the size written to the directory (to forge it). */
  declaredSize?: number;
}

function buildZip(entries: TestEntry[], opts: { zip64?: boolean } = {}): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.from(e.data ?? '');
    const method = e.method ?? 8;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(e.name);
    const flags = e.flags ?? 0;
    const crc = crc32(raw);
    const size = e.declaredSize ?? raw.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(flags, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(size, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(opts.zip64 ? 0xffff : entries.length, 8);
  eocd.writeUInt16LE(opts.zip64 ? 0xffff : entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, eocd]));
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe('readZip', () => {
  it('reads stored and deflate entries and strips one common top-level folder', async () => {
    const zip = buildZip([
      { name: 'proj/', method: 0 },
      { name: 'proj/main.tex', data: '\\documentclass{article}' },
      { name: 'proj/refs.bib', data: '@book{a,}', method: 0 },
      { name: 'proj/sections/intro.tex', data: 'Hello' },
    ]);
    const r = await readZip(zip);
    expect(r.files.map((f) => f.path)).toEqual(['main.tex', 'refs.bib', 'sections/intro.tex']);
    expect(text(r.files[0]?.data as Uint8Array)).toBe('\\documentclass{article}');
    expect(text(r.files[1]?.data as Uint8Array)).toBe('@book{a,}');
  });

  it('keeps folders when the root has several top-level entries', async () => {
    const r = await readZip(
      buildZip([
        { name: 'a/x.tex', data: 'x' },
        { name: 'b.tex', data: 'y' },
      ]),
    );
    expect(r.files.map((f) => f.path)).toEqual(['a/x.tex', 'b.tex']);
  });

  it('skips __MACOSX, dot-files, absolute and parent-directory paths', async () => {
    const r = await readZip(
      buildZip([
        { name: 'main.tex', data: 'ok' },
        { name: '__MACOSX/._main.tex', data: 'junk' },
        { name: '.DS_Store', data: 'junk' },
        { name: 'sub/.hidden', data: 'junk' },
        { name: '../evil.tex', data: 'bad' },
        { name: 'a/../../evil2.tex', data: 'bad' },
        { name: '/etc/passwd', data: 'bad' },
        { name: 'C:\\win.tex', data: 'bad' },
      ]),
    );
    expect(r.files.map((f) => f.path)).toEqual(['main.tex']);
    expect(r.skipped.map((s) => s.path).sort()).toEqual(
      ['../evil.tex', '/etc/passwd', 'C:\\win.tex', 'a/../../evil2.tex'].sort(),
    );
  });

  it('only inflates entries that pass the filter', async () => {
    const r = await readZip(
      buildZip([
        { name: 'main.tex', data: 'a' },
        { name: 'img.png', data: 'b' },
      ]),
      { filter: (p) => p.endsWith('.tex') },
    );
    expect(r.files.map((f) => f.path)).toEqual(['main.tex']);
  });

  it('rejects too many entries', async () => {
    const zip = buildZip(Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.tex`, data: 'x' })));
    await expect(readZip(zip, { limits: { maxEntries: 4 } })).rejects.toMatchObject({
      code: 'too-many-entries',
    });
  });

  it('rejects an archive whose declared total size is over the limit', async () => {
    const zip = buildZip([
      { name: 'a.tex', data: Buffer.alloc(600, 97) },
      { name: 'b.tex', data: Buffer.alloc(600, 98) },
    ]);
    await expect(readZip(zip, { limits: { maxTotalBytes: 1000 } })).rejects.toMatchObject({
      code: 'too-large',
    });
  });

  it('stops a zip bomb that declares a small size but inflates far more', async () => {
    const zeros = Buffer.alloc(8 * 1024 * 1024);
    const zip = buildZip([{ name: 'bomb.tex', data: zeros, declaredSize: 100 }]);
    expect(zip.length).toBeLessThan(100 * 1024);
    const err = await readZip(zip).catch((e) => e);
    expect(err).toBeInstanceOf(ZipError);
    expect(err.code).toBe('too-large');
  });

  it('skips a single entry over the per-entry limit and keeps the rest', async () => {
    const zip = buildZip([
      { name: 'big.pdf', data: Buffer.alloc(5000, 1) },
      { name: 'main.tex', data: 'ok' },
    ]);
    const r = await readZip(zip, { limits: { maxEntryBytes: 1000 } });
    expect(r.files.map((f) => f.path)).toEqual(['main.tex']);
    expect(r.skipped).toEqual([{ path: 'big.pdf', reason: 'file is too large' }]);
  });

  it('rejects encrypted archives with a clear message', async () => {
    const zip = buildZip([{ name: 'main.tex', data: 'x', flags: 1 }]);
    const err = await readZip(zip).catch((e) => e);
    expect(err.code).toBe('encrypted');
    expect(err.message).toMatch(/password/);
  });

  it('rejects zip64 archives with a clear message', async () => {
    const err = await readZip(buildZip([{ name: 'a.tex', data: 'x' }], { zip64: true })).catch(
      (e) => e,
    );
    expect(err.code).toBe('zip64');
    expect(err.message).toMatch(/ZIP64/);
  });

  it('rejects files that are not zips and damaged data', async () => {
    await expect(
      readZip(new TextEncoder().encode('not a zip at all, really')),
    ).rejects.toMatchObject({
      code: 'not-zip',
    });
    const zip = buildZip([{ name: 'a.tex', data: 'hello hello hello hello' }]);
    zip[40] = (zip[40] as number) ^ 0xff;
    await expect(readZip(zip)).rejects.toBeInstanceOf(ZipError);
  });
});

describe('selectPaths', () => {
  it('does not strip when a file sits at the root', () => {
    const r = selectPaths(['a/x.tex', 'y.tex']);
    expect(r.kept.map((k) => k.path)).toEqual(['a/x.tex', 'y.tex']);
  });
});

describe('project main file', () => {
  const tex = (path: string, text: string) => ({ path, kind: 'tex' as const, text });
  const other = (path: string, kind: 'log' | 'pdf' | 'bib' | 'aux') => ({ path, kind, text: '' });

  it('prefers main.tex', () => {
    expect(chooseMain([tex('thesis.tex', '\\documentclass{x}'), tex('main.tex', '')]).main).toBe(
      'main.tex',
    );
  });
  it('takes the only root file with an uncommented documentclass', () => {
    const r = chooseMain([
      tex('paper.tex', '\\documentclass{article}'),
      tex('notes.tex', '% \\documentclass{article}'),
      tex('sections/a.tex', '\\documentclass{x}'),
    ]);
    expect(r.main).toBe('paper.tex');
  });
  it('uses a matching log or pdf to settle several candidates, else asks', () => {
    const a = tex('a.tex', '\\documentclass{x}');
    const b = tex('b.tex', '\\documentclass{x}');
    expect(chooseMain([a, b, other('b.pdf', 'pdf')]).main).toBe('b.tex');
    const ask = chooseMain([a, b]);
    expect(ask.main).toBeUndefined();
    expect(ask.candidates).toEqual(['a.tex', 'b.tex']);
  });
  it('selects the files that belong to the main file', () => {
    const files = [
      tex('main.tex', ''),
      other('refs.bib', 'bib'),
      other('main.log', 'log'),
      other('other.log', 'log'),
      other('main.pdf', 'pdf'),
      other('main.aux', 'aux'),
    ];
    expect(
      selectForMain(files, 'main.tex')
        .map((f) => f.path)
        .sort(),
    ).toEqual(['main.aux', 'main.log', 'main.pdf', 'main.tex', 'refs.bib']);
  });
});
