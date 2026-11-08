---
title: Checks
description: The five Overfull checks (build, output, references, accessibility, venue), severities and statuses, how each check works, and what it cannot detect.
order: 30
section: Checks
---

`overfull check` runs five checks. Each reads files a build already produced
(the `.log`, the `.aux` or `.bcf`, the PDF, the `.bib`, the `.tex` sources).
None of them change your files.

| Check | Reads | Answers |
| --- | --- | --- |
| `build` | `.log` | Did TeX report errors? |
| `output` | `.log`, PDF | Did problems reach the PDF? |
| `references` | `.bib`, `.aux`/`.bcf` | Do the cited works exist and match? |
| `accessibility` | PDF, veraPDF report | Is the PDF tagged and accessible? |
| `venue` | PDF, `.aux`, `.tex` | Does it meet the venue's rules? |

Run some of them with `--checks`:

```sh
overfull check --checks build,output
```

## Severities and statuses

Every problem has a severity:

- `error`: the paper is wrong or will be rejected. Examples: `??` in the PDF,
  a reference that matches no indexed work, over the page limit.
- `warning`: likely a problem that needs a human look. Examples: bib metadata
  that differs from the indexed record, an overfull box wider than 10pt.
- `info`: could not be checked automatically, or advice. Example: a website
  reference that no index covers.

Each check gets a status: `fail` if it has any error, `warn` if it has any
warning, `pass` otherwise, and `skipped` (with a reason) when its inputs are
missing, for example no PDF yet or `--offline`. The report's overall status is
the worst of the checks that ran.

`overfull check` exits with 1 on `fail`. With `--fail-on warning` it also exits
with 1 on `warn`. Every rule has an id; `overfull explain <rule>` describes it.

## build

Parses the TeX log for errors (lines starting with `!`, or `file:line: message`
with `-file-line-error`). Follow-on errors within a few lines in the same file
are folded into the first one, so you see the root cause. It works with
LuaLaTeX, pdfLaTeX and XeLaTeX logs, and tracks which file each error came from.

It cannot tell you about errors TeX did not report, and its line numbers are
TeX's, which can point slightly after the real mistake.

## output

Finds problems that reach the PDF:

- undefined citations and cross-references, and `??` or `[?]` in the PDF text
  (with the page);
- a stale bibliography that needs another Biber or BibTeX run;
- missing files and figures;
- overfull boxes above 10pt (smaller ones are ignored);
- duplicate labels, font substitutions, "Label(s) may have changed".

It cannot judge whether a figure is in the right place or whether the layout
looks good. Use `overfull pages` to look.

## references

Looks up every cited entry in your bibliography in CrossRef and doi.org (for
DOIs), the arXiv API (for arXiv ids), and otherwise by title in CrossRef, DBLP
and OpenAlex. Each entry ends up `verified`, `mismatch`, `not-found` or
`unverifiable`. See [References](./references.md) for details.

It cannot tell whether a real paper supports the sentence that cites it. That is
your job.

## accessibility

Reads facts from the PDF: whether it is tagged, its language and title, which
figures in the structure tree have alt text, embedded fonts, and whether it
claims PDF/UA. When a veraPDF report is available (the Docker image and the
template workflow produce one), its failures are included.

It cannot judge whether alt text is accurate, whether reading order makes sense,
or whether colours have enough contrast. See [Accessibility](./accessibility.md)
for a short manual checklist.

## venue

Applies the rules of the profile in `overfull.yml`:

- page limit, optionally counting only up to `\label{overfull:main-end}`;
- paper size;
- anonymity for double-blind review: PDF author metadata, `\author` content,
  acknowledgments;
- presence of an AI-use disclosure when the venue requires one;
- arXiv rules: absolute paths, file names with spaces, `.eps` with pdfLaTeX,
  `minted` or shell-escape, the `.bbl` file.

It cannot read a venue's call for papers. The rules are what you configure. It
cannot detect every way to de-anonymise a paper, such as self-citations in the
first person or links to your own repository. See [Venues](./venues.md).
