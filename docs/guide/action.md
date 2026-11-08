---
title: GitHub Action
description: Run Overfull checks in GitHub Actions with amet13/overfull@v1, its inputs and outputs, and how it differs from the template workflow that builds in Docker.
order: 42
section: Reference
---

There are two ways to run Overfull in GitHub Actions.

- **The Action** (`amet13/overfull@v1`) checks files your workflow already
  produced: the log, the PDF, the bibliography. Use it to add Overfull to an
  existing LaTeX workflow.
- **The template workflow** (`.github/workflows/paper.yml` in each template)
  builds the PDF in the Overfull Docker image, runs every check including
  veraPDF, and builds a highlighted-changes PDF for pull requests.

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
      # ... your existing step that builds main.pdf and main.log ...
      - uses: amet13/overfull@v1
        id: overfull
        with:
          pdf: main.pdf
          log: main.log
          bib: references.bib
          aux: main.aux
          profile: paper
          mailto: you@example.org
          fail-on: error
      - run: echo "Overfull status ${{ steps.overfull.outputs.status }}"
        if: always()
```

The Action writes problems as annotations on the changed files, adds a Markdown
report to the job summary, and fails the step according to `fail-on`. It does
not build the document, run veraPDF or run latexdiff.

### Inputs

| Input | Meaning |
| --- | --- |
| `checks` | Comma-separated checks to run: `build,output,references,accessibility,venue`. |
| `profile` | Venue profile, overriding `overfull.yml`. |
| `pdf` | Path to the built PDF. |
| `log` | Path to the TeX log. |
| `bib` | Path to the bibliography. |
| `aux` | Path to the `.aux` file (cited keys, end label page). |
| `fail-on` | `error` or `warning`. |
| `offline` | `true` to skip reference lookups. |
| `mailto` | Contact address for CrossRef and OpenAlex. |
| `working-directory` | Project directory, if not the repository root. |

Inputs you leave out come from `overfull.yml` in `working-directory`, where
present. Checks whose inputs are missing are reported as `skipped`.

### Outputs

| Output | Meaning |
| --- | --- |
| `status` | `pass`, `warn` or `fail`. |
| `report` | The JSON report (same schema as `overfull check --json`). |

## The template workflow

Projects made with `overfull init` include a workflow that:

1. builds the PDF in `ghcr.io/amet13/overfull` (TeX Live 2026, pinned);
2. runs `overfull check` with veraPDF for the accessibility check;
3. on pull requests, runs `overfull diff` against the base branch;
4. uploads the PDF, the highlighted-changes PDF and the report as artifacts.

Use it as is, or copy its steps into your own workflow. Because the build runs
in the same image as `make build`, a PDF that builds locally builds in CI.

## Reference lookups in CI

The references check queries CrossRef, doi.org, arXiv, DBLP and OpenAlex from
the runner. Set `mailto` so requests go to the polite pools. For forks or
restricted networks, set `offline: true` and run reference checks locally.
