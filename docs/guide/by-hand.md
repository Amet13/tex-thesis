---
title: Working by hand
description: The classic LaTeX workflow with Overfull, using make build, make watch and make check, VS Code with LaTeX Workshop, and how to read the check report.
order: 20
section: By hand
---

You write the LaTeX. Overfull builds it reproducibly and tells you what is wrong
before a reviewer, an examiner or arXiv does. No agent is involved.

## Daily commands

In a project made from a template:

```sh
make build    # compile the PDF (local latexmk if installed, otherwise Docker)
make watch    # rebuild whenever you save a .tex or .bib file
make check    # run all checks and print a report
make help     # list every target
```

> **New to Docker?** Install [Docker Desktop](https://docs.docker.com/desktop/)
> (macOS, Windows) or [Docker Engine](https://docs.docker.com/engine/install/)
> (Linux) and start it. The first build downloads the Overfull image: about
> 3 GB compressed, 9–10 GB on disk, so allow a few minutes and the disk space.
> After that, builds take seconds.

`make build` and `make watch` run `latexmk` directly (local, or in the Docker
image if `latexmk` is not installed). `make check` runs `overfull check`. The
Makefile has more targets: `make pages PAGES=4-6` renders pages to PNG,
`make diff` builds a PDF of the changes against `origin/main` (set `BASE=` to
change it), and `make clean` removes build files. The paper template adds
`make arxiv`, which builds with pdfLaTeX as arXiv does. You can call the `overfull`
commands directly too; see the [CLI reference](./cli.md).

## Project layout

```text
main.tex           entry point and preamble
metadata.tex       title, authors, keywords, PDF metadata
chapters/          thesis chapters (sections/ in the paper template)
figures/           images and pgfplots figures; plot data in figures/data/
notes/             your notes (not included in the PDF)
references.bib     bibliography
overfull.yml       project settings and venue rules
```

The agent files (`AGENTS.md`, `CLAUDE.md`, `.agents/`, `.claude/`) do nothing
unless you use an agent. Delete them if you like.

## VS Code with LaTeX Workshop

1. Install the [LaTeX Workshop](https://marketplace.visualstudio.com/items?itemName=James-Yu.latex-workshop)
   extension.
2. Open the project, either locally (with TeX Live installed) or in the
   [Dev Container](./install.md#dev-container-and-vs-code).
3. Save `main.tex`. LaTeX Workshop runs `latexmk` with LuaLaTeX and shows the
   PDF in a tab. SyncTeX lets you jump between source and PDF.
4. Run `make check` in the terminal before you commit or submit.

Any editor works. Overfull only needs the files on disk.

## Reading the report

`make check` prints one line per check, then the problems, worst first:

```text
overfull paper.pdf  FAIL
  ✓ build       Build succeeded (paper.pdf, 8 pages)
  ! output      1 × overfull-box
  ✕ references  11 of 12 references verified (1 not found)

  ✕ references.bib:88  `lee2023deep` was not found in CrossRef, dblp or arXiv  reference-not-found
  ! sections/method.tex:31  Text sticks 14.2pt into the margin (lines 31–33)  overfull-box

1 to fix · 1 to review · 1 passed
Run with --verbose for fixes, or `overfull explain <rule>`.
```

Add `--verbose` (or `-v`) to see why each problem happened and how to fix it.
Each problem has:

- a **severity**: `error` (wrong, or will be rejected), `warning` (probably a
  problem, look at it), `info` (could not be checked, or advice);
- a **rule id**, which you can look up with `overfull explain <rule>`;
- a **location**: a file and line, or a PDF page;
- a **message** and usually a **fix**.

Work through errors first. A single TeX error often causes several follow-on
messages; Overfull groups them under the first one, so fix that and rebuild.

Every check ends as `pass`, `warn`, `fail` or `skipped`. `skipped` comes with a
reason, for example "No paper.pdf — run `overfull build` first" or "offline:
references were not looked up".

`overfull check` exits with 0 when nothing failed and 1 when something did (use
`--fail-on warning` to fail on warnings too), so you can use it in scripts and
Git hooks.

## Adding references

Overfull checks every entry in `references.bib` on each `make check`. The
easiest way to add one is to let Overfull write it from a DOI, arXiv id or
title:

```sh
overfull cite 10.1038/s41586-021-03819-2
overfull cite arXiv:2005.14165
```

The templates set `references.requireCite: true` in `overfull.yml`, a guard
against made-up entries from agents. Entries added with `overfull cite` carry a
provenance marker (`x-overfull = {cite …}`). An entry you write yourself
passes in either of two ways:

- it verifies against CrossRef, doi.org, DBLP or arXiv (a correct DOI is
  usually enough), or
- you add `note = {overfull: author-provided}`, your statement that the entry
  is real. Agents never add this note.

Otherwise the check reports `reference-unproven` (error). If you do not use
agents at all, set `requireCite: false` under `references:` in `overfull.yml`
and edit `references.bib` as usual.

See [References](./references.md#provenance).

## Before you submit

```sh
make build
make check
overfull diff --base submitted-v1   # PDF with changes since a tag, for a revision
```

Then look at [Venues](./venues.md) for page limits, anonymity and arXiv.
