#!/usr/bin/env node
// Sync agent files into every template (no dependencies).
//
//   skills/<name>/            -> templates/<t>/.agents/skills/<name>/
//   shared/agents/**          -> templates/<t>/** (AGENTS.md plus the small pointer files
//                                each harness reads: CLAUDE.md, GEMINI.md,
//                                .github/copilot-instructions.md, .cursor/rules/overfull.mdc)
//   templates/<t>/.claude/skills -> ../.agents/skills   (relative symlink)
//
// Usage:
//   node scripts/sync-templates.mjs           write changes
//   node scripts/sync-templates.mjs --check   exit 1 and list drift (CI)

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const templatesDir = join(root, 'templates');
const skillsDir = join(root, 'skills');
const agentsDir = join(root, 'shared', 'agents');
const LINK_TARGET = '../.agents/skills';

const drift = [];
const warn = (msg) => console.warn(`warning: ${msg}`);
const rel = (p) => relative(root, p);

const isDir = (p) => existsSync(p) && lstatSync(p).isDirectory();

/** All files under dir, as paths relative to dir (sorted, symlinks skipped). */
function listFiles(dir, base = dir) {
  if (!isDir(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(p, base));
    else if (entry.isFile()) out.push(relative(base, p));
  }
  return out.sort();
}

function syncFile(src, dest) {
  const want = readFileSync(src);
  const have = existsSync(dest) ? readFileSync(dest) : null;
  if (have?.equals(want)) return;
  drift.push(`${have ? 'changed' : 'missing'}: ${rel(dest)}`);
  if (!check) {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, want);
  }
}

function removeExtra(path) {
  drift.push(`extra: ${rel(path)}`);
  if (!check) rmSync(path, { recursive: true, force: true });
}

/** Make dest an exact copy of src (adds, updates and removes files). */
function syncDir(src, dest) {
  const want = new Set(listFiles(src));
  for (const f of want) syncFile(join(src, f), join(dest, f));
  for (const f of listFiles(dest)) if (!want.has(f)) removeExtra(join(dest, f));
}

function syncLink(link, target) {
  let current = null;
  try {
    const st = lstatSync(link);
    current = st.isSymbolicLink() ? readlinkSync(link) : '<not a symlink>';
  } catch {
    // missing
  }
  if (current === target) return;
  drift.push(`${current === null ? 'missing' : 'wrong'} symlink: ${rel(link)} -> ${target}`);
  if (!check) {
    rmSync(link, { recursive: true, force: true });
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link, 'dir');
  }
}

const templates = isDir(templatesDir)
  ? readdirSync(templatesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
  : [];
if (templates.length === 0) {
  console.error('error: no templates found in templates/');
  process.exit(2);
}

const skills = isDir(skillsDir)
  ? readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(skillsDir, e.name, 'SKILL.md')))
      .map((e) => e.name)
      .sort()
  : [];
if (skills.length === 0) warn('no skills found in skills/*/SKILL.md; skipping skills');

const agentFiles = listFiles(agentsDir);
if (!agentFiles.includes('AGENTS.md')) warn('shared/agents/AGENTS.md not found');

for (const t of templates) {
  const tdir = join(templatesDir, t);
  for (const f of agentFiles) syncFile(join(agentsDir, f), join(tdir, f));

  if (skills.length > 0) {
    const destSkills = join(tdir, '.agents', 'skills');
    for (const s of skills) syncDir(join(skillsDir, s), join(destSkills, s));
    // Skills deleted from skills/ are removed from the template too.
    if (isDir(destSkills)) {
      for (const e of readdirSync(destSkills, { withFileTypes: true })) {
        if (!skills.includes(e.name)) removeExtra(join(destSkills, e.name));
      }
    }
    syncLink(join(tdir, '.claude', 'skills'), LINK_TARGET);
  }
}

if (check) {
  if (drift.length > 0) {
    console.error(`Templates are out of sync (${drift.length}):`);
    for (const d of drift) console.error(`  ${d}`);
    console.error('Run: node scripts/sync-templates.mjs');
    process.exit(1);
  }
  console.log(`Templates in sync (${templates.join(', ')}).`);
} else {
  console.log(
    drift.length > 0
      ? `Synced ${drift.length} change(s) into ${templates.join(', ')}.`
      : 'Templates already in sync.',
  );
}
