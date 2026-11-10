// Builds task input files from the recorded fixtures of the repository, never from memory.
//
// A fixture bibliography (packages/core/test/fixtures/refs/real.bib) holds entries that were
// recorded from the indexes. Generators turn chosen entries into the files a task needs, and
// alter a DOI mechanically where a task needs a wrong one: the last digit is replaced by the
// next digit (0 to 1, ..., 9 to 0).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FIXTURE_BIB = 'packages/core/test/fixtures/refs/real.bib';

/** Minimal BibTeX reader for the fixture files: `{…}` values with nested braces, one entry per `@type{key,`. */
export function parseSimpleBib(text) {
  const entries = {};
  const head = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g;
  for (let m = head.exec(text); m; m = head.exec(text)) {
    let depth = 1;
    let i = head.lastIndex;
    const start = i;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
    }
    const body = text.slice(start, i - 1);
    const fields = {};
    const f = /(\w[\w-]*)\s*=\s*\{/g;
    for (let fm = f.exec(body); fm; fm = f.exec(body)) {
      let d = 1;
      let j = f.lastIndex;
      const s = j;
      for (; j < body.length && d > 0; j++) {
        if (body[j] === '{') d++;
        else if (body[j] === '}') d--;
      }
      fields[fm[1].toLowerCase()] = body
        .slice(s, j - 1)
        .replace(/\s+/g, ' ')
        .trim();
      f.lastIndex = j;
    }
    entries[m[2]] = { type: m[1].toLowerCase(), key: m[2], fields };
    head.lastIndex = i;
  }
  return entries;
}

let cache;
export function fixtureEntries(root) {
  cache ??= parseSimpleBib(readFileSync(join(root, FIXTURE_BIB), 'utf8'));
  return cache;
}

export function entryOf(root, key) {
  const e = fixtureEntries(root)[key];
  if (!e) throw new Error(`no entry "${key}" in ${FIXTURE_BIB}`);
  return e;
}

/** The DOI of a fixture entry, or a throw: tasks that need a DOI must pick an entry that has one. */
export function doiOf(root, key) {
  const d = entryOf(root, key).fields.doi;
  if (!d) throw new Error(`entry "${key}" has no DOI`);
  return d;
}

/** Last digit replaced by the next digit. Throws when the DOI does not end in a digit. */
export function alterDoi(doi) {
  const m = /^(.*)(\d)$/.exec(doi);
  if (!m) throw new Error(`cannot alter DOI "${doi}" (does not end in a digit)`);
  return `${m[1]}${(Number(m[2]) + 1) % 10}`;
}

// TeX in fixture values to plain text: accents lose the accent (St{\'e}fan -> Stefan), braces and macros go.
const plain = (s) =>
  s
    .replace(/\\['"`^~=.]\s*\{?([a-zA-Z])\}?/g, '$1')
    .replace(/\\&/g, '&')
    .replace(/\\[a-zA-Z]+\s*/g, '')
    .replace(/[{}]/g, '')
    .replace(/--/g, '-');
function authorsOf(e) {
  return plain(e.fields.author ?? '')
    .split(/\s+and\s+/)
    .map((a) => {
      const [family, given] = a.split(',').map((s) => s.trim());
      return given ? `${given} ${family}` : family;
    })
    .map((a) => (a === 'others' ? 'et al' : a))
    .join(', ');
}
const venueOf = (e) => plain(e.fields.journal ?? e.fields.booktitle ?? e.fields.publisher ?? '');

/** `{{doi:key}}` is the recorded DOI, `{{wrongdoi:key}}` the altered one; both regex-escaped. */
export function expandPlaceholders(str, root) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return str.replace(/\{\{(doi|wrongdoi):([^}]+)\}\}/g, (_, kind, key) => {
    try {
      const d = doiOf(root, key);
      return esc(kind === 'doi' ? d : alterDoi(d));
    } catch (e) {
      throw new Error(`placeholder {{${kind}:${key}}}: ${e.message}`);
    }
  });
}

export const GENERATORS = {
  /**
   * notes/sources.md style reading list: {keys: [...], wrongDoi: [...]}. Every key is a fixture entry with a DOI;
   * entries listed in wrongDoi carry the altered DOI instead.
   */
  'reading-list': (root, spec) => {
    const lines = [
      '# Papers I read for the related-work section',
      '',
      'Copied from my reading list. Each line is one paper.',
      '',
    ];
    spec.keys.forEach((key, i) => {
      const e = entryOf(root, key);
      const wrong = (spec.wrongDoi ?? []).includes(key);
      const doi = wrong ? alterDoi(doiOf(root, key)) : doiOf(root, key);
      lines.push(
        `${i + 1}. ${authorsOf(e)}. "${plain(e.fields.title)}". ${venueOf(e)}, ${e.fields.year}. DOI: ${doi}`,
      );
    });
    return `${lines.join('\n')}\n`;
  },
  /** A reviewer comment asking for one work, described by title, authors, venue and year only (no DOI). */
  'reviewer-comment': (root, spec) => {
    const e = entryOf(root, spec.key);
    const names = authorsOf(e).split(', ');
    const first = names[0];
    const more = names.length > 1 ? ' et al.' : '';
    return [
      '# Reviews',
      '',
      '## Reviewer 2',
      '',
      `**Comment 3.** The related-work section does not discuss "${plain(e.fields.title)}" (${first.split(' ').pop()}${more}, ${venueOf(e)}, ${e.fields.year}). ${spec.ask}`,
      '',
      '## Reviewer 1',
      '',
      'No further comments; the remaining points were minor and are already fixed in the current draft.',
      '',
    ].join('\n');
  },
};

/** Serializes a parsed entry back to BibTeX (values stay as written in the fixture). */
function formatSimple(e) {
  const rows = Object.entries(e.fields).map(([k, v]) => `  ${k} = {${v}}`);
  return `@${e.type}{${e.key},\n${rows.join(',\n')}\n}\n`;
}

Object.assign(GENERATORS, {
  /**
   * One entry of a fixture .bib file, with a new key and without the listed fields:
   * {from, key, as, drop}. Used to start from a fixture entry in a deliberately incomplete form.
   */
  'fixture-entry': (root, spec) => {
    const entries = parseSimpleBib(readFileSync(join(root, spec.from), 'utf8'));
    const e = entries[spec.key];
    if (!e) throw new Error(`no entry "${spec.key}" in ${spec.from}`);
    const fields = Object.fromEntries(
      Object.entries(e.fields).filter(([k]) => !(spec.drop ?? []).includes(k)),
    );
    return `\n${formatSimple({ ...e, key: spec.as ?? e.key, fields })}`;
  },
});

export function generate(root, spec) {
  const g = GENERATORS[spec.generate];
  if (!g) throw new Error(`unknown generator ${spec.generate}`);
  return g(root, spec);
}
