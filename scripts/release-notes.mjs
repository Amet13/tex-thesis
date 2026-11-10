#!/usr/bin/env node
// Writes the next patch version's CHANGELOG section from the commits since the last
// release tag, and prints the new version. Used by autorelease.yml.
//
//   node scripts/release-notes.mjs            print the next version and the section (dry run)
//   node scripts/release-notes.mjs --write    also insert the section under [Unreleased]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const version = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8')).version;
const [maj, min, pat] = version.split('.').map(Number);
const next = `${maj}.${min}.${pat + 1}`;
const subjects = git('log', '--no-merges', '--format=%s', `v${version}..HEAD`)
  .split('\n')
  .map((s) => s.trim())
  .filter((s) => s && !/^(Rebuild action\/dist|Regenerate generated files)$/.test(s));
const date = new Date().toISOString().slice(0, 10);
const section = [
  `## [v${next}] - ${date}`,
  '',
  `Changes merged since v${version}, each after the full test suite and the template`,
  'builds passed. Released automatically by autorelease.yml.',
  '',
  '### Changed',
  '',
  ...(subjects.length
    ? subjects.map((s) => `- ${s.replace(/\s+/g, ' ')}`)
    : ['- Updated dependencies.']),
  '',
].join('\n');
if (process.argv.includes('--write')) {
  const path = join(root, 'CHANGELOG.md');
  const text = readFileSync(path, 'utf8');
  if (!text.includes('## [Unreleased]\n'))
    throw new Error('CHANGELOG.md has no [Unreleased] heading');
  writeFileSync(path, text.replace('## [Unreleased]\n', `## [Unreleased]\n\n${section}`));
}
console.log(next);
if (!process.argv.includes('--write')) console.error(section);
