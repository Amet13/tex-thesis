# tex-thesis

> **Looking for the original Russian version?** See the [1.1.1 tag release](https://github.com/Amet13/tex-thesis/releases/tag/1.1.1).

[![Build](https://github.com/Amet13/tex-thesis/actions/workflows/actions.yml/badge.svg)](https://github.com/Amet13/tex-thesis/actions)
[![Source Code License](https://img.shields.io/badge/license-GNU_GPLv3-red.svg)](https://www.gnu.org/licenses/gpl-3.0.html)
[![Content License](https://img.shields.io/badge/license-CC_BY--SA_4.0-blue.svg)](https://creativecommons.org/licenses/by-sa/4.0/)

A universal LaTeX thesis template formatted with XeLaTeX.
Suitable for bachelor's, master's, or PhD theses at any university.
Features Times New Roman 14pt, 1.5 line spacing, structured chapters, TikZ diagrams, code listings, tables, bibliography, and Beamer defense slides.

## Features

- XeLaTeX with Times New Roman 14pt, 1.5 line spacing
- XITS Math font for formulas, FreeMono for code listings
- TikZ diagrams for architecture and system illustrations
- Figure and table captions in `section.number` format
- Configurable page margins (default 2.5 cm uniform)
- Page numbers centered at the bottom
- Standard bullet lists and numbered lists
- Section titles in uppercase (including table of contents)
- Custom commands for inserting figures (`\addimg`, `\addimghere`, `\addtwoimghere`)
- Custom commands for appendices (`\appsection`) and unnumbered sections (`\anonsection`)
- Source code listings with `listings` package
- Manual bibliography in `0-bibliography.tex`
- Automatic generation of list of figures and list of tables
- Abbreviations and symbols glossary with hyperlinks
- Beamer defense slides with matching theme
- `Makefile` for building the project
- Multi-stage `Dockerfile` — only final PDFs are extracted, no intermediate build artifacts
- GitHub Actions CI/CD pipeline with automatic PDF release on tag push

## Project Structure

```
.
├── Dockerfile            # Multi-stage Docker build (produces only PDFs)
├── Makefile              # Build automation (Docker-only)
├── main.tex              # Main document, includes all other files
├── preamble.tex          # LaTeX preamble (packages, formatting, custom commands)
├── images/               # Your illustrations (place images here)
├── inc/                  # Chapter/section files included in main.tex
│   ├── 0-abstract.tex    #   Abstract
│   ├── 0-intro.tex       #   Introduction
│   ├── 0-conclusion.tex  #   Conclusion
│   ├── 0-glossary.tex    #   Abbreviations and symbols
│   ├── 0-bibliography.tex#   Bibliography (manual)
│   ├── 1-problem.tex     #   Chapter 1: Problem statement
│   ├── 2-literature.tex  #   Chapter 2: Literature review
│   ├── 3-analysis.tex    #   Chapter 3: System analysis
│   ├── 4-design.tex      #   Chapter 4: Design and methodology
│   ├── 5-implementation.tex # Chapter 5: Implementation
│   ├── 6-experiments.tex  #  Chapter 6: Experimental research
│   ├── 7-results.tex     #   Chapter 7: Results analysis
│   └── a-appendix.tex    #   Appendices
└── slides/               # Beamer defense slides
    ├── beamerthemeThesisSlides.sty # Slide theme
    ├── main.tex           # Slide preamble (title, author, university)
    └── slides.tex          # Slide content
```

## Quick Start

Prerequisites: [Docker](https://docs.docker.com/get-docker/) and `make`.

```bash
git clone https://github.com/Amet13/tex-thesis.git
cd tex-thesis/
make build
```

Output: `thesis.pdf` and `slides/slides.pdf` — only the final PDFs are extracted from the Docker build (no intermediate artifacts).

## Make Targets

| Target             | Description                                  |
|--------------------|----------------------------------------------|
| `make build`       | Build thesis and slides via Docker (default) |
| `make open`        | Open thesis PDF (macOS / Linux)              |
| `make open-slides` | Open slides PDF (macOS / Linux)              |
| `make clean`       | Remove generated PDFs                        |

## Adapting for Your Thesis

1. Edit `preamble.tex` to adjust formatting (margins, fonts, spacing, PDF metadata)
2. Replace content in `inc/` directory with your chapters
3. Update `inc/0-bibliography.tex` with your references
4. Place your images in `images/`
5. Modify `slides/slides.tex` for your defense slides
6. Update `slides/main.tex` with your name, title, and university

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

- Source code: [GNU GPLv3](LICENSE)
- Content and template: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
