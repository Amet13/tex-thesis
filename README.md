# tex-thesis

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

## Quick Start

Prerequisites: [Docker](https://docs.docker.com/get-docker/) and `make`.

```bash
git clone https://github.com/Amet13/tex-thesis.git
cd tex-thesis/
make build
```

Output: [`thesis.pdf`](thesis.pdf) and [`slides/slides.pdf`](slides/slides.pdf) — only the final PDFs are extracted from the Docker build (no intermediate artifacts).

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

## License

- Source code: [GNU GPLv3](LICENSE)
- Content and template: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

---

> **Ищете оригинальную версию шаблона для магистерского диплома?** Смотрите [версию 1.1.1](https://github.com/Amet13/tex-thesis/releases/tag/1.1.1).
