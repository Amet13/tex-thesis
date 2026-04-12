# Contributing to tex-thesis

Thank you for your interest in improving this LaTeX thesis template!

## How to Contribute

1. **Fork** the repository and create a feature branch
2. Make your changes
3. **Format** your LaTeX files: `make fmt`
4. **Lint** your LaTeX files: `make lint`
5. **Pre-commit**: We use `pre-commit` to ensure code quality. Install it with `pip install pre-commit` and run `pre-commit install` in the repository root.
6. **Build** to verify compilation: `make build`
7. Open a **Pull Request** with a clear description of your changes

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
- Run `make fmt-check` and `make lint` before submitting

## Versioning and Release Notes

- Add user-visible changes to [CHANGELOG.md](CHANGELOG.md) under `Unreleased`
- Follow semantic versioning expectations documented in [README.md](README.md)
- Include migration notes in PR descriptions for breaking changes

## Reporting Issues

- Include the full error log from `make build`
- Mention your Docker version (`docker --version`)

## License

By contributing, you agree that your contributions will be licensed under
[GNU GPLv3](LICENSE-GPL) (source code) and [CC BY-SA 4.0](LICENSE-CC-BY-SA) (content and template).
See [LICENSE](LICENSE) for details on what falls under each license.
