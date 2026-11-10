# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/) and this project follows [Semantic Versioning](https://semver.org/) for template releases.

## [Unreleased]

## [v3.1.0] - Any project first

Overfull now starts from the paper you already have: one command checks any
LaTeX project, and templates become one way in among several.

### Added

- `overfull init --here` (alias `overfull adopt`) adds Overfull to an existing
  project: it detects the main file, engine, bibliography and backend, and the
  venue style file, and writes a commented `overfull.yml`. `--agents`, `--ci`,
  `--make`, `--hooks` (or `--all`) add agent files, a workflow, a Makefile and
  a git pre-commit hook. It never touches `.tex` or `.bib` files.
- `overfull guard`: `--staged` refuses commits that add bibliography entries
  that neither came from `overfull cite`, carry an author note, nor verify;
  `--hook` blocks direct `.bib` edits by Claude Code, Codex CLI and Gemini CLI.
  `.pre-commit-hooks.yaml` for the pre-commit framework.
- `overfull mcp`: a dependency-free Model Context Protocol server (stdio) with
  `check`, `cite`, `explain`, `pages` and `doctor`.
- Claude Code plugin and marketplace manifests: skills, the guard hook and the
  MCP server in one install. Gemini CLI extension (`gemini-extension.json`):
  skills and the MCP server.
- Venue profiles as data (`venues/*.yml`, each with its sources and check
  date): NeurIPS 2026, ICLR 2027, ICML 2026, CVPR 2027, AAAI-27, ACL Rolling
  Review, EMNLP 2026, Springer LNCS, IEEE conferences (IEEEtran) and ACM
  conferences (acmart sigconf). New rules `style-file-modified`,
  `layout-tampering`, `anonymity-link`, `venue-profile-stale`, and
  `text-outside-block` (text in the margin, measured on the PDF against the
  style file's text block).
- Reference sources: Semantic Scholar, ACL Anthology (ids and URLs), Europe
  PMC (PMID, PMCID), keyless OpenAlex when DBLP cannot be reached. New rules
  `reference-retracted`, `reference-published-version`, `reference-duplicate`,
  and `reference-uncited` (off by default, `references.reportUncited`).
- `overfull check` takes files as arguments, finds the main file without
  `overfull.yml`, says what it assumed, shows progress on a terminal, and has
  `--main`, `--refresh` and `--sarif`.
- Action: `sarif` input and output.
- `ghcr.io/amet13/overfull:<version>-check`: the CLI, veraPDF and poppler
  without TeX Live. `ghcr.io/amet13/overfull:<version>-medium`: TeX Live's
  medium scheme plus the collections the templates need; CI builds the
  templates in it.
- `overfull check --watch` checks again whenever the log, PDF, `.aux` or a
  `.bib` file changes.
- A native build for Intel Macs (`overfull-darwin-x64`). Each release
  attaches a Homebrew formula and a Scoop manifest generated from its
  checksums (`packaging/`).
- References: an entry that links to its OpenReview page and that no index
  has yet is "could not be checked", not "not found".
- Guide pages: How it compares (other reference checkers, from their own
  pages), How accurate is the reference check, Does it help agents; the last
  two render measured results once they are committed.
- A test checks that every `overfull` command quoted in the docs exists and
  uses real flags.
- `install.sh` and `install.ps1`, served from the website; they verify the
  download against `SHA256SUMS` and need no administrator rights.
- The browser check accepts a project `.zip` (such as Overleaf's source
  download) or a folder.
- `bench/refs/`: a reference-check benchmark (124 real, 90 fabricated
  entries), run monthly. `evals/`: 13 agent tasks with three variants. No
  measured results are published yet.

### Changed

- A reference source that times out or fails twice is skipped for the rest of
  the run; sources for one entry are asked at the same time. Cached records
  last 30 days, "not found" 1 day.
- Reference messages: wrong-work identifiers are counted separately; "could
  not be checked" is one sentence with one line per source.
- `page-limit-label-missing` is reported only when pages were counted.
- `overfull doctor` reports the CrossRef API as reachable instead of showing
  an HTTP status.
- `AGENTS.md` no longer assumes the template layout, and is shorter (1,477 to
  842 words) with every rule kept.
- Guide: existing project, CI and Overleaf come first; new pages on existing
  projects, MCP, accuracy and evals.

## [v3.0.0] - Overfull

tex-thesis becomes **Overfull**, a preflight kit for LaTeX papers and theses
that works with AI coding agents and by hand. The version continues the
tex-thesis numbering (last release v2.4.1) because the thesis template lives on
as `templates/thesis`.

### Added

- `overfull` CLI: `init`, `build`, `check`, `cite`, `pages`, `diff`,
  `explain`, `doctor`, all with `--json` for agents.
- Five checks in `@overfull/core` (browser-safe):
  - **build**: TeX errors grouped by root cause with plain-language fixes,
    proven by a 49-case corpus recompiled on TeX Live 2026.
  - **output**: `??`, `[?]`, stale bibliography, overfull boxes, floats past
    the main text.
  - **references**: verification against CrossRef, doi.org, DBLP, arXiv and
    OpenAlex. Outcomes are verified, mismatch, not found, unverifiable or
    lookup failed, never "fake".
  - **accessibility**: tagging, alt text (also from the source, for
    `\includegraphics` and `tikzpicture`), language, title, fonts, veraPDF
    PDF/UA.
  - **venue**: page limits, paper size, double-blind anonymity, AI-use
    disclosure (including placeholders), arXiv rules.
- `overfull cite` adds only real references; ambiguous titles list candidates
  instead of guessing; entries carry a tamper-evident `x-overfull` marker, and
  `references.requireCite` makes unproven references errors.
- GitHub Action (`uses: amet13/overfull@v3`) with annotations, job summary,
  outputs and workflow-command injection protection.
- Templates `thesis`, `paper` and `slides`: thesis and paper are tagged
  PDF/UA-2 and pass veraPDF; every template builds with zero warnings and
  ships `AGENTS.md`, ten Agent Skills, pointers for Claude Code, Codex,
  Cursor, Copilot and Gemini CLI, a Dev Container and a CI workflow.
- Docker image `ghcr.io/amet13/overfull:3` for linux/amd64 and linux/arm64
  (TeX Live 2026, poppler, veraPDF, latexdiff, Node 26, the CLI), with build
  provenance.
- Standalone CLI on every GitHub release: `overfull.cjs` (Node 26+) and native
  executables for Linux (x64, arm64), macOS (arm64) and Windows (x64), with
  checksums and provenance. Overfull is not published to npm.
- Website with docs, a rule reference built from the corpus, and a
  browser-only check.
- Evals harness that scores agents with and without the kit.

### Changed

- Licenses: code is MIT; templates, skills and agent instructions are MIT-0
  (previously GPL-3.0 and CC BY-SA 4.0).
- The thesis template moved to `templates/thesis` and was rebuilt for PDF
  tagging (kernel sectioning, table headers, MathML), with consistent sample
  data.

### Removed

- The old single-template build, root `.vscode` settings and the deleted
  `.devcontainer` references.

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
