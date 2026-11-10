#!/usr/bin/env node
// Updates the pins Dependabot cannot: Node.js and veraPDF in docker/Dockerfile (version and
// SHA-256), and pnpm in package.json (packageManager) together with docker/pnpm.
//
//   node scripts/update-pins.mjs            write the changes, print what changed
//   node scripts/update-pins.mjs --check    print what would change, exit 1 if anything would
//
// Node.js stays on the major version already pinned (26) and takes its newest release;
// the hashes come from nodejs.org's SHASUMS256.txt. veraPDF takes the newest greenfield
// installer on software.verapdf.org; its hash is computed from the download, the same file
// the image build checks. pnpm takes the newest release of the pinned major from the npm
// registry. Nothing is changed when a source cannot be read.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const changes = [];

async function get(url, as = 'text') {
  const res = await fetch(url, { headers: { 'user-agent': 'overfull-update-pins' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return as === 'json'
    ? res.json()
    : as === 'bytes'
      ? new Uint8Array(await res.arrayBuffer())
      : res.text();
}

const cmpVersions = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

function setArg(text, name, value) {
  const re = new RegExp(`^(ARG ${name}=)(\\S+)$`, 'm');
  const m = re.exec(text);
  if (!m) throw new Error(`docker/Dockerfile: no ARG ${name}`);
  return m[2] === value ? text : text.replace(re, `$1${value}`);
}

const argOf = (text, name) => new RegExp(`^ARG ${name}=(\\S+)$`, 'm').exec(text)?.[1];

async function node(docker) {
  const current = argOf(docker, 'NODE_VERSION');
  const major = current.split('.')[0];
  const index = await get('https://nodejs.org/dist/index.json', 'json');
  const latest = index
    .map((r) => r.version.replace(/^v/, ''))
    .filter((v) => v.split('.')[0] === major)
    .sort(cmpVersions)
    .at(-1);
  if (!latest || cmpVersions(latest, current) <= 0) return docker;
  const sums = await get(`https://nodejs.org/dist/v${latest}/SHASUMS256.txt`);
  const sumOf = (file) => {
    const line = sums.split('\n').find((l) => l.trim().endsWith(`  ${file}`));
    if (!line) throw new Error(`SHASUMS256.txt for v${latest} has no ${file}`);
    return line.split(/\s+/)[0];
  };
  let out = setArg(docker, 'NODE_VERSION', latest);
  out = setArg(out, 'NODE_SHA256_AMD64', sumOf(`node-v${latest}-linux-x64.tar.xz`));
  out = setArg(out, 'NODE_SHA256_ARM64', sumOf(`node-v${latest}-linux-arm64.tar.xz`));
  changes.push(`Node.js ${current} → ${latest}`);
  return out;
}

async function verapdf(docker) {
  const current = argOf(docker, 'VERAPDF_VERSION');
  const base = 'https://software.verapdf.org/releases/';
  const lines = [...(await get(base)).matchAll(/href="(\d+\.\d+)\/"/g)].map((m) => m[1]);
  const line = lines.sort(cmpVersions).at(-1);
  if (!line) return docker;
  const files = await get(`${base}${line}/`);
  const latest = [...files.matchAll(/verapdf-greenfield-(\d+\.\d+\.\d+)-installer\.zip"/g)]
    .map((m) => m[1])
    .sort(cmpVersions)
    .at(-1);
  if (!latest || cmpVersions(latest, current) <= 0) return docker;
  const zip = await get(`${base}${line}/verapdf-greenfield-${latest}-installer.zip`, 'bytes');
  const sha = createHash('sha256').update(zip).digest('hex');
  changes.push(`veraPDF ${current} → ${latest}`);
  return setArg(setArg(docker, 'VERAPDF_VERSION', latest), 'VERAPDF_SHA256', sha);
}

async function pnpm() {
  const pkgPath = join(root, 'package.json');
  const pkg = readFileSync(pkgPath, 'utf8');
  const current = /"packageManager":\s*"pnpm@([^"]+)"/.exec(pkg)?.[1];
  if (!current) return;
  const major = current.split('.')[0];
  const meta = await get('https://registry.npmjs.org/pnpm', 'json');
  const latest = Object.keys(meta.versions ?? {})
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v) && v.split('.')[0] === major)
    .sort(cmpVersions)
    .at(-1);
  if (!latest || cmpVersions(latest, current) <= 0) return;
  changes.push(`pnpm ${current} → ${latest}`);
  if (check) return;
  writeFileSync(pkgPath, pkg.replace(`"pnpm@${current}"`, `"pnpm@${latest}"`));
  const dockerPkgPath = join(root, 'docker', 'pnpm', 'package.json');
  const dockerPkg = JSON.parse(readFileSync(dockerPkgPath, 'utf8'));
  dockerPkg.dependencies.pnpm = latest;
  writeFileSync(dockerPkgPath, `${JSON.stringify(dockerPkg, null, 2)}\n`);
  execFileSync('npm', ['install', '--package-lock-only', '--no-audit', '--no-fund'], {
    cwd: join(root, 'docker', 'pnpm'),
    stdio: 'inherit',
  });
}

const dockerPath = join(root, 'docker', 'Dockerfile');
const before = readFileSync(dockerPath, 'utf8');
let after = before;
for (const step of [node, verapdf]) {
  try {
    after = await step(after);
  } catch (err) {
    console.error(`warning: ${step.name}: ${err.message}; left as it is`);
  }
}
try {
  await pnpm();
} catch (err) {
  console.error(`warning: pnpm: ${err.message}; left as it is`);
}
if (!check && after !== before) writeFileSync(dockerPath, after);
console.log(changes.length ? changes.join('\n') : 'All pins are current.');
if (check && changes.length) process.exitCode = 1;
