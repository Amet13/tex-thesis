#!/usr/bin/env node
// Looks for venue profiles that need a person: official pages that no longer answer,
// pages whose text changed since a person last read them (with the changed lines), a
// next edition whose pages are already published, and profiles not checked for a year.
// Also watches arXiv's help pages on its TeX Live version and build process, which
// venue/arxiv.ts follows. Prints a Markdown report (empty when nothing needs attention).
// It changes no profile: venue rules must be read from the official pages by a person
// (CONTRIBUTING.md). Style-file hashes are checked by scripts/venues-kits.mjs.
//
//   node scripts/venues-watch.mjs [--now 2026-11-10]
//   node scripts/venues-watch.mjs --accept <id|arxiv|all>   store the pages' current text
//
// Run --accept in the pull request that updates a profile, so the next report compares
// against what the person read.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FINGERPRINTS = join(root, 'venues', '.fingerprints.json');
const MONTH = 30.44 * 24 * 3600 * 1000;

/** arXiv's own pages on how it builds submissions (followed by venue/arxiv.ts). */
export const ARXIV_PAGES = [
  'https://info.arxiv.org/help/faq/texlive.html',
  'https://info.arxiv.org/help/submit_tex.html',
  'https://info.arxiv.org/help/00README.html',
];

async function status(url, withText = false) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'user-agent': 'overfull-venues-watch (+https://github.com/amet13/overfull)' },
      signal: AbortSignal.timeout(20_000),
    });
    const text = withText ? (await res.text()).slice(0, 2_000_000) : '';
    if (!withText) await res.body?.cancel();
    return {
      ok: res.ok,
      code: res.status,
      final: res.url,
      text,
      type: res.headers.get('content-type') ?? '',
    };
  } catch (err) {
    return { ok: false, code: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The same URL for the next edition: every 4-digit year, and the 2-digit form after a dash or "kit". */
export function nextEditionUrl(url, year) {
  const yy = String(year).slice(2);
  const next = String(year + 1);
  const nyy = next.slice(2);
  const out = url
    .replaceAll(String(year), next)
    .replace(new RegExp(`(-|kit)${yy}(?=\\b|/|$)`, 'g'), `$1${nyy}`);
  return out === url ? undefined : out;
}

/** A line that is only a date or time stamp: digits, separators, am/pm or a time-zone code. */
const DATE_LINE = /^[\d\s.,:/–-]*(?:[aApP][mM]|[A-Z]{2,4})?[\d\s.,:/–-]*$/;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * The readable text of an HTML page, one block per line: scripts, styles, navigation,
 * headers, footers and forms removed; lines that are only a date or a time removed, so
 * a "last updated" stamp is not a change.
 */
export function pageText(html) {
  let s = html;
  for (const tag of ['script', 'style', 'noscript', 'nav', 'header', 'footer', 'form', 'svg']) {
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, 'gi'), ' ');
  }
  s = s
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(
      /<(?:br|\/p|\/li|\/h[1-6]|\/tr|\/div|\/section|\/dt|\/dd|\/blockquote)\b[^>]*>/gi,
      '\n',
    )
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code =
          e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
  return s
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l && !(/\d/.test(l) && DATE_LINE.test(l)))
    .join('\n');
}

export const textHash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** Lines removed from and added to a page's text, in page order, at most `max` of each. */
export function lineDiff(before, after, max = 12) {
  const a = before.split('\n');
  const b = after.split('\n');
  const inA = new Set(a);
  const inB = new Set(b);
  const removed = a.filter((l) => !inB.has(l));
  const added = b.filter((l) => !inA.has(l));
  const cut = (list) => [
    ...list.slice(0, max),
    ...(list.length > max ? [`… and ${list.length - max} more`] : []),
  ];
  return { removed: cut(removed), added: cut(added) };
}

/** A finding for a changed page: the URL and the changed lines as a diff block. */
export function changedPageFinding(label, url, before, after) {
  const { removed, added } = lineDiff(before, after);
  const clip = (l) => (l.length > 200 ? `${l.slice(0, 200)}…` : l).replaceAll('```', "'''");
  return [
    `- ${label}: ${url} changed since it was last read.`,
    '',
    '  ```diff',
    ...removed.map((l) => `  - ${clip(l)}`),
    ...added.map((l) => `  + ${clip(l)}`),
    '  ```',
  ].join('\n');
}

function readFingerprints() {
  try {
    return JSON.parse(readFileSync(FINGERPRINTS, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function profiles() {
  return readdirSync(join(root, 'venues'))
    .filter((f) => f.endsWith('.yml'))
    .sort()
    .map((file) => ({ file, v: parse(readFileSync(join(root, 'venues', file), 'utf8')) }));
}

const isPage = (url) => !/\.(zip|pdf|sty|cls|dtx)$/i.test(url) && !/ZIP$|PDF$/.test(url);

/**
 * Pages whose text is compared. CTAN package pages are left out: they list related
 * packages in a random order and print the current time, and the files they describe
 * are covered by the style-file hashes (scripts/venues-kits.mjs).
 */
const isWatchedText = (url) => isPage(url) && new URL(url).hostname !== 'ctan.org';

async function accept(which) {
  const prints = readFingerprints();
  const targets = [];
  for (const { v } of profiles()) {
    if (which === 'all' || which === v.id) targets.push(...(v.source ?? []).filter(isWatchedText));
  }
  if (which === 'all' || which === 'arxiv') targets.push(...ARXIV_PAGES);
  if (!targets.length) throw new Error(`no profile "${which}" (use a venue id, arxiv or all)`);
  for (const url of targets) {
    const s = await status(url, true);
    if (!s.ok || !/html/i.test(s.type)) {
      console.error(`skipped ${url}: ${s.error ?? `HTTP ${s.code} ${s.type}`}`);
      continue;
    }
    const text = pageText(s.text);
    prints[url] = { hash: textHash(text), text };
    console.error(`stored ${url}`);
  }
  const sorted = Object.fromEntries(Object.entries(prints).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(FINGERPRINTS, `${JSON.stringify(sorted, null, 2)}\n`);
}

async function watch(now) {
  const prints = readFingerprints();
  const findings = [];
  const comparePage = async (label, url) => {
    const stored = prints[url];
    const s = await status(url, true);
    // Bot walls (403, 429) say nothing about the page; only a missing page counts.
    if (s.code === 404 || s.code === 410) {
      findings.push(`- ${label}: ${url} answers HTTP ${s.code}.`);
      return;
    }
    if (!stored || !s.ok || !/html/i.test(s.type ?? '')) return;
    const text = pageText(s.text);
    if (textHash(text) !== stored.hash)
      findings.push(changedPageFinding(label, url, stored.text, text));
  };
  for (const { file, v } of profiles()) {
    const id = v.id ?? file;
    const age = (now - new Date(v.checkedOn)) / MONTH;
    if (age >= 12)
      findings.push(`- \`${id}\`: last checked ${v.checkedOn} (${Math.floor(age)} months ago).`);
    for (const url of v.source ?? []) {
      if (isWatchedText(url)) await comparePage(`\`${id}\``, url);
      else {
        const s = await status(url);
        if (s.code === 404 || s.code === 410)
          findings.push(`- \`${id}\`: source ${url} answers HTTP ${s.code}.`);
      }
    }
    if (typeof v.year === 'number') {
      const candidates = (v.source ?? [])
        .map((u) => nextEditionUrl(u, v.year))
        .filter((u) => u && isPage(u));
      for (const url of candidates) {
        const s = await status(url, true);
        // Count it only when the next edition's own address answers (no redirect elsewhere)
        // with real content: a placeholder page (only the site's menus) mentions submissions
        // rarely, a call for papers many times.
        const mentions = ((s.text ?? '').match(/submission/gi) ?? []).length;
        if (
          s.ok &&
          s.final &&
          nextEditionUrl(s.final, v.year) === undefined &&
          s.final.includes(String(v.year + 1)) &&
          mentions >= 3
        ) {
          findings.push(
            `- \`${id}\`: the ${v.year + 1} edition has a page: ${url}. Read it and add \`venues/${id.replace(String(v.year), String(v.year + 1))}.yml\`.`,
          );
          break;
        }
      }
    }
  }
  for (const url of ARXIV_PAGES) await comparePage('arXiv (venue/arxiv.ts)', url);
  return findings;
}

async function main() {
  const { values } = parseArgs({
    options: { now: { type: 'string' }, accept: { type: 'string' } },
  });
  if (values.accept) {
    await accept(values.accept);
    return;
  }
  const findings = await watch(values.now ? new Date(values.now) : new Date());
  if (findings.length) {
    console.log(
      [
        'These venue profiles need a look. Read the official pages and update the files by',
        'hand (see "Adding a venue" in CONTRIBUTING.md); never copy rules from anywhere else.',
        'After updating a profile, run `node scripts/venues-watch.mjs --accept <id>` in the',
        'same pull request so the next report compares against what you read.',
        '',
        ...findings,
      ].join('\n'),
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
