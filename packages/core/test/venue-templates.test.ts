import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { resolveProfile, type TexFile, venueCheck } from '../src/venue/index.js';

const templates = new URL('../../../templates/', import.meta.url).pathname;
const NEW_RULES = [
  'style-file-modified',
  'layout-tampering',
  'anonymity-link',
  'venue-profile-stale',
];

function sources(dir: string, base = dir): TexFile[] {
  const out: TexFile[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith('.')) out.push(...sources(p, base));
    } else if (/\.(tex|sty|cls)$/i.test(e.name)) {
      out.push({ path: relative(base, p).split('\\').join('/'), content: readFileSync(p, 'utf8') });
    }
  }
  return out;
}

describe('venue rules on the shipped templates', () => {
  for (const name of ['thesis', 'paper', 'slides']) {
    it(`${name}: none of the new rules fire with its own overfull.yml`, () => {
      const dir = join(templates, name);
      const cfg = parse(readFileSync(join(dir, 'overfull.yml'), 'utf8'));
      const profile = resolveProfile({ extends: cfg.profile ?? 'generic', ...(cfg.venue ?? {}) });
      const files = sources(dir);
      expect(files.length).toBeGreaterThan(0);
      for (const anonymous of [undefined, true]) {
        const p = anonymous ? { ...profile, anonymous } : profile;
        const r = venueCheck(p, { texFiles: files, main: cfg.main ?? 'main.tex' });
        expect(r.problems.filter((x) => NEW_RULES.includes(x.rule))).toEqual([]);
      }
    });
  }
});
