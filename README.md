# tex-thesis

[![Build](https://github.com/Amet13/tex-thesis/actions/workflows/actions.yml/badge.svg)](https://github.com/Amet13/tex-thesis/actions/workflows/actions.yml)
[![pre-commit](https://img.shields.io/badge/pre--commit-enabled-brightgreen?logo=pre-commit)](https://github.com/pre-commit/pre-commit)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![License: CC BY-SA 4.0](https://img.shields.io/badge/License-CC_BY--SA_4.0-lightgrey.svg)](https://creativecommons.org/licenses/by-sa/4.0/)

A universal LaTeX thesis template for bachelor's, master's, or PhD theses — with working examples of everything you might need.

Check the latest build: [thesis.pdf](https://github.com/Amet13/tex-thesis/releases/latest/download/thesis.pdf) | [slides.pdf](https://github.com/Amet13/tex-thesis/releases/latest/download/slides.pdf)

## Features

- **LuaLaTeX** engine — modern successor to XeLaTeX with full `microtype` support, Lua scripting, and active development
- Times New Roman 14pt, 1.5 line spacing (`setspace`), XITS Math for formulas, FreeMono for code
- Full microtypographic improvements via `microtype` (character protrusion + font expansion)
- Comprehensive examples of every common LaTeX feature (see [Showcase](#showcase))
- TikZ diagrams, source code listings, figure/table captions in `section.number` format
- Configurable page margins, page numbers centered at the bottom, section titles in uppercase
- Custom commands: `\addimg`, `\addimghere`, `\addtwoimghere`, `\appsection`, `\anonsection`
- Modern bibliography with `biblatex` and `biber`, automatic list of figures/tables, glossary with hyperlinks
- Smart cross-referencing with `cleveref`
- `bookmark` package for faster PDF bookmark generation
- Beamer defense slides with matching theme
- Multi-stage Docker build — only final PDFs are extracted, no intermediate artifacts
- Parallel compilation of thesis and slides in Docker
- `chktex` linting in CI for LaTeX code quality
- GitHub Actions CI/CD with Docker layer caching and automatic PDF release on tag push

## Quick Start

You can use this template locally with Docker, or instantly in your browser using GitHub Codespaces / VS Code Dev Containers.

### Using Dev Containers (Recommended)

1. Open this repository in VS Code.
2. When prompted, click **Reopen in Container** (requires the Dev Containers extension and Docker).
3. The environment will automatically install TeX Live, configure the LaTeX Workshop extension, and set up `pre-commit`.
4. Open `main.tex` and save it to trigger an automatic build.

### Using Docker Locally

Prerequisites: [Docker](https://docs.docker.com/get-docker/).

```bash
git clone https://github.com/Amet13/tex-thesis.git
cd tex-thesis/
make build
```

Outputs:

- `thesis.pdf`
- `slides/slides.pdf`

Other commands: `make watch` to rebuild automatically on file changes, `make lint` to lint, `make open` / `make open-slides` to view PDFs, `make clean` to remove them. Run `make help` for all options.

## Adapting for Your Thesis

1. Edit `preamble.tex` to adjust formatting (margins, fonts, spacing, PDF metadata)
2. Replace content in `chapters/` directory with your chapters
3. Update `references.bib` with your bibliography entries
4. Place your images in `images/`
5. Modify `slides/slides.tex` for your defense slides
6. Update `slides/main.tex` with your name, title, and university

## Showcase

The template includes working examples of:

| Category          | Examples                                                                                                                          |
|-------------------|-----------------------------------------------------------------------------------------------------------------------------------|
| **Math**          | Inline math, numbered equations, multi-line aligned equations, matrices, integrals, fractions, piecewise functions, Greek letters |
| **TikZ diagrams** | Architecture diagrams, flowcharts with decision diamonds, state machines, hierarchy trees, Gantt timelines, black-box diagrams    |
| **Plots**         | High-quality data visualization with `pgfplots` (bar charts, line plots)                                                          |
| **Tables**        | Professional tables with `booktabs`, number alignment with `siunitx`, multirow/multicolumn cells, comparison matrices             |
| **Images**        | Single figure, two figures side by side, custom `\addimg` / `\addimghere` / `\addtwoimghere` commands                             |
| **Code listings** | Python, SQL, JSON, Dockerfile — with captions, labels, and line numbers                                                           |
| **Lists**         | Itemize, enumerate, nested lists, description lists                                                                               |
| **References**    | Citations, smart cross-references (`\cref`) to equations/figures/tables, hyperlinked glossary, footnotes                          |
| **Bibliography**  | Modern `biblatex` with `biber` backend and 15 sample entries in `references.bib`                                                  |
| **Slides**        | Beamer presentation with tables, TikZ diagrams, formulas, and custom theme                                                        |

All examples are marked with `% === EXAMPLE: ... ===` comments in the source for easy discovery.

## Linting

The project uses [chktex](https://www.nongnu.org/chktex/) for LaTeX linting:

```bash
make lint
```

Linting configuration is in `.chktexrc`. CI runs linting automatically on every push and PR.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

> **Ищете оригинальную версию шаблона для магистерского диплома?** Смотрите [старую версию проекта (1.1.1)](https://github.com/Amet13/tex-thesis/tree/1.1.1).
