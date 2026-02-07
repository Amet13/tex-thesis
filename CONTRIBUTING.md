# Contributing to tex-thesis

Thank you for your interest in improving this LaTeX thesis template!

## How to Contribute

1. **Fork** the repository and create a feature branch
2. Make your changes
3. **Lint** your LaTeX files locally: `chktex main.tex chapters/*.tex`
4. **Build** to verify compilation: `./build.sh build`
5. Open a **Pull Request** with a clear description of your changes

## What We're Looking For

- New LaTeX feature examples (TikZ diagrams, table styles, math environments)
- Package modernization and compatibility improvements
- Documentation improvements
- Bug fixes in compilation or formatting
- Docker build optimizations
- CI/CD pipeline improvements

## Guidelines

- Keep examples self-contained and well-commented with `% === EXAMPLE: ... ===` markers
- Use LuaLaTeX-compatible packages only
- Test that both thesis and slides compile without errors
- Follow the existing code style (4-space indentation for `.tex` files)
- Run `chktex` and address any warnings before submitting

## Reporting Issues

- Include the full error log from `latexmk`
- Specify your TeX Live version (`lualatex --version`)
- Mention whether you're building via Docker or locally

## License

By contributing, you agree that your contributions will be licensed under
[GNU GPLv3](LICENSE) (source code) and [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) (content and template).
