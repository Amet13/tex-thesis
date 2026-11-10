#!/usr/bin/env node
// Validate venues/*.yml and generate packages/core/src/venue/venues.generated.ts (no dependencies
// beyond the repository's `yaml` dev dependency). Core never parses YAML: it imports the
// generated module.
//
// Usage:
//   node scripts/build-venues.mjs            validate and write the generated module
//   node scripts/build-venues.mjs --check    exit 1 if a file is invalid or the module is stale (CI)
//   --dir <folder>   read profiles from another folder (tests)
//   --out <file>     write/check another output file (tests)
//   --print          print the validated profiles as JSON and exit

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const check = args.includes('--check');
const dir = resolve(flag('--dir') ?? join(root, 'venues'));
const out = resolve(flag('--out') ?? join(root, 'packages/core/src/venue/venues.generated.ts'));

const BUILTIN = ['generic', 'thesis', 'paper', 'arxiv', 'double-blind'];
const LEVELS = ['required', 'recommended', 'off'];
const KEYS = [
  'id',
  'name',
  'description',
  'extends',
  'year',
  'source',
  'checkedOn',
  'paper',
  'pageLimit',
  'anonymous',
  'disclosure',
  'accessibility',
  'arxiv',
  'styleFiles',
  'textBlock',
  'notes',
];
const REQUIRED = ['id', 'name', 'year', 'source', 'checkedOn'];

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim() !== '';

function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Returns { data, errors } for one parsed YAML document. `file` is the file's base name. */
export function validateProfile(raw, file) {
  const errors = [];
  const err = (m) => errors.push(`${file}: ${m}`);
  if (!isObj(raw)) return { errors: [`${file}: must be a mapping`] };
  for (const k of Object.keys(raw)) if (!KEYS.includes(k)) err(`unknown field "${k}"`);
  for (const k of REQUIRED) if (raw[k] === undefined || raw[k] === null) err(`missing "${k}"`);
  const data = {};
  if (raw.id !== undefined) {
    if (typeof raw.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(raw.id))
      err('"id" must be lower-case words joined by "-", e.g. neurips-2027');
    else if (BUILTIN.includes(raw.id)) err(`"id" ${raw.id} is a built-in profile`);
    else if (`${raw.id}.yml` !== file) err(`"id" must match the file name (${raw.id}.yml)`);
    data.id = raw.id;
  }
  if (raw.name !== undefined) {
    if (!isStr(raw.name)) err('"name" must be text');
    data.name = raw.name;
  }
  if (raw.description !== undefined) {
    if (!isStr(raw.description)) err('"description" must be text');
    data.description = raw.description;
  }
  if (raw.extends !== undefined) {
    if (!BUILTIN.includes(raw.extends)) err(`"extends" must be one of ${BUILTIN.join(', ')}`);
    data.extends = raw.extends;
  }
  if (raw.year !== undefined && raw.year !== null) {
    if (
      raw.year !== 'rolling' &&
      !(Number.isInteger(raw.year) && raw.year >= 1990 && raw.year < 2200)
    )
      err('"year" must be a year or "rolling"');
    data.year = raw.year;
  }
  if (raw.source !== undefined && raw.source !== null) {
    const list = Array.isArray(raw.source) ? raw.source : [raw.source];
    if (!list.length || !list.every((u) => typeof u === 'string' && /^https?:\/\/[^\s]+$/.test(u)))
      err('"source" must be one or more http(s) URLs of the official pages');
    data.source = list;
  }
  if (raw.checkedOn !== undefined && raw.checkedOn !== null) {
    // yaml parses an unquoted 2026-11-10 as a string with the default (core) schema.
    const s =
      raw.checkedOn instanceof Date ? raw.checkedOn.toISOString().slice(0, 10) : raw.checkedOn;
    if (!validDate(s)) err('"checkedOn" must be a date like 2026-11-10');
    else if (s > new Date().toISOString().slice(0, 10)) err('"checkedOn" is in the future');
    data.checkedOn = s;
  }
  if (raw.paper !== undefined) {
    if (!['a4', 'letter', 'any'].includes(raw.paper)) err('"paper" must be a4, letter or any');
    data.paper = raw.paper;
  }
  if (raw.pageLimit !== undefined) {
    const pl = raw.pageLimit;
    if (!isObj(pl) || !Number.isInteger(pl.max) || pl.max <= 0) {
      err('"pageLimit" must be a mapping with a positive whole number "max"');
    } else {
      for (const k of Object.keys(pl))
        if (!['max', 'endLabel', 'counts', 'excludes'].includes(k))
          err(`unknown pageLimit field "${k}"`);
      const o = { max: pl.max };
      if (pl.endLabel !== undefined) {
        if (!isStr(pl.endLabel)) err('"pageLimit.endLabel" must be text');
        o.endLabel = pl.endLabel;
      }
      if (pl.counts !== undefined) {
        if (!isStr(pl.counts)) err('"pageLimit.counts" must be text');
        o.counts = pl.counts;
      }
      if (pl.excludes !== undefined) {
        if (!Array.isArray(pl.excludes) || !pl.excludes.every(isStr))
          err('"pageLimit.excludes" must be a list of text');
        o.excludes = pl.excludes;
      }
      data.pageLimit = o;
    }
  }
  for (const k of ['anonymous', 'arxiv']) {
    if (raw[k] === undefined) continue;
    if (typeof raw[k] !== 'boolean') err(`"${k}" must be true or false`);
    data[k] = raw[k];
  }
  for (const k of ['disclosure', 'accessibility']) {
    if (raw[k] === undefined) continue;
    if (!LEVELS.includes(raw[k])) err(`"${k}" must be ${LEVELS.join(', ')}`);
    data[k] = raw[k];
  }
  if (raw.styleFiles !== undefined) {
    if (!Array.isArray(raw.styleFiles)) {
      err('"styleFiles" must be a list');
    } else {
      data.styleFiles = raw.styleFiles.map((f, i) => {
        const item = typeof f === 'string' ? { name: f } : f;
        if (!isObj(item) || !isStr(item.name) || /[\\/]/.test(item.name)) {
          err(`styleFiles[${i}] needs a file name without a folder`);
          return { name: String(item?.name ?? '') };
        }
        for (const k of Object.keys(item))
          if (!['name', 'sha256'].includes(k)) err(`styleFiles[${i}]: unknown field "${k}"`);
        const o = { name: item.name };
        if (item.sha256 !== undefined) {
          if (typeof item.sha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(item.sha256))
            err(`styleFiles[${i}].sha256 must be 64 hex digits`);
          else o.sha256 = item.sha256.toLowerCase();
        }
        return o;
      });
    }
  }
  if (raw.textBlock !== undefined) {
    const tb = raw.textBlock;
    const num = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1000;
    if (!isObj(tb) || !num(tb.widthMm)) {
      err('"textBlock" must be a mapping with a positive "widthMm" (millimetres)');
    } else {
      const o = { widthMm: tb.widthMm };
      for (const k of Object.keys(tb)) {
        if (!['widthMm', 'heightMm', 'leftMm', 'topMm'].includes(k))
          err(`unknown textBlock field "${k}"`);
        else if (k !== 'widthMm') {
          if (!num(tb[k])) err(`"textBlock.${k}" must be a positive number of millimetres`);
          else o[k] = tb[k];
        }
      }
      data.textBlock = o;
    }
  }
  if (raw.notes !== undefined) {
    if (!isStr(raw.notes)) err('"notes" must be text');
    data.notes = typeof raw.notes === 'string' ? raw.notes.trim() : raw.notes;
  }
  return { data, errors };
}

/** Reads and validates every `*.yml` in `folder`. */
export function loadProfiles(folder) {
  const profiles = {};
  const errors = [];
  if (!existsSync(folder)) return { profiles, errors: [`${folder} does not exist`] };
  for (const file of readdirSync(folder)
    .filter((f) => /\.ya?ml$/i.test(f))
    .sort()) {
    if (!file.endsWith('.yml')) {
      errors.push(`${file}: use the .yml extension`);
      continue;
    }
    let raw;
    try {
      raw = parse(readFileSync(join(folder, file), 'utf8'), { schema: 'core' });
    } catch (e) {
      errors.push(`${file}: not valid YAML (${e.message.split('\n')[0]})`);
      continue;
    }
    const r = validateProfile(raw, file);
    errors.push(...r.errors);
    if (!r.errors.length) profiles[r.data.id] = r.data;
  }
  return { profiles, errors };
}

const ORDER = [...KEYS];

function literal(v, indent) {
  const pad = '  '.repeat(indent);
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return `[\n${v.map((x) => `${pad}  ${literal(x, indent + 1)},`).join('\n')}\n${pad}]`;
  }
  if (isObj(v)) {
    const keys = Object.keys(v);
    return `{\n${keys.map((k) => `${pad}  ${/^[A-Za-z_]\w*$/.test(k) ? k : JSON.stringify(k)}: ${literal(v[k], indent + 1)},`).join('\n')}\n${pad}}`;
  }
  return JSON.stringify(v);
}

export function generate(profiles) {
  const ids = Object.keys(profiles).sort();
  const body = ids.length
    ? `{\n${ids
        .map((id) => {
          const p = profiles[id];
          const sorted = Object.fromEntries(ORDER.filter((k) => k in p).map((k) => [k, p[k]]));
          return `  ${JSON.stringify(id)}: ${literal(sorted, 1)},`;
        })
        .join('\n')}\n}`
    : '{}';
  return `// Generated by scripts/build-venues.mjs from venues/*.yml. Do not edit; run \`node scripts/build-venues.mjs\`.
// biome-ignore-all format: generated file
import type { VenueProfileData } from './types.js';

export const venueProfileData: Record<string, VenueProfileData> = ${body};
`;
}

function main() {
  const { profiles, errors } = loadProfiles(dir);
  if (args.includes('--print')) {
    console.log(JSON.stringify({ profiles, errors }, null, 2));
    process.exit(errors.length ? 1 : 0);
  }
  if (errors.length) {
    for (const e of errors) console.error(`venues: ${e}`);
    process.exit(1);
  }
  const text = generate(profiles);
  const count = Object.keys(profiles).length;
  if (check) {
    const current = existsSync(out) ? readFileSync(out, 'utf8') : '';
    if (current !== text) {
      console.error(`venues: ${out} is stale. Run: node scripts/build-venues.mjs`);
      process.exit(1);
    }
    console.log(
      `venues: ${count} profile${count === 1 ? '' : 's'}, generated module is up to date`,
    );
    return;
  }
  writeFileSync(out, text);
  console.log(`venues: wrote ${out} (${count} profile${count === 1 ? '' : 's'})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
