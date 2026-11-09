// Bundles the Action into a single ESM file (pdf.js and its worker included;
// the worker runs in-thread via globalThis.pdfjsWorker, see packages/cli/src/pdf.ts).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const { version } = JSON.parse(
  readFileSync(new URL('../packages/cli/package.json', import.meta.url), 'utf8'),
);

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  legalComments: 'none',
  logLevel: 'warning',
  // Bundle from TypeScript sources so the Action does not depend on a prior `pnpm -r build`.
  alias: {
    overfull: fileURLToPath(new URL('../packages/cli/src/index.ts', import.meta.url)),
    '@overfull/core': fileURLToPath(new URL('../packages/core/src/index.ts', import.meta.url)),
  },
  define: { __OVERFULL_VERSION__: JSON.stringify(version) },
  // pdf.js optionally loads @napi-rs/canvas for rendering, which text extraction does not need.
  external: ['@napi-rs/canvas'],
  // Some bundled CommonJS code calls require(); give ESM output a real one.
  // esbuild evaluates bundled ESM eagerly, so pdf.js's import-time warnings about the
  // missing (rendering-only) canvas package are filtered here, before any module runs.
  banner: {
    js: [
      "import { createRequire as __overfullCreateRequire } from 'node:module';",
      'const require = __overfullCreateRequire(import.meta.url);',
      '{ const warn = console.warn; console.warn = (...a) => { if (typeof a[0] === "string" && /^Warning: Cannot (load \\"@napi-rs|polyfill)/.test(a[0])) return; warn(...a); }; }',
    ].join('\n'),
  },
});
console.log('action/dist/index.js');
