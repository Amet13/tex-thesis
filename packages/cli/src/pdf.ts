import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { extractPdfFacts, type PdfFacts, type PdfjsLike, parsePdffonts } from '@overfull/core';
import { dockerRunArgs, run, which } from './tools.js';

let pdfjsPromise: Promise<PdfjsLike> | undefined;

/**
 * Loads the pdf.js legacy build for Node with an in-thread worker: the worker
 * module is imported and registered as `globalThis.pdfjsWorker`, which also
 * makes the esbuild bundle (the Action) self-contained.
 */
export function loadPdfjs(): Promise<PdfjsLike> {
  pdfjsPromise ??= (async () => {
    // pdf.js warns (console.warn) at import time when the optional
    // @napi-rs/canvas is missing; rendering needs it, text extraction does not.
    const warn = console.warn;
    console.warn = (...args: unknown[]) => {
      if (
        typeof args[0] === 'string' &&
        /^Warning: Cannot (load "@napi-rs|polyfill|access the `require`)/.test(args[0])
      )
        return;
      warn(...args);
    };
    try {
      const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
      (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
      return (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsLike;
    } finally {
      console.warn = warn;
    }
  })();
  return pdfjsPromise;
}

/**
 * Facts for a PDF file, with fonts from `pdffonts` when poppler is installed
 * (or, with `docker`, from pdffonts in the Overfull image).
 */
export async function readPdfFacts(
  path: string,
  opts: { docker?: { image: string; root: string } } = {},
): Promise<PdfFacts> {
  const data = new Uint8Array(readFileSync(path));
  const facts = await extractPdfFacts(data, await loadPdfjs());
  if (which('pdffonts')) {
    const r = await run('pdffonts', [path], { timeoutMs: 30000 });
    if (r.code === 0) facts.fonts = parsePdffonts(r.stdout);
  } else if (opts.docker) {
    const rel = `./${relative(opts.docker.root, path).split('\\').join('/')}`;
    const r = await run(
      'docker',
      dockerRunArgs(opts.docker.image, opts.docker.root, ['pdffonts', rel]),
      {
        timeoutMs: 60000,
      },
    );
    if (r.code === 0) facts.fonts = parsePdffonts(r.stdout);
  }
  return facts;
}
