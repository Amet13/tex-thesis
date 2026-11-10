/**
 * A small ZIP reader for the browser check. It reads the central directory,
 * supports stored and deflate entries, and inflates with the built-in
 * DecompressionStream('deflate-raw'), so no library is needed. Nothing is
 * uploaded: the archive is read from memory in the page.
 *
 * Guards (see ZIP_LIMITS): entry count, total and per-entry uncompressed size
 * (declared sizes are checked first, then the real size is enforced while
 * inflating), unsafe paths, encrypted and ZIP64 archives.
 */

export const ZIP_LIMITS = {
  maxEntries: 2000,
  maxTotalBytes: 200 * 1024 * 1024,
  maxEntryBytes: 50 * 1024 * 1024,
};

export type ZipLimits = typeof ZIP_LIMITS;

export class ZipError extends Error {
  constructor(
    readonly code:
      | 'not-zip'
      | 'encrypted'
      | 'zip64'
      | 'unsupported'
      | 'too-many-entries'
      | 'too-large'
      | 'corrupt',
    message: string,
  ) {
    super(message);
    this.name = 'ZipError';
  }
}

export interface ZipFile {
  /** Clean relative path, forward slashes, common top-level folder removed. */
  path: string;
  data: Uint8Array;
}

export interface ZipResult {
  files: ZipFile[];
  /** Entries that were left out, with the reason. Directories are not listed. */
  skipped: { path: string; reason: string }[];
}

export interface ReadZipOptions {
  limits?: Partial<ZipLimits>;
  /** Only entries whose clean path passes are inflated; others are ignored silently. */
  filter?: (path: string) => boolean;
}

/**
 * Cleans a list of archive or folder paths: drops absolute paths and `..`,
 * `__MACOSX/` and dot-files, then strips a single common top-level folder.
 * Returns each kept path as `[original index, clean path]`.
 */
export function selectPaths(paths: string[]): {
  kept: { index: number; path: string }[];
  skipped: { path: string; reason: string }[];
} {
  const skipped: { path: string; reason: string }[] = [];
  const safe: { index: number; parts: string[] }[] = [];
  const seen = new Set<string>();
  paths.forEach((raw, index) => {
    const p = raw.replace(/\\/g, '/');
    if (p.endsWith('/')) return;
    if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) {
      skipped.push({ path: raw, reason: 'absolute path' });
      return;
    }
    const parts = p.split('/').filter((s) => s !== '' && s !== '.');
    if (parts.includes('..')) {
      skipped.push({ path: raw, reason: 'path leaves the project folder' });
      return;
    }
    if (parts.includes('__MACOSX') || parts.some((s) => s.startsWith('.'))) return;
    if (!parts.length) return;
    const key = parts.join('/');
    if (seen.has(key)) {
      skipped.push({ path: raw, reason: 'duplicate path' });
      return;
    }
    seen.add(key);
    safe.push({ index, parts });
  });
  const first = safe[0]?.parts[0];
  const strip =
    safe.length > 0 && safe.every((s) => s.parts.length > 1 && s.parts[0] === first) ? 1 : 0;
  return {
    kept: safe.map((s) => ({ index: s.index, path: s.parts.slice(strip).join('/') })),
    skipped,
  };
}

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

interface Entry {
  name: string;
  method: number;
  crc: number;
  csize: number;
  usize: number;
  offset: number;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++)
    c = (CRC_TABLE[(c ^ (data[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function readDirectory(buf: Uint8Array, maxEntries: number): Entry[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (u32(view, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('not-zip', 'This file is not a readable .zip archive.');
  if (eocd >= 20 && u32(view, eocd - 20) === 0x07064b50) throw zip64Error();
  const disk = u16(view, eocd + 4);
  const cdDisk = u16(view, eocd + 6);
  const count = u16(view, eocd + 10);
  const cdSize = u32(view, eocd + 12);
  const cdOffset = u32(view, eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw zip64Error();
  if (disk !== 0 || cdDisk !== 0)
    throw new ZipError(
      'unsupported',
      'This .zip is split over several files, which is not supported.',
    );
  if (count > maxEntries)
    throw new ZipError(
      'too-many-entries',
      `This .zip has ${count} entries; the limit is ${maxEntries}. Zip only the project’s source files.`,
    );
  const out: Entry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || u32(view, p) !== 0x02014b50)
      throw new ZipError('corrupt', 'The .zip’s file list is damaged.');
    const flags = u16(view, p + 8);
    if (flags & 0x1 || flags & 0x40)
      throw new ZipError(
        'encrypted',
        'This .zip is password-protected. Download the source again without a password.',
      );
    const csize = u32(view, p + 20);
    const usize = u32(view, p + 24);
    const offset = u32(view, p + 42);
    if (csize === 0xffffffff || usize === 0xffffffff || offset === 0xffffffff) throw zip64Error();
    const nameLen = u16(view, p + 28);
    const extraLen = u16(view, p + 30);
    const commentLen = u16(view, p + 32);
    if (p + 46 + nameLen > buf.length)
      throw new ZipError('corrupt', 'The .zip’s file list is damaged.');
    const nameBytes = buf.subarray(p + 46, p + 46 + nameLen);
    const name = new TextDecoder('utf-8', { fatal: false }).decode(nameBytes);
    out.push({ name, method: u16(view, p + 10), crc: u32(view, p + 16), csize, usize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function zip64Error() {
  return new ZipError(
    'zip64',
    'This .zip uses the ZIP64 format for very large archives, which this page does not read. Zip only the source files, or run `overfull check` on the unzipped folder.',
  );
}

async function inflate(raw: Uint8Array, maxOut: number): Promise<Uint8Array> {
  const stream = new Blob([raw as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > maxOut) {
        await reader.cancel().catch(() => {});
        throw new ZipError('too-large', 'An entry inflated to more than its declared size.');
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof ZipError) throw err;
    throw new ZipError('corrupt', 'The .zip contains data that cannot be decompressed.');
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Reads a .zip held in memory. Throws ZipError with a message fit to show. */
export async function readZip(buf: Uint8Array, options: ReadZipOptions = {}): Promise<ZipResult> {
  const limits = { ...ZIP_LIMITS, ...options.limits };
  const entries = readDirectory(buf, limits.maxEntries);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const files = entries.filter((e) => !e.name.endsWith('/'));
  const declared = files.reduce((s, e) => s + e.usize, 0);
  if (declared > limits.maxTotalBytes)
    throw new ZipError(
      'too-large',
      `This .zip unpacks to ${Math.ceil(declared / 1048576)} MB; the limit is ${Math.round(limits.maxTotalBytes / 1048576)} MB. Zip only the source files.`,
    );

  const { kept, skipped } = selectPaths(entries.map((e) => e.name));
  const result: ZipResult = { files: [], skipped };
  let total = 0;
  for (const { index, path } of kept) {
    const e = entries[index] as Entry;
    if (options.filter && !options.filter(path)) continue;
    if (e.usize > limits.maxEntryBytes) {
      result.skipped.push({ path, reason: 'file is too large' });
      continue;
    }
    if (e.method !== 0 && e.method !== 8)
      throw new ZipError('unsupported', `${path} uses a compression method this page cannot read.`);
    if (e.offset + 30 > buf.length || u32(view, e.offset) !== 0x04034b50)
      throw new ZipError('corrupt', 'The .zip is damaged.');
    const start = e.offset + 30 + u16(view, e.offset + 26) + u16(view, e.offset + 28);
    if (start + e.csize > buf.length) throw new ZipError('corrupt', 'The .zip is cut off.');
    const raw = buf.subarray(start, start + e.csize);
    const budget = Math.min(e.usize, limits.maxEntryBytes, limits.maxTotalBytes - total);
    const data = e.method === 0 ? raw : await inflate(raw, budget);
    if (data.length > budget)
      throw new ZipError('too-large', 'An entry is larger than its declared size.');
    if (data.length !== e.usize || crc32(data) !== e.crc)
      throw new ZipError('corrupt', `${path} does not match its recorded size or checksum.`);
    total += data.length;
    result.files.push({ path, data });
  }
  return result;
}
