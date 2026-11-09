#!/usr/bin/env node
// Sets the Overfull version everywhere it is written down:
//
//   node scripts/bump-version.mjs 3.1.0 --dry-run   show what would change
//   node scripts/bump-version.mjs 3.1.0             change the files
//
// Updates the package.json of the CLI, core and Action, core's VERSION constant
// and CITATION.cff (version, date-released). On a new major version it also moves
// every `ghcr.io/amet13/overfull:<major>` image tag and `amet13/overfull@v<major>`
// Action reference in tracked files (templates, docs, site, CLI defaults).
// CHANGELOG.md is left to you, and so is rebuilding action/dist.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const next = args.find((a) => !a.startsWith('--'));
if (!next || !/^\d+\.\d+\.\d+$/.test(next)) {
  console.error('usage: node scripts/bump-version.mjs <x.y.z> [--dry-run]');
  process.exit(2);
}

const read = (rel) => readFileSync(join(root, rel), 'utf8');
const current = JSON.parse(read('packages/cli/package.json')).version;
const [oldMajor] = current.split('.');
const [newMajor] = next.split('.');

/** @type {Map<string, string>} rel path → new content */
const changes = new Map();
function edit(rel, fn) {
  const before = changes.get(rel) ?? read(rel);
  const after = fn(before);
  if (after !== before) changes.set(rel, after);
}
function mustEdit(rel, re, replacement) {
  edit(rel, (text) => {
    if (!re.test(text)) throw new Error(`${rel}: no match for ${re}`);
    return text.replace(re, replacement);
  });
}

for (const rel of ['packages/cli/package.json', 'packages/core/package.json', 'action/package.json']) {
  mustEdit(rel, /("version":\s*")[^"]+(")/, `$1${next}$2`);
}
mustEdit('packages/core/src/index.ts', /(export const VERSION = ')[^']+(')/, `$1${next}$2`);
mustEdit('CITATION.cff', /^(version:\s*")[^"]+(")/m, `$1${next}$2`);
mustEdit(
  'CITATION.cff',
  /^(date-released:\s*")[^"]+(")/m,
  `$1${new Date().toISOString().slice(0, 10)}$2`,
);

if (newMajor !== oldMajor) {
  const image = new RegExp(`(ghcr\\.io/amet13/overfull:)${oldMajor}(?![\\d.])`, 'g');
  const action = new RegExp(`(amet13/overfull@v)${oldMajor}(?![\\d.])`, 'g');
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((f) => f && !f.startsWith('corpus/') && f !== 'CHANGELOG.md' && !f.endsWith('.pdf'));
  for (const rel of tracked) {
    let text;
    try {
      text = changes.get(rel) ?? read(rel);
    } catch {
      continue; // deleted in the working tree
    }
    if (text.includes('\0')) continue; // binary
    edit(rel, (t) => t.replace(image, `$1${newMajor}`).replace(action, `$1${newMajor}`));
  }
}

console.log(`${current} → ${next}${dryRun ? ' (dry run)' : ''}`);
for (const [rel, text] of changes) {
  const before = read(rel).split('\n');
  const after = text.split('\n');
  console.log(`\n${rel}`);
  after.forEach((line, i) => {
    if (line !== before[i]) console.log(`  - ${before[i]?.trim()}\n  + ${line.trim()}`);
  });
  if (!dryRun) writeFileSync(join(root, rel), text);
}
if (changes.size === 0) console.log('Nothing to change.');
else if (!dryRun) {
  console.log(`
Next:
  1. Add a "## [v${next}]" section to CHANGELOG.md.
  2. pnpm build && pnpm --filter overfull-action build   (action/dist embeds the version)
  3. pnpm lint && pnpm typecheck && pnpm test && pnpm templates:check
  4. Commit, then: git tag v${next} && git push origin v${next}${
    newMajor !== oldMajor ? `\n  5. After the release: git tag -f v${newMajor} v${next} && git push -f origin v${newMajor}` : ''
  }`);
}
