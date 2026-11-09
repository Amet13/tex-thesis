---
name: make-accessible
description: Make the PDF accessible (tagged PDF, PDF/UA) and fix accessibility check failures, including missing alt text, document language, title, table headers, math and veraPDF rule failures. Use when the accessibility check fails or warns, when the author needs an accessible thesis or paper, or before submission to a university or venue that requires accessible PDFs.
---

# Make the PDF accessible

The templates produce a tagged PDF through LaTeX's built-in tagging:
`\DocumentMetadata{…, tagging=on}` at the top of `main.tex`, compiled with
LuaLaTeX. Most fixes are about content the author must supply, not settings.

## Steps

1. Build and check:

   ```sh
   overfull build
   overfull check --json --checks accessibility
   ```

2. Fix problems in this order: document-level settings, then figures, then
   tables, then the rest. Run `overfull explain <rule>` when unsure.
3. Rebuild and recheck after each group.

## Document level

- `\DocumentMetadata` must be the first line of `main.tex` and keep
  `tagging=on` and the `lang` setting. Do not remove it to fix a build error;
  fix the error instead (see `fix-build`).
- Title: set in `metadata.tex`. The PDF title must match the document title.
- Language: `lang` in `\DocumentMetadata` must match the text (`en`, `de`, …).
  Mark passages in another language with the document's language package
  (for example babel's `\foreignlanguage`).
- Do not change the engine (except via the arXiv path in `prepare-arxiv`) or the
  PDF standard settings.

## Figures

Every figure needs alt text. See `add-figure` for how to write it. If you do not
know what a figure shows, ask the author. Do not describe an image you cannot
see, and do not write placeholder text such as "image".

## Tables

- Use real `tabular` tables for data, never images of tables.
- Give each data table a header row. Follow the template's table example for
  marking the header so it is tagged as header cells.
- Do not use tables for layout.

## Math, links, lists

- Write math in math mode, never as images.
- Link text should make sense alone: "the dataset documentation", not "here".
- Use `itemize`/`enumerate` for lists, not manual dashes and line breaks.
- Do not rely on colour alone to carry meaning in figures or text.

## veraPDF failures

The Docker image and the template workflow run veraPDF. Its failures appear in
the accessibility check with the rule and, when known, the page. Common fixes:

Overfull's own rules cover the basics; veraPDF failures have ids of the form
`verapdf-<clause>` (run `overfull explain verapdf-<clause>`). With `--no-verapdf`,
or without veraPDF installed, only the basics run (`verapdf-not-run`, info).

| Failure (rule id) | Likely fix |
| --- | --- |
| Figure without alternate text (`figure-missing-alt`) | Add alt text to that figure. |
| Missing or wrong language (`pdf-missing-language`) | Set `lang` in `\DocumentMetadata`. |
| Missing title / DisplayDocTitle (`pdf-missing-title`) | Set the title in `metadata.tex`. |
| Not tagged (`pdf-not-tagged`), or untagged content (`verapdf-<clause>`) | A package that does not support tagging yet. Report the package to the author; do not remove tagging. |
| Fonts not embedded (`font-not-embedded`) | Usually an included PDF figure. Re-export it with embedded fonts. |
| PDF/UA not claimed (`pdfua-not-claimed`, info) | Add `pdfstandard=ua-2` to `\DocumentMetadata`. |

## Limits

Automated checks cannot judge whether alt text is accurate, reading order makes
sense, or colour contrast in figures is enough. List these for the author to
review by hand.

## Done

- `overfull check --checks accessibility` has no errors.
- Every alt text you wrote is based on the data or on the author's description.
- You listed what still needs a human check.
