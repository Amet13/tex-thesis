# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/) and this project follows [Semantic Versioning](https://semver.org/) for template releases.

## [Unreleased]

## [v0.1.0] - Overfull

tex-thesis becomes **Overfull**, a preflight kit for LaTeX papers and theses
that works with AI coding agents and by hand. Version numbering restarts at
0.1.0 for the new project; the last tex-thesis release was v2.4.1.

### Added

- `overfull` CLI: `init`, `build`, `check`, `cite`, `pages`, `diff`, `explain`, `doctor`.
- `@overfull/core`: browser-safe checks for build logs, output problems,
  reference verification (CrossRef, doi.org, DBLP, arXiv, optional OpenAlex),
  PDF accessibility (tagging, alt text, language, title, fonts, veraPDF) and
  venue rules (page limits, anonymity, AI-use disclosure, arXiv).
- GitHub Action (`uses: amet13/overfull@v1`) with annotations and job summaries.
- Templates: `thesis` (the former tex-thesis, rebuilt as a tagged, accessible
  PDF), `paper` and `slides`, each with `AGENTS.md`, Agent Skills and a CI workflow.
- Agent Skills: add-citation, fix-build, add-figure, make-accessible,
  fit-page-limit, prepare-arxiv, write-disclosure, review-changes, start-paper,
  respond-to-reviewers.
- Corpus of failing LaTeX documents that CI recompiles on TeX Live 2026.
- Website with docs, a rule reference and a browser-only check.
- Docker image `ghcr.io/amet13/overfull` with TeX Live 2026, poppler, veraPDF,
  latexdiff and the CLI.
- Evals harness that scores agents with and without the kit.

### Changed

- Licenses: code is MIT; templates, skills and agent instructions are MIT-0
  (previously GPL-3.0 and CC BY-SA 4.0).
- The thesis template moved to `templates/thesis` and dropped packages that
  break PDF tagging.

### Removed

- The deleted `.devcontainer` references and the old single-template build.

## [v2.4.1] - 2026-04-12

### Changed

- Update all GitHub Actions to Node.js 24-compatible versions (`actions/cache` v4.3.0, `actions/attest-build-provenance` v2.4.0, `softprops/action-gh-release` v2.6.2, `github/codeql-action` v3.35.1, `docker/build-push-action` v7.1.0, `actions/upload-artifact` v7.0.1, `ossf/scorecard-action` v2.4.3)
- Pin pre-commit pip dependencies by SHA256 hash via `.devcontainer/requirements.txt` to satisfy OpenSSF Scorecard Pinned-Dependencies check
- Cross-platform `make open` / `make open-slides` support for Windows (Git Bash / MSYS2 / Cygwin)
- Graceful color output degradation in Makefile for environments without `tput`
- Use portable `awk` instead of `sed` append in `make release` target for macOS compatibility
- Fix trailing newline in `LICENSE-CC-BY-SA` for `end-of-file-fixer` pre-commit hook

### Security

- Enable branch protection ruleset on `main` with required PRs and status checks
- Enable GitHub secret scanning and push protection
- Enable Dependabot vulnerability alerts and automated security fixes
- Enable private vulnerability reporting

## [v2.4.0] - 2026-04-12

### Added
- README redesign with PDF screenshots, badge rows, comparison table, "Who is this for?" section, and star history graph
- `SECURITY.md` with vulnerability reporting policy and supply-chain hardening documentation
- Dual licensing: `LICENSE` pointer file, `LICENSE-GPL` (GPLv3), `LICENSE-CC-BY-SA` (CC BY-SA 4.0)
- `CITATION.cff` for GitHub "Cite this repository" button
- `.github/release.yml` for auto-categorized release notes
- `.github/workflows/scorecard.yml` for weekly OpenSSF Scorecard security analysis
- `scripts/validate-pdf.sh` for PDF structural validation in CI
- PDF validation test job in CI pipeline with build summary
- OIDC build attestation for release artifacts via Sigstore
- `make check` meta-target combining lint and format check
- `make release VERSION=x.y.z` for automated version bumping across `CITATION.cff` and `CHANGELOG.md`
- `SOURCE_DATE_EPOCH` support for reproducible PDF builds

### Changed
- Consolidated two Dockerfiles into single multi-stage Dockerfile (base, devcontainer, lint, builder, scratch)
- Updated `.devcontainer/devcontainer.json` to reference root Dockerfile with `target: devcontainer`
- Pinned pre-commit and all pip dependencies by SHA256 hash in `.devcontainer/requirements.txt`
- Parallelized pre-commit and lint CI jobs for faster pipeline
- Added apt package caching in CI with `actions/cache`
- Updated all GitHub Actions to latest Node.js 24-compatible versions
- Cross-platform `make open` / `make open-slides` support (macOS, Linux, Windows Git Bash)
- Graceful color output degradation in Makefile for environments without `tput`
- Updated `CONTRIBUTING.md` with dual license references

### Removed
- Separate `.devcontainer/Dockerfile` (consolidated into root Dockerfile)

## [v2.3.0] - 2026-03-04

### Added
- `latexindent` support via `.latexindent.yaml` and pre-commit hook
- New `make` targets: `build-thesis`, `build-slides`, `watch-thesis`, `watch-slides`, `fmt`, `fmt-check`
- New cleanup target: `clean-all` (includes Docker artifact cleanup)
- Governance update: `.github/CODEOWNERS`
- Enhanced issue/PR templates for reproducible reports and reviews

### Changed
- Pinned Docker base image by digest in project and devcontainer Dockerfiles
- Pinned GitHub Actions workflow dependencies to commit SHAs
- Expanded Dependabot config to update pinned Docker/Actions/pre-commit refs
- CI hardened with explicit permissions, concurrency cancellation, and job timeouts
- Build and lint output made quieter while preserving failure visibility
- Font/math setup and slide metadata hardened for portability and reduced warning noise
- README and contributor docs refreshed and simplified

## [v2.2.0] - 2026-02-21

### Added
- Modernized LaTeX template and open-source project tooling baseline.

### Changed
- Optimized CI lint job to run natively instead of through Docker.
- Refreshed README and release-facing project documentation.

## [v2.1.0] - 2026-02-07

### Added
- Direct links to build artifacts for easier template consumption.

### Changed
- Migrated template workflow to LuaLaTeX.
- Clarified README content and linked to the legacy template line.
- Removed duplicated template/documentation content.

## [v2.0.0] - 2026-02-07

### Changed
- Introduced the v2 template refresh and structure improvements.
- Translated and reworked README content.
- Switched release workflow to use the default GitHub token.
- Stopped tracking generated PDFs in the repository.

## [1.1.1] - 2024-09-24

### Changed
- Updated font-related links and documentation references.
- Bumped release tooling and maintenance automation.

## [1.0.3] - 2022-05-25

### Added
- Buildx setup and multi-architecture build pipeline groundwork.

### Changed
- Iterated CI workflow structure and environment variable handling.
- Updated GitHub Actions runtime baseline to Ubuntu 22.04.
- Removed package publishing step constrained by GitHub limits.
- Fixed Docker mountpoint path handling.

## [1.0.2] - 2022-02-22

### Changed
- Switched release references from commit SHA pins to tags.
- Applied additional small release fixes.

## [1.0.1] - 2022-02-22

### Changed
- Aligned release naming with the tag name.

## [1.0.0] - 2022-02-22

### Added
- Initial public release of the thesis template repository.
- Core thesis structure, chapter scaffolding, and appendix baseline.

### Changed
- Iterative content, wording, and formatting refinements from initial development.
