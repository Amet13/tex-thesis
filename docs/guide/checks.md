---
title: Checks
description: The five Overfull checks (build, output, references, accessibility, venue), severities and statuses, how each check works, and what it cannot detect.
order: 30
section: Checks
---

`overfull check` runs five checks. Each reads files a build already produced
(the `.log`, the `.aux` or `.bcf`, the PDF, the `.bib`, the `.tex` sources).
None of them change your files. The references check only writes its lookup
cache, in your user cache folder (see [Configuration](./config.md#cache)).

| Check | Reads | Answers |
| --- | --- | --- |
| `build` | `.log` | Did TeX report errors? |
| `output` | `.log`, PDF | Did problems reach the PDF? |
| `references` | `.bib`, `.aux`/`.bcf` | Do the cited works exist and match? |
| `accessibility` | PDF, veraPDF | Is the PDF tagged and accessible? |
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
missing, for example no PDF yet, `--offline`, or `accessibility: off` in the
profile. The report's overall status is the worst of the checks that ran.

`overfull check` exits with 1 on `fail`. With `--fail-on warning` it also exits
with 1 on `warn`. Every rule has an id; `overfull explain <rule>` describes it
and `overfull explain --list` lists them all. The ids below are the real ones.

## build

Parses the TeX log for errors (lines starting with `!`, or `file:line: message`
with `-file-line-error`). Follow-on errors within a few lines in the same file
are folded into the first one, so you see the root cause (`related` counts the
folded ones). It works with LuaLaTeX, pdfLaTeX and XeLaTeX logs, and tracks
which file each error came from.

Common ids: `undefined-control-sequence`, `missing-dollar`, `missing-brace`,
`missing-package`, `missing-file`, `font-not-found`, `biblatex-error`,
`tex-error` (any other TeX error). `overfull explain --list` shows all rules
with check `build`.

It cannot tell you about errors TeX did not report, and its line numbers are
TeX's, which can point slightly after the real mistake.

## output

Finds problems that reach the PDF:

- undefined citations and cross-references (`undefined-citation`,
  `undefined-reference`), and `??` or `[?]` in the PDF text with the page
  (`pdf-unresolved-reference`, `pdf-unresolved-citation`);
- a missing, stale or empty bibliography (`bibliography-missing`,
  `bibliography-stale`, `empty-bibliography`) and `rerun-needed` when LaTeX
  reports "Label(s) may have changed";
- missing figure files (`missing-figure`);
- overfull boxes above 10pt (`overfull-box`; smaller ones are ignored);
- duplicate labels (`duplicate-label`), font substitutions
  (`font-substitution`), characters missing from the font (`missing-glyph`),
  floats taller than the page (`float-too-large`), fonts without a requested
  feature (`font-feature-missing`) and headings simplified in PDF bookmarks
  (`pdf-string-token`).

It cannot judge whether a figure is in the right place or whether the layout
looks good. Use `overfull pages` to look.

## references

Looks up every cited entry in your bibliography in CrossRef and doi.org (for
DOIs), the arXiv API (for arXiv ids), and otherwise by title in CrossRef, DBLP
and arXiv, plus OpenAlex when `OPENALEX_API_KEY` is set. Each entry ends up
`verified`, `mismatch`, `not-found`, `unverifiable` or, if the lookup itself
failed, `error`. The rule ids are `reference-not-found`,
`reference-metadata-mismatch`, `reference-unverifiable` and
`reference-lookup-failed`. The check also reports `citation-key-missing` (cited
key not in any `.bib` file) and `bib-parse-error` (malformed entry). See
[References](./references.md) for details.

It cannot tell whether a real paper supports the sentence that cites it. That is
your job.

## accessibility

Reads facts from the PDF: whether it is tagged (`pdf-not-tagged`), its language
and title (`pdf-missing-language`, `pdf-missing-title`), which figures in the
structure tree have alt text (`figure-missing-alt`), embedded fonts
(`font-not-embedded`), and whether it claims PDF/UA (`pdfua-not-claimed`, info).
If `verapdf` is installed (the Docker image includes it), the check runs it
and includes its failures as `verapdf-<clause>` rules. Without it, the check
reports `verapdf-not-run` (info). `--no-verapdf` skips it on purpose. If veraPDF
runs but cannot validate the PDF, the result is `verapdf-error` (warning).

The profile's `accessibility` setting decides the severity: `required` makes
problems errors, `recommended` makes them warnings, `off` skips the check.

It cannot judge whether alt text is accurate, whether reading order makes sense,
or whether colours have enough contrast. See [Accessibility](./accessibility.md)
for a short manual checklist.

## venue

Applies the rules of the profile in `overfull.yml`:

- page limit, optionally counting only up to `\label{overfull:main-end}`
  (`page-limit-exceeded`, `page-limit-label-missing`, `page-limit-unchecked`);
- paper size (`paper-size-mismatch`);
- anonymity for double-blind review: PDF author metadata, `\author` content,
  acknowledgments, and phrases such as "our previous work"
  (`anonymity-pdf-author`, `anonymity-author-named`,
  `anonymity-acknowledgments`, `anonymity-self-reference`);
- presence of an AI-use disclosure, and whether it is still a placeholder
  (`disclosure-missing`, `disclosure-placeholder`);
- arXiv rules: absolute paths, file names with spaces, `.eps` figures when the
  log shows pdfLaTeX, `minted` or shell-escape, the `.bbl` file
  (`arxiv-absolute-path`, `arxiv-filename-space`, `arxiv-eps-pdflatex`,
  `arxiv-shell-escape`, `arxiv-missing-bbl`).

It cannot read a venue's call for papers. The rules are what you configure. It
cannot detect every way to de-anonymise a paper, such as links to your own
repository. See [Venues](./venues.md).
