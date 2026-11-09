# Overfull Docker image

`ghcr.io/amet13/overfull` is the one image needed to build and check an
Overfull project without installing TeX. Tags: `3` (what the templates use),
`3.0`, `3.0.0`, `edge` (main) and `sha-<commit>`; each is a multi-arch image
for linux/amd64 and linux/arm64 with a build provenance attestation
(`gh attestation verify oci://ghcr.io/amet13/overfull:3 --repo amet13/overfull`).
`docker run --rm ghcr.io/amet13/overfull:3 overfull --version` prints the CLI
version, which matches the image tag.

The image is about 3 GB to download (compressed) and takes 9–10 GB on disk.

## What is inside

| Component | Version / source |
| ----------- | ------------------ |
| TeX Live 2026 | `texlive/texlive:latest` pinned by digest (LuaHBTeX 1.24, biber, latexmk, latexdiff, chktex) |
| Fonts | Microsoft core fonts (Times New Roman, ...), GNU FreeFont, TeX Gyre |
| PDF tools | poppler-utils (`pdfinfo`, `pdffonts`, `pdftoppm`), qpdf, Ghostscript |
| veraPDF | 1.30.3 greenfield CLI: PDF/UA-1, PDF/UA-2, WTPDF and PDF/A profiles (`verapdf -f ua2 file.pdf`) |
| Node.js | 24 (official binary, checksum-verified) |
| `overfull` | the CLI from this repository (`packages/cli`), on `PATH` |
| git | for `overfull diff` (`/work` is marked as a safe directory) |

The working directory is `/work`.

## How templates use it

The template `Makefile`s run `overfull` when it is installed and otherwise:

```sh
docker run --rm -v "$PWD:/work" -w /work ghcr.io/amet13/overfull:3 overfull check
docker run --rm -v "$PWD:/work" -w /work ghcr.io/amet13/overfull:3 latexmk
```

`overfull build --engine docker` does the same. The template CI workflow
(`.github/workflows/paper.yml`) runs its job inside the image, and
`.devcontainer/devcontainer.json` opens VS Code in it.

## Build it

The build context is the repository root:

```sh
docker build -f docker/Dockerfile -t ghcr.io/amet13/overfull:dev .
docker build -f docker/Dockerfile --target tex -t overfull-tex:dev .   # TeX + veraPDF only, no CLI
```

Stages: `tex` (TeX Live, fonts, poppler, qpdf, veraPDF), `node` (+ Node 24),
`builder` (pnpm 12 builds the monorepo and deploys the CLI with production
dependencies), `overfull` (final, default target).

Behind a TLS-intercepting proxy, pass its CA certificate as a build secret;
it is trusted only during download steps and never stored in the image:

```sh
docker build --secret id=build_ca,src=/path/to/ca.crt -f docker/Dockerfile .
```

Template Makefiles accept another image: `make build IMAGE=overfull-tex:dev`.
