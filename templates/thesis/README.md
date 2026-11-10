# Thesis

An accessible LaTeX thesis made from the [Overfull](https://github.com/amet13/overfull)
thesis template: A4, 14 pt Times New Roman, 1.5 spacing, numbered centred
headings, IEEE references. It builds a tagged **PDF/UA-2** document (headings,
lists, tables, figures with alt text and formulas as MathML) with LuaLaTeX.

## Two ways to work

**With an AI agent.** Open the repository in Claude Code, Codex, Cursor or
Copilot. `AGENTS.md` and the skills in `.agents/skills/` tell the agent how to
build, cite and verify. Put your raw material (outlines, notes, results) in
`notes/` and ask it to draft from there; every claim it cannot source should
come back to you as a question.

**By hand.** Edit the `.tex` files and run the commands below. Only Docker is
required; a local TeX Live 2026 works too.

**New to Docker?** Install Docker Desktop (macOS, Windows) or Docker Engine
(Linux) and start it. The first build downloads the image, about 3 GB
compressed and 9–10 GB on disk, so allow a few minutes. After that, builds take
seconds.

## Commands

```sh
make build    # thesis.pdf (latexmk, LuaLaTeX + biber)
make watch    # rebuild on every save
make check    # checks: log, PDF, references, accessibility (veraPDF)
make pages PAGES=4-6   # render pages to PNG to look at them
make diff     # PDF showing changes against origin/main
make clean    # remove build files (keeps the PDF)
make help     # all targets
```

With the `overfull` CLI (a single-file download from GitHub Releases or the
Docker image) you can also run `overfull check`, `overfull cite 10.1145/2890784`
(adds a verified BibTeX entry) and `overfull explain <rule>` directly.

## References

`overfull.yml` sets `references.requireCite: true`. Entries added with
`overfull cite` carry a provenance marker. An entry you write yourself must
either verify against the indexes (CrossRef, doi.org, DBLP, arXiv) or carry
`note = {overfull: author-provided}`, your statement that it is real (agents
never add it); otherwise `make check` reports `reference-unproven`. If you do
not use agents, set `requireCite: false`.

## Layout

| Path | What it is |
| ------ | ------------ |
| `metadata.tex` | Title, author, keywords: used on the title page and in PDF metadata |
| `main.tex` | Document structure; first line declares PDF/UA-2 and tagging |
| `preamble/` | Style, split by topic (fonts, layout, headings, floats, references) |
| `chapters/` | One file per chapter |
| `figures/`, `figures/data/` | Images and the CSV data behind every plot |
| `notes/` | Raw material, never compiled |
| `references.bib` | Bibliography; see [References](#references) |
| `overfull.yml` | Preflight settings |

## Accessibility rules

- Every `\includegraphics` gets `alt={...}`; every `tikzpicture` gets `[alt={...}]`.
- Do not load `enumitem`, `caption`, `subcaption`, `listings`, `multirow` or
  `todonotes`: they break PDF tagging in TeX Live 2026. Use the kernel list
  keys, `verbatim` in a `codelisting` float, and `\multicolumn` instead.
- Keep `\label{overfull:main-end}` after the conclusion: page limits are
  counted up to it.

Licensed MIT-0: use it for your thesis without attribution.
