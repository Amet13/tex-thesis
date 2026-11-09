---
title: Migrate from tex-thesis
description: What changed when the tex-thesis template became Overfull, and how to move an existing thesis to the new thesis template or add Overfull checks to it.
order: 52
section: Project
---

Overfull is the new name of the `tex-thesis` repository. The thesis template is
still here, with the same LuaLaTeX, biblatex, pgfplots and Docker foundations.
Around it there is now a CLI that checks the build, references, accessibility
and venue rules, plus templates for papers and slides and instructions for AI
agents.

If your thesis builds today, nothing forces you to move. Your fork or copy keeps
working. Releases up to v2.4.1 stay available, and Overfull continues the
version line at v3.0.0.

Old links: GitHub redirects `github.com/amet13/tex-thesis` (the repository,
clones and issues) to `github.com/amet13/overfull`. The old GitHub Pages
address under `/tex-thesis/` does not redirect; the site now lives at
<https://amet13.github.io/overfull/>.

Until v3.0.0 is released, the `overfull` command and Docker image below come
from a clone; see [Install](./install.md#from-a-clone).

## What changed

| tex-thesis | Overfull |
| --- | --- |
| One repository: thesis plus `slides/` | Separate `thesis`, `paper` and `slides` templates, created with `overfull init` |
| `preamble.tex` holds packages, styling and PDF metadata | `main.tex` holds the preamble; title, authors and PDF metadata are in `metadata.tex` |
| `images/` | `figures/`, with plot data in `figures/data/` |
| No PDF tagging | `\DocumentMetadata{… tagging=on}`: tagged, accessible PDF by default |
| `make check` = `chktex` + `latexindent` check | `make check` = `overfull check` (build, output, references, accessibility, venue) |
| No reference checking | Every cited entry is looked up in CrossRef, doi.org, arXiv, DBLP (and OpenAlex with `OPENALEX_API_KEY`) |
| GPLv3 code, CC BY-SA content | Templates are MIT-0, so your thesis carries no licence obligations |
| (none) | `overfull.yml` project configuration |
| (none) | `AGENTS.md`, `CLAUDE.md` and skills for AI agents |
| (none) | `notes/` for your own notes |

## Option 1: add checks to your existing thesis

The quickest path. Keep your files and add Overfull on top.

1. Build as usual with `make build`. The PDF is `thesis.pdf`.
2. Create `overfull.yml` at the root:

   ```yaml
   main: main.tex
   jobname: thesis
   bib: [references.bib]
   profile: thesis
   checks: [build, output, references, accessibility, venue]
   ```

3. Run the checks:

   ```sh
   overfull check
   ```

   Or with Docker only:

   ```sh
   docker run --rm -v "$PWD":/work -w /work ghcr.io/amet13/overfull:3 overfull check
   ```

The accessibility check will fail, because the old template does not tag the
PDF. That is expected. Option 2 fixes it, or you can add `\DocumentMetadata` to
your `main.tex` yourself (see [Accessibility](./accessibility.md)).

## Option 2: move to the new thesis template

1. Create the new project next to the old one:

   ```sh
   overfull init thesis my-thesis
   ```

2. Copy your content:
   - `chapters/*.tex` into `my-thesis/chapters/`, and update the `\input`
     lines in `main.tex`;
   - `images/*` into `my-thesis/figures/`, and update `\includegraphics` paths;
   - `references.bib` as is.
3. Move title, author, supervisor and keywords into `metadata.tex`.
4. Compare your `preamble.tex` with the new `main.tex`. Carry over only what
   your university requires (font size, spacing, margins, heading styles). The
   old defaults were Times New Roman, 14pt and 1.5 line spacing.
5. Add alt text to every `\includegraphics` and plot. See
   [Accessibility](./accessibility.md#alt-text).
6. Build and check:

   ```sh
   cd my-thesis
   make build
   make check
   ```

7. Fix what the report shows. Packages you added yourself may need updates to
   work with tagging.
8. Slides: create them separately with `overfull init slides my-slides`.

## Linting and formatting

If you relied on `chktex`, `latexindent` and pre-commit, copy `.chktexrc`,
`.latexindent.yaml` and `.pre-commit-config.yaml` into the new project. They
work alongside Overfull.

## Questions

Open an issue on the repository if something from the old template has no
obvious place in the new one.
