#!/usr/bin/env node
// Fails when a tracked path cannot be checked out on Windows or macOS:
// reserved device names (aux, con, nul, …), forbidden characters, trailing
// dots or spaces, and names that differ only by case.
import { execFileSync } from 'node:child_process';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const problems = [];
const seen = new Map();
for (const file of files) {
  for (const part of file.split('/')) {
    if (RESERVED.test(part)) problems.push(`${file}: "${part}" is a reserved name on Windows`);
    if (/[<>:"|?*\\]/.test(part))
      problems.push(`${file}: "${part}" has a character Windows forbids`);
    if (/[. ]$/.test(part)) problems.push(`${file}: "${part}" ends with a dot or space`);
  }
  const lower = file.toLowerCase();
  if (seen.has(lower)) problems.push(`${file}: differs only by case from ${seen.get(lower)}`);
  seen.set(lower, file);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`${files.length} paths are portable.`);
