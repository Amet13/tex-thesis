<div align="center">

# overfull ▮

**Write your paper with any AI agent, or by hand. Ship one that checks out.**

[Website](https://amet13.github.io/overfull/) ·
[Docs](https://amet13.github.io/overfull/docs/) ·
[Browser check](https://amet13.github.io/overfull/check/) ·
[Rules](https://amet13.github.io/overfull/rules/)

[![ci](https://github.com/amet13/overfull/actions/workflows/ci.yml/badge.svg)](https://github.com/amet13/overfull/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)
[![Templates: MIT-0](https://img.shields.io/badge/templates-MIT--0-black.svg)](templates/thesis/LICENSE)

</div>

Overfull is a free preflight kit for LaTeX papers and theses. It gives AI
coding agents (Claude Code, Codex, Cursor, Copilot, Gemini CLI) the templates,
rules and tools they need to produce a correct paper, and gives you a clear way
to check the result. If you write LaTeX yourself, you get the same templates and
the same checks, with no AI involved.

*Formerly **tex-thesis**. The name comes from LaTeX's `Overfull \hbox` warning
and the black box draft mode draws past the margin.*

## Why

In 2026 most LaTeX gets written with AI help, inside Overleaf, OpenAI Prism or a
coding agent. Agents write fluent LaTeX. They do not know whether a reference
exists, what the PDF looks like, or what your thesis office requires. Overfull
checks exactly those things:

| Check | Catches |
| ------- | --------- |
| **build** | TeX errors, grouped by root cause, explained in plain language |
| **output** | `??` references, `[?]` citations, stale bibliography, text in the margin |
| **references** | citations that don't exist (CrossRef, doi.org, DBLP, arXiv) or have wrong metadata |
| **accessibility** | untagged PDFs, missing alt text, language, title, fonts; veraPDF PDF/UA |
| **venue** | page limits, paper size, double-blind anonymity, AI-use disclosure, arXiv rules |

It never writes research content. It never calls a reference "fake": results are
verified, metadata differs, not found, or can't be checked automatically.

## Start

### With an agent

```bash
npx overfull init paper my-paper
cd my-paper
# open the folder in your coding agent and ask it to work on the paper
```

The template ships `AGENTS.md` and skills in `.agents/skills/` (linked from
`.claude/skills/`). Your agent will:

1. add references only through `overfull cite <doi | arXiv id | "title">`, which fetches real metadata;
2. run `overfull check --json` after every change and fix what it reports;
3. open a pull request where you review a PDF with the changes highlighted.

### By hand

```bash
npx overfull init thesis my-thesis   # or click "Use this template" on a template repo
cd my-thesis
make build    # compiles in Docker; nothing to install but Docker
make check    # the same preflight, in plain language
```

Prefer not to install Node? Every command also runs from the Docker image:

```bash
docker run --rm -v "$PWD:/work" -w /work ghcr.io/amet13/overfull:0.1 overfull check
```

### In CI

```yaml
- uses: amet13/overfull@v1
  with:
    checks: build,output,references,accessibility,venue
```

The Action reads the log, PDF and `.bib` your workflow already produces, then
annotates pull requests and writes a summary. Each template also includes a
workflow that builds in Docker, runs veraPDF and attaches a highlighted-changes
PDF to every pull request.

## Templates

| Template | For | Accessible by default |
| ---------- | ----- | ----------------------- |
| [`thesis`](templates/thesis) | bachelor's, master's, PhD theses (A4, 14pt, 1.5 spacing) | yes, tagged PDF/UA-2 |
| [`paper`](templates/paper) | research papers and preprints | yes, tagged PDF/UA-2 |
| [`slides`](templates/slides) | defense and conference talks (Beamer) | see template README |

All templates use LuaLaTeX, biblatex and TeX Live 2026, keep figures
reproducible from data in `figures/data/`, and are licensed MIT-0: copy them,
owe nothing.

## Commands

```text
overfull init [thesis|paper|slides] [dir]   start from a template
overfull build                              compile (local TeX or Docker)
overfull check [--json|--markdown]          run the preflight
overfull cite <doi | arXiv:id | "title">    add a real reference to the .bib
overfull pages <range>                      render pages to PNG (for you or an agent)
overfull diff [--base ref]                  PDF with changes highlighted
overfull explain <rule>                     what a rule means and how to fix it
overfull doctor                             check your setup
```

## Repository

```text
packages/core    browser-safe checks (log, references, PDF, venue, reports)
packages/cli     the overfull command and the API the Action uses
action.yml       GitHub Action
templates/       thesis, paper, slides
skills/          Agent Skills shared by every template
corpus/          failing LaTeX documents that prove each log rule on TeX Live 2026
docker/          the image: TeX Live 2026, fonts, poppler, veraPDF, latexdiff, Node, overfull
site/            website and browser check (GitHub Pages)
evals/           agent tasks scored by preflight
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[CONTRIBUTING.md](CONTRIBUTING.md). Coming from the old template? Read
[migrating from tex-thesis](docs/guide/migrate-from-tex-thesis.md).

## License

Code: [MIT](LICENSE). Templates, skills and agent instructions: MIT-0.
