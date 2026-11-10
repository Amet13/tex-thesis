#!/usr/bin/env node
// Looks for venue profiles that need a person: official pages that no longer answer,
// a next edition whose pages are already published, and profiles not checked for a year.
// Prints a Markdown report (empty when nothing needs attention). It changes nothing:
// venue rules must be read from the official pages by a person (CONTRIBUTING.md).
//
//   node scripts/venues-watch.mjs [--now 2026-11-10]
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { now: { type: 'string' } } });
const now = values.now ? new Date(values.now) : new Date();
const MONTH = 30.44 * 24 * 3600 * 1000;

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
    return { ok: res.ok, code: res.status, final: res.url, text };
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

const findings = [];
for (const file of readdirSync(join(root, 'venues'))
  .filter((f) => f.endsWith('.yml'))
  .sort()) {
  const v = parse(readFileSync(join(root, 'venues', file), 'utf8'));
  const id = v.id ?? file;
  const age = (now - new Date(v.checkedOn)) / MONTH;
  if (age >= 12)
    findings.push(`- \`${id}\`: last checked ${v.checkedOn} (${Math.floor(age)} months ago).`);
  for (const url of v.source ?? []) {
    const s = await status(url);
    // Bot walls (403, 429) say nothing about the page; only a missing page counts.
    if (s.code === 404 || s.code === 410)
      findings.push(`- \`${id}\`: source ${url} answers HTTP ${s.code}.`);
  }
  if (typeof v.year === 'number') {
    const candidates = (v.source ?? [])
      .map((u) => nextEditionUrl(u, v.year))
      .filter((u) => u && !/\.(zip|pdf)$/i.test(u));
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

if (findings.length) {
  console.log(
    [
      'These venue profiles need a look. Read the official pages and update the files by',
      'hand (see "Adding a venue" in CONTRIBUTING.md); never copy rules from anywhere else.',
      '',
      ...findings,
    ].join('\n'),
  );
}
