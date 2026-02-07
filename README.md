# tex-thesis

A universal LaTeX thesis template for bachelor's, master's, or PhD theses at any university.

Check the latest build: [thesis.pdf](https://github.com/Amet13/tex-thesis/releases/latest/download/thesis.pdf) | [slides.pdf](https://github.com/Amet13/tex-thesis/releases/latest/download/slides.pdf)

## Features

- XeLaTeX with Times New Roman 14pt, 1.5 line spacing, XITS Math for formulas, FreeMono for code
- TikZ diagrams, source code listings, figure/table captions in `section.number` format
- Configurable page margins, page numbers centered at the bottom, section titles in uppercase
- Custom commands: `\addimg`, `\addimghere`, `\addtwoimghere`, `\appsection`, `\anonsection`
- Manual bibliography, automatic list of figures/tables, glossary with hyperlinks
- Beamer defense slides with matching theme
- Multi-stage Docker build — only final PDFs are extracted, no intermediate artifacts
- GitHub Actions CI/CD with automatic PDF release on tag push

## Quick Start

Prerequisites: [Docker](https://docs.docker.com/get-docker/) and `make`.

```bash
git clone https://github.com/Amet13/tex-thesis.git
cd tex-thesis/
make build
```

Outputs:

- `thesis.pdf`
- `slides/slides.pdf`

Other commands: `make open` / `make open-slides` to view PDFs, `make clean` to remove them.

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

> **Ищете оригинальную версию шаблона для магистерского диплома?** Смотрите [старую версию проекта (1.1.1)](https://github.com/Amet13/tex-thesis/tree/1.1.1).
