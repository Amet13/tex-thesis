---
title: Guide
description: A preflight kit for LaTeX papers and theses. It checks the build, the PDF, the references, accessibility and venue rules, for authors working by hand or with an AI agent.
order: 1
section: Start
---

Overfull is a preflight kit for LaTeX papers and theses. Before you submit, it
answers questions that are tedious to check by hand and easy to get wrong:

- Does the document build without errors, and does the PDF contain `??` or `[?]`?
- Does every reference in `references.bib` exist, and does it match the
  indexed record?
- Is the PDF tagged and accessible, with alt text, a language and a title?
- Does it meet the venue's rules: page limit, anonymity, AI-use disclosure,
  arXiv packaging?

It comes as a command-line tool (`overfull`), a Docker image with TeX Live,
templates for a thesis, a paper and slides, a GitHub Action, and a
[browser check](https://amet13.github.io/overfull/check/) for a log, `.bib` or
PDF you already have.

## Two ways in

**By hand.** You write LaTeX the way you always have. `make build` produces the
PDF and `make check` tells you, in plain language, what is wrong and where. You
need only Docker. See [Working by hand](./by-hand.md).

**With an agent.** You work with an AI coding agent such as Claude Code, Codex,
Cursor, GitHub Copilot or Gemini CLI. The templates include `AGENTS.md` and a set
of skills that tell the agent how to build, add references and verify its work.
The agent runs `overfull check --json` after every change and stops when there
are no errors. See [Working with an agent](./with-an-agent.md).

Both paths run the same checks and get the same results.

## What Overfull does not do

Overfull never writes research content. It does not draft paragraphs, generate
references or summarise papers. It adds information neither you nor a model has
on its own: whether a DOI resolves, what is actually in the PDF, what the venue
requires. You remain responsible for every sentence and every reference.

## Start in five minutes

The first build downloads or builds a Docker image of about 3 GB; after that,
builds take seconds.

With the `overfull` command from the
[GitHub Releases](https://github.com/amet13/overfull/releases) download (or
only Docker, see [Install](./install.md)):

```sh
overfull init paper my-paper
cd my-paper
make build
make check
```

`init` copies the paper template (use `thesis` or `slides` for the others).
`make build` compiles the PDF in Docker, so you do not need a local TeX
installation. `make check` prints a report like this (the first line shows the status, then
one line per check, then the problems):

```text
overfull paper.pdf  WARN
  ✓ build          Build succeeded (paper.pdf, 8 pages)
  ! output         1 × overfull-box
  ✓ references     12 of 12 references verified
  ✓ accessibility  Tagged, PDF/UA valid (veraPDF)
  ✓ venue          profile paper, 8 pages (limit 8)

  ! sections/method.tex:31  Text sticks 14.2pt into the margin (lines 31–33)  overfull-box
```

Already have a project? Run `overfull check` in its folder after a build.
See [Configuration](./config.md) to point it at your files.

## Next steps

- [Install](./install.md): Docker, a clone, the release download, Dev Container, Overleaf.
- [Checks](./checks.md): what each check does and what it cannot detect.
- [References](./references.md): how verification works.
- [Accessibility](./accessibility.md): tagged PDFs and why they now matter.
