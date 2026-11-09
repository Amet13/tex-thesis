# Paper

An accessible, venue-neutral research paper made from the
[Overfull](https://github.com/amet13/overfull) paper template: single column,
11 pt, A4 or US letter, biblatex. It builds a tagged **PDF/UA-2** document
with LuaLaTeX by default and also compiles with pdfLaTeX for arXiv.

## Two ways to work

**With an AI agent.** Open the repository in Claude Code, Codex, Cursor or
Copilot. `AGENTS.md` and the skills in `.agents/skills/` tell the agent how to
build, cite and verify. Keep your facts in `notes/`; the agent drafts from
them and asks you about anything it cannot source.

**By hand.** Edit the `.tex` files and run the commands below. Only Docker is
required; a local TeX Live 2026 works too.

Before Overfull v3.0.0 is released the image is not on ghcr.io yet: build it
from a clone of the Overfull repository with `make image IMAGE=overfull:dev`,
then pass `IMAGE=overfull:dev` to `make` here (`make build IMAGE=overfull:dev`).

## Commands

```sh
make build    # paper.pdf (latexmk, LuaLaTeX + biber)
make arxiv    # paper-arxiv.pdf with pdfLaTeX, as arXiv compiles it
make watch    # rebuild on every save
make check    # checks: log, PDF, references, page limit, AI disclosure, accessibility
make pages PAGES=1-2   # render pages to PNG
make diff     # PDF showing changes against origin/main
make clean    # remove build files (keeps the PDF)
make help     # all targets
```

## Submitting to arXiv

arXiv compiles with pdfLaTeX and does not run biber. Build with
`latexmk -pdf` (or `make arxiv`), then upload the `.tex` files, `figures/`
and the generated `.bbl` (rename `paper-arxiv.bbl` to `main.bbl`).

## Before you submit

- Set `venue.pageLimit.max` in `overfull.yml` to the venue's limit; the main
  text is counted up to `\label{overfull:main-end}`.
- Write the **Use of AI tools** section (`sections/ai-disclosure.tex`)
  yourself: which tools, for what, and that you checked the output. Only the
  author can make this statement; an agent may draft it from the repository
  history for you to edit.
- For double-blind review set `anonymous: true` and remove names from
  `metadata.tex`.
- Every figure needs alt text: `\includegraphics[alt={...}]`,
  `\begin{tikzpicture}[alt={...}]`.

Licensed MIT-0: use it without attribution.
