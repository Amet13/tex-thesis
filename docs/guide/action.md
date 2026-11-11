---
title: GitHub Action
description: Run Overfull checks in GitHub Actions with amet13/overfull@v3, its inputs and outputs, and how it differs from the template workflow that builds in Docker.
order: 4
section: Start
---

There are three ways to run Overfull in GitHub Actions. Pick the lightest one
that does what you need.

- **No image: the Action alone.** Fastest to start. It checks the log, PDF
  and bibliography your workflow built. veraPDF is not installed on the
  runner, so the accessibility check reports `verapdf-not-run` unless you
  install it.
- **The `-check` image** (`ghcr.io/amet13/overfull:3-check`). The CLI, veraPDF
  and poppler without TeX Live. Use it as a job container, or with
  `docker run`, when you build the PDF elsewhere but want the full
  accessibility check. It cannot build a document.
- **The full image** (`ghcr.io/amet13/overfull:3`). Adds TeX Live 2026, so it
  also builds the PDF. This is what the template workflow uses.

```yaml
    steps:
      - uses: actions/checkout@v7
      # ... build paper.pdf elsewhere ...
      - run: docker run --rm -v "$PWD:/work" -w /work ghcr.io/amet13/overfull:3-check overfull check
```

The rest of this page covers the Action and the template workflow.

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
    runs-on: ubuntu-26.04
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

**Pinning.** `@v3` follows every 3.x release. For fully reproducible CI, pin
a release commit by its full 40-character SHA instead,
`uses: amet13/overfull@<full commit SHA> # v3.1.0`; GitHub rejects short SHAs
in `uses:`, and Dependabot keeps SHA pins up to date.

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
| `sarif` | empty (off) | Path to write a SARIF 2.1.0 file, relative to the workspace. See [Code scanning](#code-scanning-sarif). |

Inputs you leave out come from `overfull.yml` in `working-directory`, where
present. Checks whose default inputs are missing are reported as `skipped`;
an input you give explicitly that points to a missing file fails the step.

### Outputs

| Output | Meaning |
| --- | --- |
| `status` | `pass`, `warn`, `fail`, or `skipped` when nothing could be checked (no log, PDF or `.bib` found). A `skipped` run fails the step unless `fail-on: never`. |
| `report` | Path to the JSON report file, written to `$RUNNER_TEMP`. The content has the same schema as `overfull check --json`. |
| `sarif` | Path to the SARIF file. Set only when the `sarif` input is set. |

### Code scanning (SARIF)

Set `sarif` to a path and the Action writes a SARIF 2.1.0 file there. Upload it
with `github/codeql-action/upload-sarif` and the problems appear under the
repository's Security tab and as annotations on pull requests:

```yaml
permissions:
  contents: read
  security-events: write

jobs:
  check:
    runs-on: ubuntu-26.04
    steps:
      - uses: actions/checkout@v7
      # ... build the document, then:
      - uses: amet13/overfull@v3
        with:
          sarif: overfull.sarif
      - uses: github/codeql-action/upload-sarif@33d7b85da1a04171e211befe2c739303b9a4c066 # v4.39.3
        if: always()
        with:
          sarif_file: overfull.sarif
```

Use `if: always()` so the upload also runs when Overfull fails the step.
Code scanning shows a result only if it has a file and a line
([SARIF requirements](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning)).
Problems that name no source file (PDF, venue and most reference findings) point at the
main file, line 1. Each rule links to its page on this site. On the command
line, `overfull check --sarif > overfull.sarif` writes the same file.

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

### Cache the lookups

Lookups are cached in `~/.cache/overfull` on the runner. Keep that folder
between runs with `actions/cache` and most runs make no reference requests at
all:

```yaml
      - uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
        with:
          path: ~/.cache/overfull
          key: overfull-refs-${{ hashFiles('**/*.bib') }}
          restore-keys: overfull-refs-
      - uses: amet13/overfull@v3
```

A found record is reused for 30 days and a "not found" answer for 1 day. To
look everything up again, run `overfull check --refresh` (the Action has no
refresh input: change the cache `key` instead).
