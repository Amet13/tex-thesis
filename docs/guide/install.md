---
title: Install
description: Run Overfull with only Docker or a single-file download from GitHub Releases, in a VS Code Dev Container, alongside Overleaf through Git, or from source.
order: 2
section: Start
---

Overfull is not on npm and needs no Node.js install. Pick one. All of
them run the same checks.

| You have | Use |
| --- | --- |
| Docker only | The Docker image and the template Makefile |
| No Docker, no Node | The [one-line installer](#one-line-install) or the single-file download from GitHub Releases; builds then need a local TeX Live |
| Git, Node.js 26+, pnpm and Docker | [From source](#from-source), to work on Overfull itself |
| VS Code + Docker | The Dev Container |
| Overleaf | Git sync to a local or GitHub copy |

## Docker only

The image `ghcr.io/amet13/overfull:3` contains TeX Live 2026, fonts, poppler,
qpdf, veraPDF, latexdiff, Node.js and the `overfull` CLI. You do not need to
install TeX or Node.
`ghcr.io/amet13/overfull:3-medium` is a smaller variant on TeX Live's medium
scheme plus the collections the templates need; `:3-check` has no TeX Live and
only checks. See [the Docker README](https://github.com/amet13/overfull/blob/main/docker/README.md).

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

## One-line install

Installs the single-file `overfull` for your system, checks it against the
release's `SHA256SUMS`, and puts it in `~/.local/bin` (Windows:
`%LOCALAPPDATA%\overfull\bin`). No `sudo`, no Node.js. If the checksum does not
match, nothing is installed.

Linux (x64, arm64) and macOS (Apple silicon):

```sh
curl -fsSL https://amet13.github.io/overfull/install.sh | sh
```

Windows (x64), in PowerShell:

```powershell
irm https://amet13.github.io/overfull/install.ps1 | iex
```

The installer prints a `PATH` line if the directory is not on your `PATH`.
Set `OVERFULL_VERSION=v3.1.0` to install a specific release and
`OVERFULL_INSTALL_DIR` to install somewhere else. Native builds exist for Linux
(x64, arm64), macOS (Apple silicon and Intel) and Windows (x64); anywhere else,
use `overfull.cjs` with Node.js 26, or Docker.

To do it by hand, download your file from
[GitHub Releases](https://github.com/amet13/overfull/releases)
(`overfull-linux-x64`, `overfull-linux-arm64`, `overfull-darwin-arm64`, `overfull-darwin-x64`,
`overfull-win-x64.exe`), check it with `sha256sum -c --ignore-missing SHA256SUMS`,
rename it to `overfull`, and make it executable.

Each executable is about 150 MB, almost all of it the Node.js runtime it carries.
Since 3.2 every release also has a gzip copy (`overfull-linux-x64.gz` and so on,
about 50 MB, also listed in `SHA256SUMS`); the installers download that one and
check both the compressed file and the unpacked executable. By hand:
`gzip -d overfull-linux-x64.gz`.

## Release download

Each release includes a single-file `overfull` download on
[GitHub Releases](https://github.com/amet13/overfull/releases). Put it on your
`PATH` and run `overfull doctor`.

With Node.js 26 or newer you can also use the npm package, the same single-file
program (about 900 kB, no dependencies), when it is listed at
[npmjs.com/package/overfull](https://www.npmjs.com/package/overfull):
`npm install -g overfull`, or `npx overfull check` without installing.

`overfull build` uses a local `latexmk` if one is installed and falls back to
Docker otherwise. Force one with `--engine local` or `--engine docker`.

Reference lookups go to CrossRef, doi.org, arXiv, DBLP, OpenAlex, Semantic
Scholar, the ACL Anthology and Europe PMC (see
[References](./references.md)). They need network access. Use
`overfull check --offline` to skip them.

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
current plans. See [Use with Overleaf](./migrate-from-overleaf.md) for the
steps and for moving builds to GitHub Actions.

## From source

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
