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
    fix: 'Add `\\DocumentMetadata{lang=en, pdfstandard=ua-2, pdfversion=2.0, tagging=on}` as the first line of main.tex and compile with LuaLaTeX. An untagged PDF also fails most veraPDF clauses; they are folded into this problem.',
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
    severity: 'warning',
    title: 'veraPDF validation not run',
    summary:
      'veraPDF was not available, so only Overfull’s own accessibility checks ran (no full PDF/UA validation). A warning when the profile requires accessibility (thesis, paper) and the CLI could have run it (Docker is available); otherwise, including in the browser and the GitHub Action, a note.',
    fix: 'Install veraPDF (https://verapdf.org) and put `verapdf` on PATH, run `overfull check --engine docker`, or run the check in the Overfull Docker image.',
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

/** What a veraPDF clause (or clause family) means and how to fix it in LaTeX. */
export interface VeraPdfClauseInfo {
  /** Clause prefix: `8.2.5` matches 8.2.5 and 8.2.5.26. */
  clause: string;
  title: string;
  summary: string;
  fix: string;
}

/**
 * The clauses LaTeX documents fail most often: PDF/UA-2 (ISO 14289-2 via ISO 32005,
 * `8.x`) and PDF/UA-1 (ISO 14289-1, `7.x`). Anything else uses the generic `verapdf` rule.
 */
export const veraPdfClauses: VeraPdfClauseInfo[] = [
  {
    clause: '8.2.2',
    title: 'Content is neither tagged nor marked as an artifact',
    summary:
      'Every piece of page content must belong to the structure tree or be marked as an artifact (page numbers, running headers, decorative rules). Untagged content is invisible or confusing to screen readers. Usually caused by packages or drawing code that tagging does not yet support, or by a PDF built without tagging.',
    fix: 'Build with `\\DocumentMetadata{… tagging=on}` and LuaLaTeX; update TeX Live (tagging support improves every year). Wrap decorative material in `\\tagmcbegin{artifact}`…`\\tagmcend` or use the package’s `artifact` option; include images with `alt=` or `artifact`.',
  },
  {
    clause: '8.2.5',
    title: 'Structure element used where the standard does not allow it',
    summary:
      'The structure tree breaks a nesting rule of the PDF 2.0 namespace (for example a `Caption` outside a `Figure`/`Table`, or a list item outside `L`). Usually caused by a package or class that tags its output in its own way.',
    fix: 'Update TeX Live and the class; remove manual `\\tagstructbegin` code or packages known to break tagging (check https://latex3.github.io/tagging-project/tagging-status/). The evidence lists the offending structure elements.',
  },
  {
    clause: '7.1',
    title: 'Tagging and general PDF/UA requirements',
    summary:
      'The PDF is not tagged, marks content inconsistently, or lacks basic PDF/UA properties (MarkInfo, DisplayDocTitle, the PDF/UA identification in XMP).',
    fix: 'Add `\\DocumentMetadata{lang=en, pdfstandard=ua-2, pdfversion=2.0, tagging=on}` as the first line of main.tex, set `\\hypersetup{pdftitle={…}, pdfdisplaydoctitle=true}`, and build with LuaLaTeX.',
  },
  {
    clause: '7.18',
    title: 'Annotation or link not accessible',
    summary:
      'Links and other annotations must be tagged (inside a `Link` structure element) and carry a text description (`Contents`). hyperref links from an untagged or partly tagged build fail this.',
    fix: 'Build with tagging on (`\\DocumentMetadata{… tagging=on}`) so hyperref tags its links; avoid packages that draw their own link annotations.',
  },
  {
    clause: '7.21',
    title: 'Font problem (embedding, encoding or Unicode mapping)',
    summary:
      'A font is not embedded, has no Unicode mapping (ToUnicode), or its widths disagree with the embedded program. Screen readers then cannot extract the text. Common with Type 3 bitmap fonts and figures exported with non-embedded fonts.',
    fix: 'Compile with LuaLaTeX and OpenType fonts (fontspec); re-export PDF/EPS figures with fonts embedded (or as outlines). Avoid bitmap (Type 3) fonts.',
  },
  {
    clause: '7.3',
    title: 'Figure without alternative text',
    summary: 'A `Figure` structure element has no `Alt` (or `ActualText`) description.',
    fix: 'Give every figure alt text: `\\includegraphics[alt={…}]{file}`, `\\begin{tikzpicture}[alt={…}]`; use `artifact` for purely decorative images.',
  },
];

/** The most specific clause explanation for `clause` (e.g. `8.2.5.26`), if any. */
export function veraPdfClauseInfo(clause: string): VeraPdfClauseInfo | undefined {
  const c = clause.trim();
  return veraPdfClauses
    .filter((i) => c === i.clause || c.startsWith(`${i.clause}.`))
    .sort((a, b) => b.clause.length - a.clause.length)[0];
}
