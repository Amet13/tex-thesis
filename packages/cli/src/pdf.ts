import { readFileSync } from 'node:fs';
import { extractPdfFacts, type PdfFacts, type PdfjsLike, parsePdffonts } from '@overfull/core';
import { run, which } from './tools.js';

let pdfjsPromise: Promise<PdfjsLike> | undefined;

/**
 * Loads the pdf.js legacy build for Node with an in-thread worker: the worker
 * module is imported and registered as `globalThis.pdfjsWorker`, which also
 * makes the esbuild bundle (the Action) self-contained.
 */
export function loadPdfjs(): Promise<PdfjsLike> {
  pdfjsPromise ??= (async () => {
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsLike;
  })();
  return pdfjsPromise;
}

/** Facts for a PDF file, with fonts from `pdffonts` when poppler is installed. */
export async function readPdfFacts(path: string): Promise<PdfFacts> {
  const data = new Uint8Array(readFileSync(path));
  const facts = await extractPdfFacts(data, await loadPdfjs());
  if (which('pdffonts')) {
    const r = await run('pdffonts', [path], { timeoutMs: 30000 });
    if (r.code === 0) facts.fonts = parsePdffonts(r.stdout);
  }
  return facts;
}
