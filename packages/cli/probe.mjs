import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';
for (const f of process.argv.slice(2)) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(f)), isEvalSupported:false, useSystemFonts:false }).promise;
  const md = await doc.getMetadata();
  console.log(f, doc.numPages, md.info, md.metadata && [...md.metadata], await doc.getMarkInfo(), await doc.getViewerPreferences());
  const p = await doc.getPage(1);
  console.log(p.view, JSON.stringify(await p.getStructTree()).slice(0,1500));
  const tc = await p.getTextContent();
  console.log(tc.items.map(i=>i.str + (i.hasEOL?'\n':'')).join(''));
  if (md.metadata) console.log(md.metadata.getRaw().slice(0,3000));
}
