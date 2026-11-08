---
title: Accessibility
description: Why accessible PDFs now matter for theses and papers, what tagged PDF and PDF/UA mean, how the Overfull templates produce them, how to write alt text, how veraPDF fits in, and what still needs a human check.
order: 32
section: Checks
---

An accessible PDF can be read with a screen reader, reflowed, searched and
navigated by structure. For a long time LaTeX could not produce one without
heavy manual work. That has changed, and so have the rules.

## Why it matters now

- **European Accessibility Act.** Applies since 28 June 2025 to many digital
  products and services sold in the EU, including e-books. Publishers have been
  updating their requirements as a result.
- **ADA Title II (United States).** A Department of Justice rule from 2024
  requires state and local governments, including public universities, to make
  web content and documents they provide meet WCAG 2.1 AA. The first compliance
  date was 24 April 2026 for larger entities, with 26 April 2027 for smaller
  ones. Check the current status with your institution, as guidance and
  deadlines can change.
- **Universities.** Many graduate schools now require accessible theses and
  dissertations for their repositories. The University of Utah, for example,
  announced requirements taking effect in late April 2026. Ask your graduate
  school or library for their current rules.

Accessibility also helps readers who are not disabled: text that copies
correctly, a PDF that reflows on a phone, figures that are described.

## Tagged PDF and PDF/UA

A **tagged PDF** contains a structure tree next to the visible page: headings,
paragraphs, lists, tables, figures with alternative text, and the reading order.
Assistive technology reads the tree, not the page layout.

**PDF/UA** (ISO 14289) is the standard for accessible PDF. PDF/UA-1 is based on
PDF 1.7. PDF/UA-2 (2024) is based on PDF 2.0. Both require a tagged PDF, a
document language, a title, alt text for figures, and more.

## How the templates do it

The templates use the LaTeX team's built-in tagging support, compiled with
LuaLaTeX. The first line of `main.tex` is a `\DocumentMetadata` declaration
along these lines:

```latex
\DocumentMetadata{lang=en, pdfstandard=ua-2, tagging=on}
```

On top of that, the templates:

- set the document title and language and show the title in the viewer;
- give every sample figure alt text;
- use real tables with header rows and real math;
- use packages known to work with tagging.

CI for the thesis and paper templates requires them to pass `overfull check`,
including veraPDF's PDF/UA validation. Keep that line when you edit the
template. If you add a package that breaks tagging, the accessibility check will
show it.

## Alt text

Alt text replaces the figure for someone who cannot see it. Write what the
reader should learn, in one to three sentences. Do not repeat the caption.

```latex
\includegraphics[width=\linewidth,
  alt={Line chart: training loss falls from 2.1 to 0.4 over 50 epochs and is flat after epoch 30.}]
  {figures/loss.pdf}
```

| Weak | Better |
| --- | --- |
| "Figure 3" | "Bar chart: our method reaches 81% accuracy, the baseline 60%." |
| "Diagram of the system" | "Pipeline: documents are split into chunks, embedded, indexed, then retrieved for each query." |
| "Photo" | "Prototype sensor board, about the size of a credit card, mounted on a drone arm." |
| A paragraph listing every data point | The trend and the values the text relies on. Put full data in a table. |

For complex figures, describe the main point in the alt text and give the
details in the text or a table.

## veraPDF

[veraPDF](https://verapdf.org) is the open-source reference validator for
PDF/A and PDF/UA. The Overfull Docker image includes it, and the template
workflow runs it on every build. Its failures appear in the accessibility check
with the rule that failed. `overfull explain <rule>` gives a plain-language
explanation.

Without veraPDF (for example in the browser check or with a plain `npx overfull`
install), Overfull still checks the basics: tagging, language, title, figures
with and without alt text, PDF/UA claim.

## What automation cannot check

A PDF can pass veraPDF and still be hard to use. Before you submit, check by
hand:

- Alt text is accurate and useful, not just present.
- Reading order is right in multi-column layouts and around floats.
- Headings follow the document structure without skipped levels.
- Link text makes sense on its own ("the dataset documentation", not "here").
- Colour is not the only way information is shown in figures, and contrast is
  sufficient.
- Tables used for data have headers; no tables are used for layout.
- Open the PDF with a screen reader (NVDA on Windows, VoiceOver on macOS) and
  listen to the first pages and one figure.
