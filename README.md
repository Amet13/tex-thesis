<div align="center">
  <h1>🎓 tex-thesis</h1>
  <p><b>A universal, modern LaTeX thesis template for bachelor's, master's, or PhD theses.</b></p>

  [![Build Status](https://github.com/Amet13/tex-thesis/actions/workflows/actions.yml/badge.svg)](https://github.com/Amet13/tex-thesis/actions/workflows/actions.yml)
  [![pre-commit](https://img.shields.io/badge/pre--commit-enabled-brightgreen?logo=pre-commit)](https://github.com/pre-commit/pre-commit)
  [![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

  <br />

  [**📄 View Thesis PDF**](https://github.com/Amet13/tex-thesis/releases/latest/download/thesis.pdf) •
  [**📊 View Slides PDF**](https://github.com/Amet13/tex-thesis/releases/latest/download/slides.pdf) •
  [**💡 Report Issue**](https://github.com/Amet13/tex-thesis/issues)
</div>

---

## 🌟 Why this template?

Writing a thesis is hard enough without fighting LaTeX errors. This template provides a **production-ready, modern LaTeX environment** out of the box. It uses the latest packages (`LuaLaTeX`, `biblatex`, `pgfplots`, `cleveref`) and comes with a fully configured **Docker build system** and **VS Code Dev Container**.

You don't need to install a 4GB TeX Live distribution on your machine. Just open the project, write your content, and let the automation handle the rest.

## ✨ Features

- 🚀 **Modern Engine**: Uses `LuaLaTeX` for native UTF-8 support, system fonts, and advanced microtypography (`microtype`).
- 📐 **Professional Typography**: Times New Roman (14pt, 1.5 spacing), XITS Math for formulas, and FreeMono for code.
- 📊 **Data Visualization**: High-quality plots with `pgfplots` and programmatic diagrams with `TikZ`.
- 📚 **Smart Referencing**: Modern bibliography with `biblatex`/`biber` and intelligent cross-referencing with `cleveref`.
- 🛠️ **Developer Experience**: Zero-setup environment using **VS Code Dev Containers** and a fast multi-stage **Docker** build.
- 🧹 **Code Quality**: Built-in `chktex` linting and `pre-commit` hooks to keep your LaTeX source clean.
- 📽️ **Defense Ready**: Includes a matching Beamer presentation template for your final defense.

## 🚀 Quick Start

You can use this template instantly in your browser/editor, or locally with Docker.

### Option 1: VS Code Dev Containers (Recommended)

The easiest way to get started without installing LaTeX locally:

1. Install [VS Code](https://code.visualstudio.com/) and [Docker](https://docs.docker.com/get-docker/).
2. Install the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers).
3. Clone and open this repository in VS Code.
4. Click **Reopen in Container** when prompted.
5. Open `main.tex` and save it — the PDF will build automatically!

### Option 2: Local Docker Build

If you prefer using the terminal:

```bash
# 1. Clone the repository
git clone https://github.com/Amet13/tex-thesis.git
cd tex-thesis/

# 2. Build the PDFs (thesis.pdf and slides/slides.pdf)
make build

# 3. Watch for changes and rebuild automatically
make watch
```

**Available Commands:**
- `make build` — Build thesis and slides.
- `make watch` — Rebuild automatically on file changes.
- `make lint` — Run `chktex` linter.
- `make clean` — Remove generated PDFs and auxiliary files.

## 📂 Project Structure

```text
tex-thesis/
├── main.tex              # Main thesis document (includes chapters)
├── preamble.tex          # LaTeX packages, fonts, and styling config
├── references.bib        # Bibliography database (BibTeX)
├── chapters/             # Thesis content (Introduction, Literature, etc.)
├── images/               # Figures and diagrams
├── slides/               # Beamer presentation for defense
│   ├── main.tex          # Main slides document
│   └── slides.tex        # Slides content
├── Makefile              # Build automation commands
└── .devcontainer/        # VS Code container configuration
```

## 🛠️ Adapting for Your Thesis

1. **Configure**: Edit `preamble.tex` to adjust formatting (margins, fonts, spacing) and PDF metadata.
2. **Write**: Replace the `.tex` files in the `chapters/` directory with your own content.
3. **Cite**: Update `references.bib` with your bibliography entries.
4. **Present**: Modify `slides/main.tex` (author, title) and `slides/slides.tex` (content) for your defense.

## 🎨 Showcase

The template includes working examples of almost every LaTeX feature you might need. Look for the `% === EXAMPLE: ... ===` comments in the source code!

- **🧮 Math**: Inline math, numbered equations, aligned multi-line equations, matrices, integrals, piecewise functions.
- **📈 Plots & Diagrams**: Architecture diagrams, flowcharts, Gantt timelines, bar charts, and line plots (`pgfplots`).
- **📊 Tables**: Professional academic tables (`booktabs`), decimal alignment (`siunitx`), and multi-row cells.
- **💻 Code**: Syntax-highlighted listings for Python, SQL, JSON, and Dockerfiles (`listings`, `xcolor`).
- **🖼️ Images**: Single figures, side-by-side subfigures (`subcaption`), and custom image insertion commands.

## 🤝 Contributing

Contributions are welcome! Whether it's a new TikZ example, a bug fix, or a documentation improvement.

1. Fork the repository.
2. Make your changes.
3. Run `make pre-commit` and `make lint` to ensure code quality.
4. Open a Pull Request.

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

## 📜 License

- **Source Code**: [GNU GPLv3](LICENSE)

---

> **Ищете оригинальную версию шаблона для магистерского диплома?** Смотрите [старую версию проекта (1.1.1)](https://github.com/Amet13/tex-thesis/tree/1.1.1).
