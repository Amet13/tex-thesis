# tex-thesis

[![Build](https://github.com/Amet13/tex-thesis/actions/workflows/actions.yml/badge.svg)](https://github.com/Amet13/tex-thesis/actions/workflows/actions.yml)
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
- Manual bibliography, automatic list of figures/tables, glossary with hyperlinks
- `bookmark` package for faster PDF bookmark generation
- Beamer defense slides with matching theme
- Multi-stage Docker build — only final PDFs are extracted, no intermediate artifacts
- Parallel compilation of thesis and slides in Docker
- `chktex` linting in CI for LaTeX code quality
- GitHub Actions CI/CD with Docker layer caching and automatic PDF release on tag push

## Quick Start

Prerequisites: [Docker](https://docs.docker.com/get-docker/).

```bash
git clone https://github.com/Amet13/tex-thesis.git
cd tex-thesis/
./build.sh build
```

Outputs:

- `thesis.pdf`
- `slides/slides.pdf`

Other commands: `./build.sh open` / `./build.sh open-slides` to view PDFs, `./build.sh clean` to remove them. Run `./build.sh help` for all options.

## Local Build (without Docker)

If you have TeX Live installed locally with LuaLaTeX:

```bash
# Install latexmk if not already available
# sudo apt install latexmk    # Debian/Ubuntu
# brew install latexmk         # macOS

# Build thesis
latexmk -jobname=thesis main.tex

# Build slides
cd slides && latexmk -jobname=slides main.tex
```

The `.latexmkrc` files configure the LuaLaTeX engine and options automatically.

## Adapting for Your Thesis

1. Edit `preamble.tex` to adjust formatting (margins, fonts, spacing, PDF metadata)
2. Replace content in `chapters/` directory with your chapters
3. Update `chapters/bibliography.tex` with your references
4. Place your images in `images/`
5. Modify `slides/slides.tex` for your defense slides
6. Update `slides/main.tex` with your name, title, and university

## Project Structure

```
main.tex            # Thesis entry point
preamble.tex        # All packages, fonts, and formatting
.latexmkrc          # LuaLaTeX build configuration
build.sh            # Build script (replaces Makefile)
Dockerfile          # Multi-stage Docker build
chapters/           # Chapter content files
  abstract.tex      # Abstract
  introduction.tex  # Introduction
  01-problem.tex    # Problem statement
  02-literature.tex # Literature review
  03-analysis.tex   # System analysis
  04-design.tex     # Design and methodology
  05-implementation.tex # Implementation
  06-experiments.tex    # Experimental research
  07-results.tex    # Results analysis
  conclusion.tex    # Conclusion
  glossary.tex      # Abbreviations and symbols
  bibliography.tex  # Bibliography
  appendix-a.tex    # Sample code listing
images/             # Figures and diagrams
slides/             # Beamer presentation
  main.tex          # Slides entry point
  slides.tex        # Slide content
  beamerthemeThesisSlides.sty  # Beamer theme
  .latexmkrc        # Slides build configuration
```

## Showcase

The template includes working examples of:

| Category | Examples |
|----------|----------|
| **Math** | Inline math, numbered equations, multi-line aligned equations, matrices, integrals, fractions, piecewise functions, Greek letters |
| **TikZ diagrams** | Architecture diagrams, flowcharts with decision diamonds, state machines, hierarchy trees, pie charts, bar charts, line plots, Gantt timelines, black-box diagrams |
| **Tables** | Basic tables, multirow/multicolumn cells, comparison matrices, performance benchmarks |
| **Images** | Single figure, two figures side by side, custom `\addimg` / `\addimghere` / `\addtwoimghere` commands |
| **Code listings** | Python, SQL, JSON, Dockerfile — with captions, labels, and line numbers |
| **Lists** | Itemize, enumerate, nested lists, description lists |
| **References** | Citations, cross-references to equations/figures/tables, hyperlinked glossary, footnotes |
| **Bibliography** | Manual `thebibliography` with 15 sample entries |
| **Slides** | Beamer presentation with tables, TikZ diagrams, formulas, and custom theme |

All examples are marked with `% === EXAMPLE: ... ===` comments in the source for easy discovery.

## Linting

The project uses [chktex](https://www.nongnu.org/chktex/) for LaTeX linting. Run locally:

```bash
chktex main.tex chapters/*.tex
chktex slides/main.tex slides/slides.tex
```

Linting configuration is in `.chktexrc`. CI runs linting automatically on every push and PR.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

- Source code: [GNU GPLv3](LICENSE)
- Content and template: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

---

> **Ищете оригинальную версию шаблона для магистерского диплома?** Смотрите [старую версию проекта (1.1.1)](https://github.com/Amet13/tex-thesis/tree/1.1.1).
