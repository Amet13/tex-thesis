import type { RuleInfo } from '../types.js';

export const pdfRules: RuleInfo[] = [
  {
    id: 'pdf-unresolved-reference',
    check: 'output',
    severity: 'error',
    title: 'Unresolved reference in the PDF',
    summary: 'The PDF shows "??" where a figure, table, section or equation number belongs.',
    fix: 'Make sure every `\\ref` has a matching `\\label` (same spelling), then rebuild with latexmk.',
  },
  {
    id: 'pdf-unresolved-citation',
    check: 'output',
    severity: 'error',
    title: 'Unresolved citation in the PDF',
    summary: 'The PDF shows "[?]" where a citation number belongs.',
    fix: 'Add the cited key to the .bib file or fix its spelling, then rebuild so biber/bibtex runs.',
  },
  {
    id: 'pdf-not-tagged',
    check: 'accessibility',
    severity: 'error',
    title: 'PDF is not tagged',
    summary:
      'The PDF has no structure tags, so screen readers cannot tell headings, paragraphs, lists and figures apart.',
    fix: 'Put `\\DocumentMetadata{lang=en-US, pdfstandard=ua-2, tagging=on}` before `\\documentclass` and compile with LuaLaTeX.',
  },
  {
    id: 'pdf-missing-language',
    check: 'accessibility',
    severity: 'error',
    title: 'Document language not set',
    summary:
      'The PDF does not declare its language, so assistive technology may read it with the wrong voice.',
    fix: 'Set `lang=` in `\\DocumentMetadata{...}` (for example `lang=en-US`).',
  },
  {
    id: 'pdf-missing-title',
    check: 'accessibility',
    severity: 'error',
    title: 'Document title missing or not displayed',
    summary:
      'The PDF has no title in its metadata, or viewers are not told to show it instead of the file name (DisplayDocTitle).',
    fix: 'Set `\\hypersetup{pdftitle={...}, pdfdisplaydoctitle=true}` (or `title=` in `\\DocumentMetadata`).',
  },
  {
    id: 'figure-missing-alt',
    check: 'accessibility',
    severity: 'error',
    title: 'Figure without alternative text',
    summary: 'A tagged figure has no alt text, so its content is invisible to screen-reader users.',
    fix: 'Describe what the figure shows: `\\includegraphics[alt={...}]{file}`, or `\\begin{tikzpicture}[alt={...}]` for TikZ; use `artifact` instead of `alt` for purely decorative images.',
  },
  {
    id: 'font-not-embedded',
    check: 'accessibility',
    severity: 'error',
    title: 'Font not embedded',
    summary:
      'A font is referenced but not embedded, so the PDF may render differently elsewhere and fails PDF/UA and most venue checks.',
    fix: 'Use OpenType or Type 1 fonts (LuaLaTeX with fontspec embeds them); re-export figures with fonts embedded.',
  },
  {
    id: 'pdfua-not-claimed',
    check: 'accessibility',
    severity: 'info',
    title: 'PDF/UA conformance not claimed',
    summary:
      'The XMP metadata does not claim PDF/UA, so validators and archives will not treat it as accessible.',
    fix: 'Add `pdfstandard=ua-2` to `\\DocumentMetadata{...}`.',
  },
  {
    id: 'verapdf-not-run',
    check: 'accessibility',
    severity: 'info',
    title: 'veraPDF validation not run',
    summary:
      'veraPDF was not available, so only Overfull’s own accessibility checks ran (no full PDF/UA validation).',
    fix: 'Install veraPDF (https://verapdf.org) or run `overfull check` in the Overfull Docker image.',
  },
  {
    id: 'verapdf-error',
    check: 'accessibility',
    severity: 'warning',
    title: 'veraPDF could not validate the PDF',
    summary: 'veraPDF ran but did not produce a validation result.',
    fix: 'Run `verapdf --flavour ua2 <file.pdf>` by hand to see the error; the PDF may be damaged.',
  },
  {
    id: 'verapdf',
    check: 'accessibility',
    severity: 'error',
    title: 'PDF/UA requirement failed (veraPDF)',
    summary:
      'veraPDF found a PDF/UA violation. Rule ids are `verapdf-<clause>`, e.g. `verapdf-8-2-5-26` for clause 8.2.5.26 of ISO 14289.',
    fix: 'Read the clause description in the message; most failures come from untagged content, missing alt text or metadata.',
  },
];
