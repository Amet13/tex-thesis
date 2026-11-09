<div align="center">

# overfull ▮

**Write your paper with any AI agent, or by hand. Ship one that checks out.**

[Website](https://amet13.github.io/overfull/) ·
[Guide](https://amet13.github.io/overfull/docs/) ·
[Browser check](https://amet13.github.io/overfull/check/) ·
[Rules](https://amet13.github.io/overfull/rules/)

[![ci](https://github.com/amet13/overfull/actions/workflows/ci.yml/badge.svg)](https://github.com/amet13/overfull/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/amet13/overfull?color=black)](https://github.com/amet13/overfull/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)
[![Templates: MIT-0](https://img.shields.io/badge/templates-MIT--0-black.svg)](templates/thesis/LICENSE)

</div>

Overfull is a free preflight kit for LaTeX papers and theses. It checks the
build, the PDF, the references, accessibility and venue rules, and tells you in
plain language what is wrong and where. It works the same whether you write
LaTeX yourself or with a coding agent (Claude Code, Codex, Cursor, Copilot,
Gemini CLI): the templates ship the instructions and skills an agent needs, and
the checks need no AI at all.

*Formerly **tex-thesis**. The name comes from LaTeX's `Overfull \hbox` warning
and the black box draft mode draws past the margin.*

## What it checks

Whether you write LaTeX by hand or with an AI agent, the same things go wrong
late: references that don't exist, `??` in the PDF, a page too many.

| Check | Catches |
| ------- | --------- |
| **build** | TeX errors, grouped by root cause, explained in plain language |
| **output** | `??` references, `[?]` citations, stale bibliography, text in the margin |
| **references** | citations that don't exist (CrossRef, doi.org, DBLP, arXiv; OpenAlex with `OPENALEX_API_KEY`) or have wrong metadata |
| **accessibility** | untagged PDFs, missing alt text, language, title, fonts; veraPDF PDF/UA |
| **venue** | page limits, paper size, double-blind anonymity, AI-use disclosure, arXiv rules |

It never writes research content. It never calls a reference "fake": results are
verified, metadata differs, not found, or can't be checked automatically.

## Install

Pick one. Building a document needs Docker (or a local TeX Live 2026); the first
build downloads the image, about 3 GB (9–10 GB on disk).

**Docker only.** The image `ghcr.io/amet13/overfull:3` (linux/amd64 and
linux/arm64) contains TeX Live, veraPDF and the `overfull` command:

```bash
docker run --rm -v "$PWD:/work" -w /work ghcr.io/amet13/overfull:3 overfull check
```

**Single file.** Download a native executable from
[GitHub Releases](https://github.com/amet13/overfull/releases/latest)
(`overfull-linux-x64`, `overfull-linux-arm64`, `overfull-darwin-arm64`,
`overfull-win-x64.exe`), or `overfull.cjs` for any OS with Node.js 22.12+.
Each release lists `SHA256SUMS` and build provenance. There is no npm package.

```bash
curl -fLo overfull https://github.com/amet13/overfull/releases/latest/download/overfull-linux-x64
chmod +x overfull && sudo mv overfull /usr/local/bin/
gh attestation verify /usr/local/bin/overfull --repo amet13/overfull   # optional
```

## Start

```bash
overfull init paper my-paper     # or thesis, slides; or "Use this template" on GitHub
cd my-paper
make build                       # compiles in Docker
make check                       # the report, in plain language
```

**With an agent.** Open the folder in your coding agent and ask it to work on
the paper. The template ships `AGENTS.md` and skills in `.agents/skills/`, so the
agent adds references only through `overfull cite`, runs `overfull check --json`
after every change, and opens a pull request where you review a PDF with the
changes highlighted. See [With an agent](https://amet13.github.io/overfull/docs/with-an-agent/).

**By hand.** Write LaTeX the way you always have; `make build` and `make check`
do the rest. See [By hand](https://amet13.github.io/overfull/docs/by-hand/).

**In CI.** The Action reads the log, PDF and `.bib` your workflow already
produces, annotates pull requests and writes a summary:

```yaml
- uses: amet13/overfull@v3
  with:
    checks: build,output,references,accessibility,venue
```

Each template also includes a workflow that builds in Docker, runs veraPDF and
attaches a highlighted-changes PDF to every pull request. See
[GitHub Action](https://amet13.github.io/overfull/docs/action/).

## Templates

| Template | For | Accessible by default |
| ---------- | ----- | ----------------------- |
| [`thesis`](templates/thesis) | bachelor's, master's, PhD theses (A4, 14pt, 1.5 spacing) | yes, tagged PDF/UA-2 |
| [`paper`](templates/paper) | research papers and preprints | yes, tagged PDF/UA-2 |
| [`slides`](templates/slides) | defense and conference talks (Beamer) | no: Beamer slides cannot be tagged yet |

All templates use LuaLaTeX, biblatex and TeX Live 2026 (the paper template also
builds with pdfLaTeX for arXiv, with `make arxiv`), keep figures reproducible
from data in `figures/data/`, and are licensed MIT-0: copy them, owe nothing.

## Commands

```text
overfull init [thesis|paper|slides] [dir]   start from a template
overfull build [main.tex]                   compile (local TeX or Docker)
overfull check [--json|--markdown]          run the checks
overfull cite <doi | arXiv:id | "title">    add a real reference to the .bib
overfull pages <range>                      render pages to PNG
overfull diff [--base ref]                  PDF with changes highlighted
overfull explain <rule> | --list            what a rule means and how to fix it
overfull doctor                             check your setup
```

Every command takes `--help` and `--json`. Full reference:
[CLI](https://amet13.github.io/overfull/docs/cli/).

## Contributing

The repository is a pnpm monorepo: `packages/core` (browser-safe checks),
`packages/cli` (the command and the Action's API), `templates/`, `skills/`,
`corpus/` (failing LaTeX documents that prove each log rule on TeX Live 2026),
`docker/`, `site/` and `evals/`. See [CONTRIBUTING.md](CONTRIBUTING.md) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Coming from the old template?
Read [migrating from tex-thesis](docs/guide/migrate-from-tex-thesis.md).

## License

Code: [MIT](LICENSE). Templates, skills and agent instructions: MIT-0.
