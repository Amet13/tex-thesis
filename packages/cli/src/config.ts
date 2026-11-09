import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import {
  CHECK_IDS,
  type CheckId,
  type InlineProfile,
  resolveProfile,
  UnknownProfileError,
  type VenueProfile,
} from '@overfull/core';
import { parse as parseYaml } from 'yaml';
import { UsageError } from './io.js';
import { safeImage, safeJobname, safeRelPath } from './safety.js';

export const DEFAULT_IMAGE = 'ghcr.io/amet13/overfull:0.1';
export const CONFIG_FILE = 'overfull.yml';

export type Engine = 'auto' | 'local' | 'docker';

export interface Config {
  /** Absolute project root (directory of overfull.yml, or cwd). */
  root: string;
  /** Absolute path of the config file, when one was loaded. */
  file?: string;
  main: string;
  jobname: string;
  bib: string[];
  profile: VenueProfile;
  /** Inline venue overrides from overfull.yml (re-applied when `--profile` changes the base). */
  venue: InlineProfile;
  checks: CheckId[];
  references: {
    mailto?: string;
    ignore: string[];
    /** Where reference lookups are cached: the user cache dir (default) or `.overfull/cache`. */
    cache: 'user' | 'project';
    /** Require every entry to carry `x-overfull = {cite …}` provenance. */
    requireCite: boolean;
  };
  build: {
    engine: Engine;
    image: string;
    /** latexmk output directory, relative to root: build.outDir, else the .latexmkrc $out_dir, else '.'. */
    outDir: string;
    /** latexmk aux directory (the .latexmkrc $aux_dir, else outDir). */
    auxDir: string;
    /** True when outDir comes from overfull.yml, so `overfull build` passes -outdir/-auxdir. */
    outDirFromConfig: boolean;
  };
}

/** `$out_dir` / `$aux_dir` set in the project's .latexmkrc (a simple assignment only). */
export function latexmkrcDirs(root: string): { outDir?: string; auxDir?: string } {
  const out: { outDir?: string; auxDir?: string } = {};
  for (const name of ['.latexmkrc', 'latexmkrc']) {
    const p = join(root, name);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8').replace(/(^|[^\\$])#.*$/gm, '$1');
    const o = /\$out_dir\s*=\s*['"]([^'"]+)['"]/.exec(text);
    const a = /\$aux_dir\s*=\s*['"]([^'"]+)['"]/.exec(text);
    // Only plain relative directories are used; anything else (variables, absolute paths) is ignored.
    const plain = (d: string | undefined) =>
      d !== undefined &&
      /^[A-Za-z0-9._/-]+$/.test(d) &&
      !d.startsWith('/') &&
      !d.startsWith('-') &&
      !d.split('/').includes('..');
    if (plain(o?.[1])) out.outDir = o?.[1] as string;
    if (plain(a?.[1])) out.auxDir = a?.[1] as string;
    break;
  }
  return out;
}

const TOP_KEYS = ['main', 'jobname', 'bib', 'profile', 'checks', 'references', 'venue', 'build'];
const VENUE_KEYS = [
  'pageLimit',
  'paper',
  'anonymous',
  'disclosure',
  'accessibility',
  'arxiv',
  'checks',
  'name',
  'description',
  'extends',
];
const LEVELS = ['required', 'recommended', 'off'];

class ConfigError extends UsageError {
  constructor(file: string, message: string) {
    super(`${basename(file)}: ${message}`);
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function stringList(v: unknown, field: string, file: string): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[];
  throw new ConfigError(file, `\`${field}\` must be a string or a list of strings`);
}

function closest(word: string, options: string[]): string | undefined {
  const dist = (a: string, b: string) => {
    const d = Array.from(
      { length: a.length + 1 },
      (_, i) => [i, ...Array(b.length).fill(0)] as number[],
    );
    for (let j = 1; j <= b.length; j++) (d[0] as number[])[j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const row = d[i] as number[];
        const prev = d[i - 1] as number[];
        row[j] = Math.min(
          (prev[j] as number) + 1,
          (row[j - 1] as number) + 1,
          (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      }
    }
    return (d[a.length] as number[])[b.length] as number;
  };
  const best = options
    .map((o) => ({ o, d: dist(word.toLowerCase(), o.toLowerCase()) }))
    .sort((x, y) => x.d - y.d)[0];
  return best && best.d <= Math.max(2, Math.floor(word.length / 3)) ? best.o : undefined;
}

function checkKeys(obj: Obj, allowed: string[], where: string, file: string): void {
  for (const k of Object.keys(obj)) {
    if (allowed.includes(k)) continue;
    const hint = closest(k, allowed);
    throw new ConfigError(
      file,
      `unknown key \`${where}${k}\`${hint ? ` (did you mean \`${where}${hint}\`?)` : ''}`,
    );
  }
}

function validateVenue(v: unknown, file: string): InlineProfile {
  if (!isObj(v)) throw new ConfigError(file, '`venue` must be a mapping');
  checkKeys(v, VENUE_KEYS, 'venue.', file);
  const out: InlineProfile = {};
  if (v.pageLimit !== undefined) {
    const pl = v.pageLimit;
    if (typeof pl === 'number') out.pageLimit = { max: pl };
    else if (isObj(pl) && typeof pl.max === 'number' && pl.max > 0) {
      out.pageLimit = { max: pl.max };
      if (pl.endLabel !== undefined) {
        if (typeof pl.endLabel !== 'string')
          throw new ConfigError(file, '`venue.pageLimit.endLabel` must be a string');
        out.pageLimit.endLabel = pl.endLabel;
      }
    } else
      throw new ConfigError(
        file,
        '`venue.pageLimit` must be a number or `{ max: 9, endLabel: overfull:main-end }`',
      );
  }
  if (v.paper !== undefined) {
    if (!['a4', 'letter', 'any'].includes(String(v.paper)))
      throw new ConfigError(file, '`venue.paper` must be a4, letter or any');
    out.paper = v.paper as 'a4' | 'letter' | 'any';
  }
  for (const k of ['anonymous', 'arxiv'] as const) {
    if (v[k] === undefined) continue;
    if (typeof v[k] !== 'boolean')
      throw new ConfigError(file, `\`venue.${k}\` must be true or false`);
    out[k] = v[k] as boolean;
  }
  for (const k of ['disclosure', 'accessibility'] as const) {
    if (v[k] === undefined) continue;
    if (!LEVELS.includes(String(v[k])))
      throw new ConfigError(file, `\`venue.${k}\` must be required, recommended or off`);
    out[k] = v[k] as 'required' | 'recommended' | 'off';
  }
  for (const k of ['name', 'description', 'extends'] as const) {
    if (v[k] !== undefined) out[k] = String(v[k]);
  }
  if (v.checks !== undefined) out.checks = parseChecks(v.checks, file, 'venue.checks');
  return out;
}

export function parseChecks(v: unknown, file: string, field = 'checks'): CheckId[] {
  const list = stringList(v, field, file);
  for (const c of list) {
    if (!(CHECK_IDS as readonly string[]).includes(c)) {
      throw new ConfigError(
        file,
        `unknown check "${c}" in \`${field}\`; use ${CHECK_IDS.join(', ')}`,
      );
    }
  }
  return list as CheckId[];
}

/** Bibliography files named in the main file, or every *.bib in the root. */
export function discoverBib(root: string, main: string): string[] {
  const mainPath = join(root, main);
  if (existsSync(mainPath)) {
    const src = readFileSync(mainPath, 'utf8').replace(/(^|[^\\])%.*$/gm, '$1');
    const found: string[] = [];
    for (const m of src.matchAll(/\\addbibresource(?:\[[^\]]*\])?\{([^}]+)\}/g))
      found.push((m[1] as string).trim());
    for (const m of src.matchAll(/\\bibliography\{([^}]+)\}/g)) {
      for (const b of (m[1] as string).split(',')) {
        const name = b.trim();
        if (name) found.push(name.endsWith('.bib') ? name : `${name}.bib`);
      }
    }
    const rel = dirname(main);
    const resolved = found.map((f) => (rel === '.' || isAbsolute(f) ? f : join(rel, f)));
    if (resolved.length) return [...new Set(resolved)];
  }
  try {
    return readdirSync(root)
      .filter((f) => f.endsWith('.bib'))
      .sort();
  } catch {
    return [];
  }
}

/** Finds overfull.yml in `cwd` (or uses `explicit`) and returns the validated config with defaults. */
export function loadConfig(
  cwd: string,
  explicit?: string,
  env: Record<string, string | undefined> = {},
): Config {
  let file: string | undefined;
  if (explicit) {
    file = resolve(cwd, explicit);
    if (!existsSync(file)) throw new UsageError(`Config file not found: ${explicit}`);
  } else if (existsSync(join(cwd, CONFIG_FILE))) {
    file = join(cwd, CONFIG_FILE);
  } else if (existsSync(join(cwd, 'overfull.yaml'))) {
    file = join(cwd, 'overfull.yaml');
  }
  const root = file ? dirname(file) : cwd;
  let raw: Obj = {};
  if (file) {
    let data: unknown;
    try {
      data = parseYaml(readFileSync(file, 'utf8'));
    } catch (err) {
      throw new ConfigError(
        file,
        `invalid YAML: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
      );
    }
    if (data !== null && data !== undefined && !isObj(data))
      throw new ConfigError(file, 'must be a mapping of keys to values');
    raw = (data as Obj | null) ?? {};
    checkKeys(raw, TOP_KEYS, '', file);
  }
  const f = file ?? join(root, CONFIG_FILE);
  if (raw.main !== undefined && typeof raw.main !== 'string')
    throw new ConfigError(f, '`main` must be a file name');
  const main = safeRelPath((raw.main as string | undefined) ?? 'main.tex');
  if (raw.jobname !== undefined && typeof raw.jobname !== 'string')
    throw new ConfigError(f, '`jobname` must be a string');
  const jobname = safeJobname(
    (raw.jobname as string | undefined) ?? basename(main).replace(/\.tex$/i, ''),
  );
  const bib = raw.bib !== undefined ? stringList(raw.bib, 'bib', f) : discoverBib(root, main);

  let inline: InlineProfile = {};
  let profileName = 'generic';
  if (typeof raw.profile === 'string') profileName = raw.profile;
  else if (isObj(raw.profile)) inline = validateVenue(raw.profile, f);
  else if (raw.profile !== undefined) throw new ConfigError(f, '`profile` must be a profile name');
  if (raw.venue !== undefined) inline = { ...inline, ...validateVenue(raw.venue, f) };
  let profile: VenueProfile;
  try {
    profile = resolveProfile({ extends: inline.extends ?? profileName, ...inline });
  } catch (err) {
    if (err instanceof UnknownProfileError) throw new ConfigError(f, err.message);
    throw err;
  }
  const checks =
    raw.checks !== undefined ? parseChecks(raw.checks, f) : (profile.checks ?? [...CHECK_IDS]);

  const refs = raw.references ?? {};
  if (!isObj(refs)) throw new ConfigError(f, '`references` must be a mapping');
  checkKeys(refs, ['mailto', 'ignore', 'cache', 'requireCite'], 'references.', f);
  const cache = refs.cache ?? 'user';
  if (cache !== 'user' && cache !== 'project')
    throw new ConfigError(f, '`references.cache` must be user or project');
  if (refs.requireCite !== undefined && typeof refs.requireCite !== 'boolean')
    throw new ConfigError(f, '`references.requireCite` must be true or false');
  const requireCite = refs.requireCite === true;
  const mailto = (typeof refs.mailto === 'string' ? refs.mailto : undefined) ?? env.OVERFULL_MAILTO;
  const ignore = refs.ignore !== undefined ? stringList(refs.ignore, 'references.ignore', f) : [];

  const build = raw.build ?? {};
  if (!isObj(build)) throw new ConfigError(f, '`build` must be a mapping');
  checkKeys(build, ['engine', 'image', 'outDir'], 'build.', f);
  const engine = (build.engine ?? 'auto') as Engine;
  if (!['auto', 'local', 'docker'].includes(engine))
    throw new ConfigError(f, '`build.engine` must be auto, local or docker');
  if (build.image !== undefined && typeof build.image !== 'string')
    throw new ConfigError(f, '`build.image` must be a Docker image name');
  const image = env.OVERFULL_IMAGE
    ? safeImage(env.OVERFULL_IMAGE, 'OVERFULL_IMAGE')
    : build.image
      ? safeImage(build.image as string, 'build.image in overfull.yml')
      : DEFAULT_IMAGE;
  if (build.outDir !== undefined && typeof build.outDir !== 'string')
    throw new ConfigError(f, '`build.outDir` must be a directory name');
  const rc = latexmkrcDirs(root);
  const norm = (d: string) =>
    d === '.' || d === './' ? '.' : d.replace(/^\.\//, '').replace(/\/+$/, '');
  const outDir = norm(
    safeRelPath((build.outDir as string | undefined) ?? rc.outDir ?? '.', 'output directory'),
  );
  const auxDir =
    build.outDir !== undefined ? outDir : norm(safeRelPath(rc.auxDir ?? outDir, 'aux directory'));

  const config: Config = {
    root,
    main,
    jobname,
    bib,
    profile,
    venue: inline,
    checks,
    references: { ...(mailto ? { mailto } : {}), ignore, cache, requireCite },
    build: { engine, image, outDir, auxDir, outDirFromConfig: build.outDir !== undefined },
  };
  if (file) config.file = file;
  return config;
}

export { closest };
