<div align="center">

# overfull ▮

**Write your paper with any AI agent, or by hand. Ship one that checks out.**

[Website](https://amet13.github.io/overfull/) ·
[Guide](https://amet13.github.io/overfull/docs/) ·
[Browser check](https://amet13.github.io/overfull/check/) ·
[Rules](https://amet13.github.io/overfull/rules/)

[![ci](https://github.com/amet13/overfull/actions/workflows/ci.yml/badge.svg)](https://github.com/amet13/overfull/actions/workflows/ci.yml)
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

> [!IMPORTANT]
> **Pre-release.** v3.0.0 is not released yet: there is no Docker image on
> ghcr.io, no release download and no `@v3` tag for the Action. Until then, run
> Overfull [from a clone](#start-today-from-a-clone). The
> [browser check](https://amet13.github.io/overfull/check/) works today.

## Why

Whether you write LaTeX by hand or with an AI agent, the same things go wrong
late: references that don't exist, `??` in the PDF, a page too many. Overfull
checks exactly those things:

| Check | Catches |
| ------- | --------- |
| **build** | TeX errors, grouped by root cause, explained in plain language |
| **output** | `??` references, `[?]` citations, stale bibliography, text in the margin |
| **references** | citations that don't exist (CrossRef, doi.org, DBLP, arXiv; OpenAlex with `OPENALEX_API_KEY`) or have wrong metadata |
| **accessibility** | untagged PDFs, missing alt text, language, title, fonts; veraPDF PDF/UA |
| **venue** | page limits, paper size, double-blind anonymity, AI-use disclosure, arXiv rules |

It never writes research content. It never calls a reference "fake": results are
verified, metadata differs, not found, or can't be checked automatically.

## Start today, from a clone

You need Git, Node.js 22.12+, pnpm and Docker. The first step builds a Docker
image with TeX Live (9–10 GB on disk; the released image is about a 3 GB
download), so allow a few minutes.

```bash
git clone https://github.com/amet13/overfull.git
cd overfull
pnpm install && pnpm build
make image IMAGE=overfull:dev                     # TeX Live 2026, veraPDF, the CLI
node packages/cli/dist/bin.js init paper ../my-paper

cd ../my-paper
make build IMAGE=overfull:dev                     # compile in Docker
make check IMAGE=overfull:dev                     # the checks, in plain language
```

To call the CLI directly, use `node <clone>/packages/cli/dist/bin.js` wherever
these docs say `overfull`, and set `OVERFULL_IMAGE=overfull:dev` so builds use
your local image.

## After v3.0.0

The release adds two ways in that need no clone:

- the Docker image `ghcr.io/amet13/overfull:3` (linux/amd64 and linux/arm64),
  which contains TeX Live, veraPDF and the `overfull` command, so Docker is all
  you install;
- a single-file `overfull` download from
  [GitHub Releases](https://github.com/amet13/overfull/releases): native
  executables `overfull-linux-x64`, `overfull-linux-arm64`,
  `overfull-darwin-arm64`, `overfull-win-x64.exe`, or `overfull.cjs` for any OS
  with Node.js 22.12+. There is no npm package.

```bash
curl -fLo overfull https://github.com/amet13/overfull/releases/latest/download/overfull-linux-x64
chmod +x overfull && sudo mv overfull /usr/local/bin/
gh attestation verify /usr/local/bin/overfull --repo amet13/overfull   # optional: check provenance
```

Each release also lists `SHA256SUMS` and the template PDFs.

```bash
overfull init paper my-paper     # or click "Use this template" on a template repo
cd my-paper
make build    # compiles in Docker; nothing to install but Docker
make check

# without installing the CLI at all:
docker run --rm -v "$PWD:/work" -w /work ghcr.io/amet13/overfull:3 overfull check
```

### With an agent

Open the project folder in your coding agent and ask it to work on the paper.
The template ships `AGENTS.md` and skills in `.agents/skills/` (linked from
`.claude/skills/`). Your agent will:

1. add references only through `overfull cite <doi | arXiv id | "title">`, which fetches real metadata;
2. run `overfull check --json` after every change and fix what it reports;
3. open a pull request where you review a PDF with the changes highlighted.

### By hand

Write LaTeX the way you always have. `make build` compiles in Docker and
`make check` prints the report. See the
[Guide](https://amet13.github.io/overfull/docs/by-hand/).

### In CI

After v3.0.0:

```yaml
- uses: amet13/overfull@v3
  with:
    checks: build,output,references,accessibility,venue
```

Until then, pin a commit instead of `@v3`
(`uses: amet13/overfull@<full 40-character commit SHA>`; short SHAs are rejected).
The Action reads the log, PDF and `.bib` your workflow already produces, then
annotates pull requests and writes a summary. Each template also includes a
workflow that builds in Docker, runs veraPDF and attaches a highlighted-changes
PDF to every pull request.

## Templates

| Template | For | Accessible by default |
| ---------- | ----- | ----------------------- |
| [`thesis`](templates/thesis) | bachelor's, master's, PhD theses (A4, 14pt, 1.5 spacing) | yes, tagged PDF/UA-2 |
| [`paper`](templates/paper) | research papers and preprints | yes, tagged PDF/UA-2 |
| [`slides`](templates/slides) | defense and conference talks (Beamer) | no: Beamer slides cannot be tagged yet |

All templates use LuaLaTeX, biblatex and TeX Live 2026 (the paper template also
builds with pdfLaTeX for arXiv, with `make arxiv`), keep figures
reproducible from data in `figures/data/`, and are licensed MIT-0: copy them,
owe nothing.

## Commands

```text
overfull init [thesis|paper|slides] [dir]   start from a template
overfull build [main.tex]                   compile (local TeX or Docker)
overfull check [--json|--markdown]          run the checks (also --checks, --profile,
                                            --offline, --fail-on, --annotations, --no-verapdf)
overfull cite <doi | arXiv:id | "title">    add a real reference to the .bib
                                            (--author, --year, --key, --dry-run, --json)
overfull pages <range>                      render pages to PNG (for you or an agent)
overfull diff [--base ref]                  PDF with changes highlighted
overfull explain <rule> | --list [--json]    what a rule means and how to fix it
overfull doctor [--json]                    check your setup
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
evals/           agent tasks scored by overfull check
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[CONTRIBUTING.md](CONTRIBUTING.md). Coming from the old template? Read
[migrating from tex-thesis](docs/guide/migrate-from-tex-thesis.md).

## License

Code: [MIT](LICENSE). Templates, skills and agent instructions: MIT-0.
