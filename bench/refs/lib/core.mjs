// Loads the TypeScript sources of @overfull/core directly (Node strips the types),
// so the benchmark needs no build step. Same approach as
// packages/core/test/fixtures/refs/record.mjs: map ./x.js to ./x.ts.
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.endsWith('.js')) return next(specifier.replace(/\.js$/, '.ts'), context);
      throw err;
    }
  },
});

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, '..', '..', '..');
const src = join(repoRoot, 'packages', 'core', 'src');

const bib = await import(pathToFileURL(join(src, 'bib', 'index.ts')).href);
const refs = await import(pathToFileURL(join(src, 'refs', 'index.ts')).href);

export const { parseBib, formatBibEntry } = bib;
export const { verifyEntries, lookup } = refs;
