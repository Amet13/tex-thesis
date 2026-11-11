#!/usr/bin/env node
// Checks every venue profile's style files against the official author kit. For each
// `styleFiles` item with a `kit` URL (a .zip, or the file itself), downloads the kit,
// computes the SHA-256 of the named file and compares it with the profile's `sha256`.
//
//   node scripts/venues-kits.mjs           print what differs (Markdown), change nothing
//   node scripts/venues-kits.mjs --write   also write the new hashes into venues/*.yml
//
// The kit is the authority for its own files, so a new hash is a mechanical update
// (venues-watch.yml opens a pull request with it). Nothing else in a profile is touched:
// `checkedOn` still means a person read the venue's rules.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { inflateRawSync } from 'node:zlib';
import { parse } from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The files in a ZIP archive, by base name: { name: Buffer }. Reads the central
 * directory; stored (0) and deflated (8) entries only, which is what kits use.
 */
export function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a ZIP archive (no end-of-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('broken ZIP central directory');
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || name.startsWith('__MACOSX/')) continue;
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataAt, dataAt + size);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = inflateRawSync(raw);
    else continue;
    const base = name.split('/').pop();
    // The first copy wins: kits sometimes carry an old copy in a subfolder.
    files[base] ??= data;
  }
  return files;
}

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** The named file from a downloaded kit: the ZIP's entry, or the download itself. */
export function fileFromKit(kitUrl, body, name) {
  const isZip = body.length > 4 && body.readUInt32LE(0) === 0x04034b50;
  if (isZip) return unzip(body)[name];
  return kitUrl.split('?')[0].endsWith(`/${name}`) ? body : undefined;
}

/** Replaces one style file's sha256 in a profile's YAML text, keeping everything else. */
export function setHash(text, name, oldHash, newHash) {
  const re = new RegExp(
    `(- name: ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n(?:\\s+\\w+: .*\\n)*?\\s+sha256: )${oldHash}`,
  );
  if (!re.test(text)) throw new Error(`no sha256 ${oldHash} under ${name}`);
  return text.replace(re, `$1${newHash}`);
}

async function download(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'overfull-venues-kits (+https://github.com/amet13/overfull)' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const { values } = parseArgs({ options: { write: { type: 'boolean' } } });
  const changed = [];
  const problems = [];
  for (const file of readdirSync(join(root, 'venues'))
    .filter((f) => f.endsWith('.yml'))
    .sort()) {
    const path = join(root, 'venues', file);
    let text = readFileSync(path, 'utf8');
    const v = parse(text);
    for (const sf of v.styleFiles ?? []) {
      if (typeof sf !== 'object' || !sf.kit || !sf.sha256) continue;
      let body;
      try {
        body = await download(sf.kit);
      } catch (err) {
        problems.push(`- \`${v.id}\`: the kit ${sf.kit} could not be downloaded (${err.message}).`);
        continue;
      }
      const data = fileFromKit(sf.kit, body, sf.name);
      if (!data) {
        problems.push(`- \`${v.id}\`: the kit ${sf.kit} no longer contains ${sf.name}.`);
        continue;
      }
      const now = sha256(data);
      if (now === sf.sha256.toLowerCase()) continue;
      changed.push(`- \`${v.id}\`: ${sf.name} changed in ${sf.kit} (sha256 ${now}).`);
      if (values.write) text = setHash(text, sf.name, sf.sha256, now);
    }
    if (values.write) writeFileSync(path, text);
  }
  if (changed.length)
    console.log(['Style files that changed in their official kits:', '', ...changed].join('\n'));
  if (problems.length)
    console.log(
      [changed.length ? '' : null, 'Kits that need a look:', '', ...problems]
        .filter((l) => l !== null)
        .join('\n'),
    );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
