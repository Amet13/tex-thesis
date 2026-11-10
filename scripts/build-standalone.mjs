#!/usr/bin/env node
// Builds the standalone `overfull` CLI that GitHub Releases ship (no npm needed):
//
//   node scripts/build-standalone.mjs            → dist-standalone/overfull.cjs (runs with Node ≥ 26)
//   node scripts/build-standalone.mjs --sea      → also dist-standalone/overfull[.exe], a single
//                                                   executable for the current OS/arch (Node SEA,
//                                                   embeds the Node.js that runs this script)
//
// Needs Node.js 26 or newer.
//
// The bundle embeds the templates, so `overfull init` works offline from the single file.
import { execFileSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'dist-standalone');
const sea = process.argv.includes('--sea');
const { version } = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8'));

/** Every template file as { "<template>/<path>": base64 }, symlinks as { link: target }. */
function embedTemplates() {
  const files = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = relative(join(root, 'templates'), full).split(sep).join('/');
      const st = lstatSync(full);
      if (st.isSymbolicLink()) files[rel] = { link: readlinkSync(full) };
      else if (st.isDirectory()) walk(full);
      else files[rel] = readFileSync(full).toString('base64');
    }
  };
  walk(join(root, 'templates'));
  return files;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const bundle = join(out, 'overfull.cjs');

await build({
  entryPoints: [join(root, 'packages/cli/src/bin.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  // CommonJS: Node single executable applications load a CommonJS entry.
  format: 'cjs',
  target: 'node26',
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
  alias: {
    overfull: join(root, 'packages/cli/src/index.ts'),
    '@overfull/core': join(root, 'packages/core/src/index.ts'),
  },
  define: {
    __OVERFULL_VERSION__: JSON.stringify(version),
    __OVERFULL_TEMPLATES__: JSON.stringify(embedTemplates()),
    'import.meta.url': '__overfullImportMetaUrl',
  },
  // pdf.js loads @napi-rs/canvas only for rendering, which Overfull does not use.
  external: ['@napi-rs/canvas'],
  banner: {
    js: [
      "const __overfullImportMetaUrl = require('node:url').pathToFileURL(__filename).href;",
      '{ const warn = console.warn; console.warn = (...a) => { if (typeof a[0] === "string" && /^Warning: Cannot (load \\"@napi-rs|polyfill)/.test(a[0])) return; warn(...a); }; }',
    ].join('\n'),
  },
});
console.log(`${relative(root, bundle)} (${version})`);

if (sea) {
  const exe = join(out, process.platform === 'win32' ? 'overfull.exe' : 'overfull');
  const config = join(out, 'sea-config.json');
  const seaOptions = { main: bundle, disableExperimentalSEAWarning: true };
  // Node 26 builds the executable in one step, with no external injector.
  writeFileSync(config, JSON.stringify({ ...seaOptions, output: exe }));
  execFileSync(process.execPath, ['--build-sea', config], { stdio: 'inherit' });
  // macOS refuses to run a modified binary without a (here ad-hoc) signature.
  if (process.platform === 'darwin') {
    execFileSync('codesign', ['--sign', '-', exe], { stdio: 'inherit' });
  }
  rmSync(config);
  console.log(relative(root, exe));
}
