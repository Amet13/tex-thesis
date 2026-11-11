#!/usr/bin/env node
// Prepares the npm package `overfull` for one release: the self-contained single-file
// CLI (overfull.cjs from scripts/build-standalone.mjs, templates embedded, no
// dependencies) with a package.json, README and LICENSE. The release workflow publishes
// it with provenance when the repository has an NPM_TOKEN secret.
//
//   node packaging/npm.mjs --version 3.2.0 --cjs dist-standalone/overfull.cjs --out dist-npm
//
// No dependencies, so it runs on a bare runner.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The published package.json: one file, one bin, Node 26 or newer. */
export function npmManifest(version) {
  if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) throw new Error(`not a version: ${version}`);
  return {
    name: 'overfull',
    version,
    description:
      'Preflight for LaTeX papers and theses: verified references, accessible PDFs, venue rules, plain-language build errors.',
    keywords: [
      'latex',
      'bibtex',
      'references',
      'citations',
      'pdf-ua',
      'accessibility',
      'preflight',
    ],
    homepage: 'https://amet13.github.io/overfull/',
    bugs: 'https://github.com/amet13/overfull/issues',
    repository: { type: 'git', url: 'git+https://github.com/amet13/overfull.git' },
    license: 'MIT',
    bin: { overfull: 'overfull.cjs' },
    files: ['overfull.cjs'],
    engines: { node: '>=26' },
  };
}

/** A short README for npmjs.com: what it is, how to run it, where the guide is. */
export function npmReadme(version) {
  return `# overfull

The check you run before you submit, on the LaTeX paper you already have:
references looked up in the scholarly indexes, the PDF read for \`??\`, missing
fonts and accessibility, and the venue's rules (page limit, anonymity, style file).

\`\`\`sh
npm install -g overfull
cd my-paper
overfull check
\`\`\`

Needs Node.js 26 or newer. Version ${version}. Other ways to install (single-file
executables, Docker, GitHub Action) and the full guide:
https://amet13.github.io/overfull/
`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { values } = parseArgs({
    options: {
      version: { type: 'string' },
      cjs: { type: 'string', default: join(root, 'dist-standalone', 'overfull.cjs') },
      out: { type: 'string', default: join(root, 'dist-npm') },
    },
  });
  if (!values.version) {
    console.error('Usage: node packaging/npm.mjs --version X.Y.Z [--cjs file] [--out dir]');
    process.exit(2);
  }
  mkdirSync(values.out, { recursive: true });
  const cjs = readFileSync(values.cjs, 'utf8');
  writeFileSync(
    join(values.out, 'overfull.cjs'),
    cjs.startsWith('#!') ? cjs : `#!/usr/bin/env node\n${cjs}`,
  );
  writeFileSync(
    join(values.out, 'package.json'),
    `${JSON.stringify(npmManifest(values.version), null, 2)}\n`,
  );
  writeFileSync(join(values.out, 'README.md'), npmReadme(values.version));
  copyFileSync(join(root, 'LICENSE'), join(values.out, 'LICENSE'));
  console.log(`wrote the npm package for v${values.version} to ${values.out}`);
}
