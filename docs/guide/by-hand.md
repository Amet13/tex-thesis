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
make build    # compile the PDF (Docker, or local TeX if configured)
make watch    # rebuild whenever you save a .tex or .bib file
make check    # run all checks and print a report
make help     # list every target
```

The Makefile calls `overfull build` and `overfull check`. You can call those
directly too; see the [CLI reference](./cli.md).

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

`make check` prints one block per check, then the problems under it:

```text
output  warn
  warning  overfull-hbox  sections/method.tex:31  Line too wide by 14.2pt
           fix: rephrase, or allow a break in the long word or URL

references  fail  30 of 31 references verified
  error    not-found  references.bib:88  No indexed record matches "Deep Graph Transformers" (2023)
           fix: check the title and add a DOI, or remove the entry
```

The exact wording and rule ids may differ from this example. Each problem has:

- a **severity**: `error` (wrong, or will be rejected), `warning` (probably a
  problem, look at it), `info` (could not be checked, or advice);
- a **rule id**, which you can look up with `overfull explain <rule>`;
- a **location**: a file and line, or a PDF page;
- a **message** and usually a **fix**.

Work through errors first. A single TeX error often causes several follow-on
messages; Overfull groups them under the first one, so fix that and rebuild.

Every check ends as `pass`, `warn`, `fail` or `skipped`. `skipped` comes with a
reason, for example "no PDF found, run make build first" or "offline".

The command exits with 0 when nothing failed and 1 when something did, so you can
use it in scripts and Git hooks.

## Adding references

You can edit `references.bib` by hand as usual. Overfull checks every entry on
each `make check`. You can also let it write entries for you from a DOI, arXiv id
or title:

```sh
overfull cite 10.1038/s41586-021-03819-2
overfull cite arXiv:2005.14165
```

See [References](./references.md).

## Before you submit

```sh
make build
make check
overfull diff --base submitted-v1   # PDF with changes since a tag, for a revision
```

Then look at [Venues](./venues.md) for page limits, anonymity and arXiv.
