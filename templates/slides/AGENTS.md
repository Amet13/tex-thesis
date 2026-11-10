# AGENTS.md

This repository is a LaTeX paper or thesis set up with
[Overfull](https://github.com/amet13/overfull), a preflight kit that checks the
build, the PDF, the references, accessibility and venue rules.

You help the author. You do not write their research. The author signs for every
sentence and every reference in this document. Your job is to keep the document
building, correct and verifiable, and to make changes the author can review.

Read `overfull.yml` first. It names the main file, the output name, the
bibliography, the venue profile and the venue rules for this project.

## Layout

Read `overfull.yml` for the main file, the output name and the bibliography.
Other files vary by project; these are the usual places:

| Path | What it holds |
| --- | --- |
| `overfull.yml` | Project config: main file, bibliography, profile, checks, venue rules. |
| The `main:` file | Entry point. Preamble, includes. |
| Files it includes | The text, usually one file per chapter or section (`chapters/`, `sections/`). |
| The `bib:` files | Bibliography. Add entries only through `overfull cite`. |
| `figures/` | Figures, if the project has such a folder. Keep plot data next to the figures. |
| `notes/` | The author's notes, outlines, results, reviewer comments, if present. Source of truth for content. |
| `metadata.tex` | Title, authors, affiliations, PDF metadata, in projects from the Overfull templates. |
| `.agents/skills/` | Task instructions for you (also linked as `.claude/skills/`). |

## Build

```sh
overfull build        # or: make build
```

- `overfull build` uses local `latexmk` if present, otherwise the Overfull
  Docker image. Do not pass `--engine` unless the author asks.
- When no source changed since the last good build, `overfull build` skips
  `latexmk` and reports on the existing log and PDF. `overfull build --force`
  rebuilds anyway.
- Never install TeX packages or fonts globally. If a package is missing, use the
  Docker engine (`overfull build --engine docker`) or tell the author.
- Do not change the TeX engine (LuaLaTeX in the templates) or the document class
  to make an error go away, except via the documented arXiv path: the paper
  template builds with pdfLaTeX for arXiv (`make arxiv` or `latexmk -pdf`),
  because arXiv does not support LuaLaTeX. See `prepare-arxiv`.
- `overfull doctor` reports what is installed and what is missing. It exits 1
  when nothing can build the document (no TeX Live and no usable Docker image):
  tell the author.

## The loop and the definition of done

After every change:

1. `overfull build`
2. `overfull check --json`
3. Fix every problem with severity `error`.
4. Read every `warning`. Fix it, or explain to the author why it stays.
5. Repeat until there are no errors.

**Done means `overfull check` reports no errors** and you have told the author
about any warnings that remain. Exit code 0 is pass (warnings allowed), 1 is
fail, 2 is a usage or internal error.

Every command takes `--json`. Under `--json`, errors are JSON on stdout too:
`{"error": {"code": "usage" | "internal" | "build-failed" | ..., "message": "…"}}`,
so parse stdout and use the exit code for the verdict.

The JSON is a `Report`:

```json
{
  "tool": "overfull", "version": "…", "status": "fail",
  "checks": [
    { "check": "references", "status": "fail", "summary": "28 of 31 references verified",
      "problems": [
        { "rule": "…", "check": "references", "severity": "error",
          "message": "…", "location": { "file": "references.bib", "line": 42 },
          "fix": "…", "data": { "key": "…" } } ] } ] }
```

- `checks[]`: `build`, `output`, `references`, `accessibility`, `venue`. Status
  is `pass`, `warn`, `fail`, or `skipped` (with `skippedReason`).
- `problems[]`: `rule` (stable id), `severity` (`error`, `warning`, `info`),
  `message`, `location` (`file`, `line`, `page`), `fix`, optional `detail`,
  `evidence`, `data`.
- `overfull explain <rule>` prints what a rule means and how to fix it;
  `overfull explain --list` lists every rule id.
- Run a subset with `overfull check --json --checks build,output`.
- `overfull check` runs veraPDF in the default Overfull image or `--image`; it
  never uses `build.image` from `overfull.yml`. Do not add `--image` unless the
  author asks.

## Hard rules

References:

- Add references only with `overfull cite <doi | arXiv:id | "title">`. Never
  write or edit BibTeX from memory.
- Never cite a key you did not add with `overfull cite` and the author did not
  provide. Never cite a key that `check` reports as `reference-not-found`
  or `citation-key-missing`.
- If `overfull cite` finds no confident match, stop and tell the author what you
  searched for. Do not guess a DOI, title, year or author list.
- Never write or edit the `x-overfull` field, and never add
  `note = {overfull: skip}` or `note = {overfull: author-provided}`. Only
  `overfull cite` writes provenance (a tamper-evident hash, not
  authentication); only the author opts entries out or vouches for one.
- With `references.requireCite` (on in the templates), an entry that no index
  verifies and that `cite` did not write is `reference-unproven`. Ask the author
  for a DOI or arXiv id; do not hand-write the entry. `reference-doi-wrong-work`
  and `reference-arxiv-wrong-work` mean the identifier belongs to another paper.
- Files you write (`cite --bib`, `pages --out`, `diff --out`) must be inside the
  project.
- A `reference-metadata-mismatch` warning means the bib entry differs from the
  indexed record. Show the author both and let them decide. `overfull cite`
  never overwrites an existing entry.
- If `overfull cite` lists several candidates for a title, do not pick one. Use a
  DOI, rerun with `--author` and `--year`, or ask the author.

Content:

- Never invent data, results, numbers, quotes, participants or experiments.
- Claims about the research come from `notes/` or from the author. If the
  source is missing, leave a `% TODO(author): …` comment, list it for the
  author, and do not fill the gap.
- Do not reflow, rephrase or "improve" the author's text unless asked. Keep
  diffs small so the author can review them.

Rules and checks:

- Do not edit the `venue:` section of `overfull.yml`, change `profile`, remove
  entries from `checks`, or add `references.ignore` entries to make a check pass.
  Change `overfull.yml` only when the author tells you what the venue requires.
- Do not hack spacing, fonts, margins or float parameters to meet a page limit.

Figures and accessibility:

- Keep figures reproducible: data in `figures/data/` plus pgfplots code or a
  script that regenerates the image.
- Every figure needs alt text that says what the figure shows, not "Figure 3".
- Keep `\DocumentMetadata` and `tagging=on`. Keep the document language and
  title set in metadata.

LaTeX source:

- Write raw LaTeX. Never HTML-escape (`&amp;`, `&lt;`). Escape LaTeX specials:
  `\&`, `\%`, `\_`, `\#`, `\$`, `\{`, `\}`.
- Use `\cref{}` for cross-references and `\label{}` with a prefix (`fig:`,
  `tab:`, `sec:`, `eq:`).
- One sentence per line is fine for new text. Do not reformat existing text.

## Looking at the PDF

When layout matters (figure placement, overfull lines, page breaks), render
pages and look at them if you can read images:

```sh
overfull pages 3-5          # renders pages to PNG and prints the paths
overfull pages 7 --dpi 150
```

## Working with the author

- One logical change per commit. Commit messages describe the content change
  ("Add related-work paragraph on X from notes/related.md"), not "update files".
- Work on a branch and open a pull request. Run `overfull diff --base main` so
  the author can read a PDF with your changes highlighted.
- In the PR description, list what changed, what you could not verify, and the
  remaining warnings.

## AI-use disclosure

If `overfull.yml` sets `venue.disclosure: required`, or the venue asks for an AI
statement, draft one with `.agents/skills/write-disclosure`. Base it on what was
actually done in this repository. The author must read, edit and approve it.
Never state that no AI was used.

## Skills

Read the matching `SKILL.md` in `.agents/skills/` before starting a task:

| Skill | Use it to |
| --- | --- |
| `start-paper` | Fill metadata, outline from `notes/`, set the profile, first build and check. |
| `add-citation` | Add a verified reference with `overfull cite` and cite it. |
| `fix-build` | Fix TeX errors and output problems from `overfull check`. |
| `add-figure` | Add a reproducible figure with alt text, placement and `\cref`. |
| `make-accessible` | Fix tagging, alt text, language, title, tables and veraPDF failures. |
| `fit-page-limit` | Get under the venue page limit without breaking venue rules. |
| `prepare-arxiv` | Make the source arXiv-ready and check it with the `arxiv` profile. |
| `write-disclosure` | Draft an AI-use statement from actual use for the author to approve. |
| `review-changes` | Prepare a reviewable PR with a highlighted-changes PDF. |
| `respond-to-reviewers` | Map reviewer comments to changes and keep a response letter. |
