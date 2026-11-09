---
title: GitHub Action
description: Run Overfull checks in GitHub Actions with amet13/overfull@v3, its inputs and outputs, and how it differs from the template workflow that builds in Docker.
order: 42
section: Reference
---

There are two ways to run Overfull in GitHub Actions.

- **The Action** (`amet13/overfull@v3`) checks files your workflow already
  produced: the log, the PDF, the bibliography. Use it to add Overfull to an
  existing LaTeX workflow.
- **The template workflow** (`.github/workflows/paper.yml` in each template)
  builds the PDF in the Overfull Docker image, runs every check including
  veraPDF, and builds a highlighted-changes PDF for pull requests. The slides
  template runs only the checks its `overfull.yml` lists.

## The Action

```yaml
name: paper
on: [push, pull_request]

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7
      # ... your existing step that builds paper.pdf and paper.log ...
      - uses: amet13/overfull@v3
        id: overfull
        with:
          pdf: paper.pdf
          log: paper.log
          bib: references.bib
          aux: paper.aux
          profile: paper
          mailto: you@example.org
          fail-on: error
      - run: echo "Overfull status ${{ steps.overfull.outputs.status }}"
        if: always()
```

The file names must match your build's jobname: `paper` in the paper
template, `thesis` in the thesis template, set in `.latexmkrc` (`$jobname`) or
in `overfull.yml` (`jobname:`). Without a jobname, latexmk names the files after
the main file (`main.pdf`). You can leave `pdf`, `log` and `aux` out: the Action
then uses `<jobname>.pdf` and so on from `overfull.yml`. A file you name
explicitly must exist: if it does not, the step fails with a message naming
the missing file, so a wrong name cannot silently skip a check.

**Pinning.** Before v3.0.0 is released there is no `@v3` tag. Pin a commit
with its full 40-character SHA,
`uses: amet13/overfull@<full 40-character commit SHA>`; GitHub rejects short
SHAs in `uses:`. Pinning a full SHA is also good practice after the release.

The Action writes problems as annotations (at most 50), adds a Markdown report
to the job summary, and fails the step according to `fail-on`. It does not build
the document or run latexdiff. It runs veraPDF only if `verapdf` is installed on
the runner; otherwise the accessibility check reports `verapdf-not-run` as
`info`. For full PDF/UA validation, use the template workflow (which builds and
checks in the Docker image) or install veraPDF on the runner before this step. An invalid input or `overfull.yml` fails the step with exit code 2.

Text from your documents (log excerpts, titles, file names, error messages)
could contain GitHub workflow commands. Overfull neutralizes it: stderr is
always escaped, and the commands Overfull itself prints run inside a
`stop-commands` guard on stderr, so only the annotations it writes on purpose
take effect. The `--json` and `--markdown` output of the CLI stays clean in
Actions.

### Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `working-directory` | `.` | Project directory, where `overfull.yml`, the log and the PDF are. |
| `checks` | from `overfull.yml`, else all | Comma-separated checks to run: `build,output,references,accessibility,venue`. |
| `profile` | from `overfull.yml` | Venue profile: `generic`, `thesis`, `paper`, `arxiv` or `double-blind`. |
| `pdf` | `<jobname>.pdf` | Built PDF, relative to `working-directory`. Must exist if given. |
| `log` | `<jobname>.log` | TeX log, relative to `working-directory`. Must exist if given. |
| `bib` | from `overfull.yml` or `main.tex` | Comma-separated `.bib` files. |
| `aux` | `<jobname>.aux` | `.aux` file (cited keys, end label page). Must exist if given. |
| `fail-on` | `error` | `error`, `warning` or `never`. |
| `offline` | `false` | `true` to skip reference lookups. |
| `mailto` | `references.mailto`, else `$OVERFULL_MAILTO` | Contact address for CrossRef's polite pool. |
| `annotations` | `true` | Write problems as file annotations. |
| `summary` | `true` | Write a Markdown report to the job summary. |

Inputs you leave out come from `overfull.yml` in `working-directory`, where
present. Checks whose default inputs are missing are reported as `skipped`;
an input you give explicitly that points to a missing file fails the step.

### Outputs

| Output | Meaning |
| --- | --- |
| `status` | `pass`, `warn` or `fail`. |
| `report` | Path to the JSON report file, written to `$RUNNER_TEMP`. The content has the same schema as `overfull check --json`. |

## The template workflow

Projects made with `overfull init` include a workflow that runs its job in
`ghcr.io/amet13/overfull` (TeX Live 2026, pinned) and:

1. builds the PDF with `latexmk` (the paper template also builds with pdfLaTeX,
   `latexmk -pdf -jobname=paper-arxiv`, because arXiv does not run LuaLaTeX);
2. runs `overfull check` three times: once to write the Markdown report to the
   job summary, once to print annotations, and once to set the job status.
   veraPDF is part of the image, so the accessibility check runs it;
3. on pull requests, runs `overfull diff` against the base branch;
4. uploads the PDFs (including the highlighted-changes PDF) and logs as one
   artifact named `pdf`.

Use it as is, or copy its steps into your own workflow. Because the build runs
in the same image as `make build`, a PDF that builds locally builds in CI.

## Reference lookups in CI

The references check queries CrossRef, doi.org, arXiv and DBLP from the runner.
Set `mailto` so CrossRef requests go to its polite pool. To add OpenAlex title
search, pass the key as an environment variable on the step:

```yaml
      - uses: amet13/overfull@v3
        env:
          OPENALEX_API_KEY: ${{ secrets.OPENALEX_API_KEY }}
```

For forks or restricted networks, set `offline: true` and run reference checks
locally.
