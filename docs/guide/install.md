---
title: Install
description: Run Overfull with only Docker, with npm and npx, in a VS Code Dev Container, or alongside Overleaf through Git.
order: 2
section: Start
---

Pick one. All of them run the same checks.

| You have | Use |
| --- | --- |
| Docker only | The Docker image and the template Makefile |
| Node.js 22.12+ | `npx overfull` (builds still use Docker unless TeX is installed) |
| VS Code + Docker | The Dev Container |
| Overleaf | Git sync to a local or GitHub copy |

## Docker only

The image `ghcr.io/amet13/overfull` contains TeX Live 2026, fonts, poppler,
qpdf, veraPDF, latexdiff, Node.js and the `overfull` CLI. You do not need to
install TeX or Node.

In a project made from an Overfull template, the Makefile uses the image for
you:

```sh
make build     # compile the PDF in Docker
make check     # run all checks
make help      # list every target
```

To run the CLI directly in the image, mount your project:

```sh
docker run --rm -v "$PWD":/work -w /work ghcr.io/amet13/overfull:0.1 overfull check
```

The image tag matches the Overfull version. The template pins it in
`overfull.yml` under `build.image`.

## npm

With Node.js 22.12 or newer:

```sh
npx overfull doctor            # what is installed, what is missing
npx overfull init paper my-paper
```

Or install it in a project:

```sh
npm install --save-dev overfull
npx overfull check
```

`overfull build` uses a local `latexmk` if one is installed and falls back to
Docker otherwise. Force one with `--engine local` or `--engine docker`.

Reference lookups go to CrossRef, doi.org, arXiv, DBLP and (if configured)
OpenAlex. They need network access. Use `--offline` to skip them.

## Dev Container and VS Code

The templates include a Dev Container configuration that uses the Overfull image.

1. Install [VS Code](https://code.visualstudio.com/), Docker, and the
   [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers).
2. Open the project folder and choose **Reopen in Container**.
3. Open `main.tex` and save. LaTeX Workshop builds the PDF in the container.
4. Run `make check` in the VS Code terminal.

GitHub Codespaces uses the same configuration, so you can work in a browser.

## Overleaf

You can keep writing in Overleaf and run Overfull on a Git copy of the project.
Overleaf's Git integration and GitHub sync are paid features; check Overleaf's
current plans. See [Migrate from Overleaf](./migrate-from-overleaf.md) for the
steps and for moving builds to GitHub Actions.

## Check the installation

```sh
overfull doctor
```

It reports the Overfull version, whether `latexmk`, LuaLaTeX, Biber, Docker,
veraPDF and latexdiff are available, and what each missing tool disables.
