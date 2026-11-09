---
title: Install
description: Run Overfull with only Docker or a single-file download from GitHub Releases, from a clone, in a VS Code Dev Container, or alongside Overleaf through Git.
order: 2
section: Start
---

Overfull 3.0.0 is not on npm and needs no Node.js install. Pick one. All of
them run the same checks.

| You have | Use |
| --- | --- |
| Docker only | The Docker image and the template Makefile |
| No Docker, no Node | The single-file `overfull` download from GitHub Releases; builds then need a local TeX Live |
| Git, Node.js 22.12+, pnpm and Docker | [From a clone](#from-a-clone), to work on Overfull itself |
| VS Code + Docker | The Dev Container |
| Overleaf | Git sync to a local or GitHub copy |

## From a clone

```sh
git clone https://github.com/amet13/overfull.git
cd overfull
pnpm install && pnpm build
make image IMAGE=overfull:dev      # builds the Docker image locally (9–10 GB on disk)
```

`node packages/cli/dist/bin.js` is the `overfull` command. Make it short with an
alias, and point builds at your local image:

```sh
alias overfull="node $PWD/packages/cli/dist/bin.js"
export OVERFULL_IMAGE=overfull:dev
overfull doctor                    # what is installed, what is missing
overfull init paper ../my-paper
```

In a project made from a template, pass the image to `make`:

```sh
cd ../my-paper
make build IMAGE=overfull:dev
make check IMAGE=overfull:dev
```

## Docker only

The image `ghcr.io/amet13/overfull:3` contains TeX Live 2026, fonts, poppler,
qpdf, veraPDF, latexdiff, Node.js and the `overfull` CLI. You do not need to
install TeX or Node.

> **New to Docker?** Install [Docker Desktop](https://docs.docker.com/desktop/)
> (macOS, Windows) or [Docker Engine](https://docs.docker.com/engine/install/)
> (Linux) and start it. The first build downloads the Overfull image: about
> 3 GB compressed, 9–10 GB on disk, so allow a few minutes and the disk space.
> After that, builds take seconds.

In a project made from an Overfull template, the Makefile uses the image for
you:

```sh
make build     # compile the PDF in Docker
make check     # run all checks
make help      # list every target
```

To run the CLI directly in the image, mount your project:

```sh
docker run --rm -v "$PWD":/work -w /work ghcr.io/amet13/overfull:3 overfull check
```

The image tag matches the Overfull major version. The template pins it in
`overfull.yml` under `build.image`.

## Release download

Each release includes a single-file `overfull` download on
[GitHub Releases](https://github.com/amet13/overfull/releases). Put it on your
`PATH` and run `overfull doctor`. There is no npm package, so `npx overfull` and
`npm install` do not work.

`overfull build` uses a local `latexmk` if one is installed and falls back to
Docker otherwise. Force one with `--engine local` or `--engine docker`.

Reference lookups go to CrossRef, doi.org, arXiv, DBLP and, if the
`OPENALEX_API_KEY` environment variable is set, OpenAlex. They need network
access. Use `overfull check --offline` to skip them.

## Dev Container and VS Code

The templates include a Dev Container configuration that uses the Overfull image.
To use an image you built from a clone instead, set `"image"` in
`.devcontainer/devcontainer.json` to it (`overfull:dev`).

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

It reports the Node.js and Overfull versions, whether `latexmk`, LuaLaTeX, Biber,
poppler, veraPDF, latexdiff, Git and Docker are available, whether the Docker
image is pulled, whether CrossRef is reachable, whether `overfull.yml` is valid,
and what each missing tool disables. It exits with 1 when nothing can build the
document (no local TeX Live and no usable Docker image). `overfull doctor --json`
prints the same as JSON.
