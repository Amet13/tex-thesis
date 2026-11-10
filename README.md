<div align="center">

# overfull ▮

**The check you run before you submit, on the paper you already have.**

[Website](https://amet13.github.io/overfull/) ·
[Guide](https://amet13.github.io/overfull/docs/) ·
[Browser check](https://amet13.github.io/overfull/check/) ·
[Rules](https://amet13.github.io/overfull/rules/)

[![ci](https://github.com/amet13/overfull/actions/workflows/ci.yml/badge.svg)](https://github.com/amet13/overfull/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/amet13/overfull?color=black)](https://github.com/amet13/overfull/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)
[![Templates: MIT-0](https://img.shields.io/badge/templates-MIT--0-black.svg)](templates/thesis/LICENSE)

</div>

Overfull checks a LaTeX paper or thesis before you send it anywhere. It answers
three questions in plain language, with the file and line:

- **Does every reference exist and match?** Each entry is looked up in
  CrossRef, doi.org, arXiv, DBLP, Semantic Scholar, the ACL Anthology, Europe
  PMC and OpenAlex. A DOI that points to another paper, a title no index knows,
  a retracted work: each is reported. Venues now desk-reject papers with
  invented references.
- **Does the PDF show what you meant?** `??` and `[?]`, a stale bibliography,
  text in the margin, missing fonts, untagged or inaccessible PDF.
- **Does it meet the venue's rules?** Page limit, paper size, anonymity,
  AI-use disclosure, the official style file left unmodified, arXiv's build
  rules. Profiles for NeurIPS, ICLR, ICML, CVPR, AAAI, ACL, EMNLP, IEEE and ACM
  conferences and Springer LNCS, each with its source and the date it was checked.

The checks are deterministic and need no AI. They work the same whether you
write by hand or with a coding agent. Overfull never writes research content and
never calls a reference "fake": an entry is verified, differs from its record,
was not found, or could not be checked.

## In one minute

```bash
curl -fsSL https://amet13.github.io/overfull/install.sh | sh   # Linux, macOS
cd my-paper
overfull check
```

On Windows: `irm https://amet13.github.io/overfull/install.ps1 | iex`. The
installer verifies the download against the release's `SHA256SUMS` and needs no
administrator rights. Other ways to install, including Docker and single-file
downloads: [Install](https://amet13.github.io/overfull/docs/install/).

`overfull check` finds the main file, reads the build log, the PDF and the
`.bib` files, and prints one line per problem. Build first with your usual
tools, or with `overfull build` (local TeX Live, or Docker if there is none).
`overfull init --here` saves what it found in `overfull.yml` and can add a CI
workflow, agent instructions and a pre-commit hook; it never touches your
`.tex` or `.bib` files. See
[Add Overfull to an existing project](https://amet13.github.io/overfull/docs/existing-project/).

## Where you work

**On every pull request.** The Action reads the log, PDF and `.bib` your
workflow already produces, annotates the changes and writes a summary. It can
also write SARIF for code scanning.

```yaml
- uses: amet13/overfull@v3
  with:
    checks: build,output,references,accessibility,venue
```

The check-only image `ghcr.io/amet13/overfull:3-check` has the CLI and veraPDF
without TeX Live; `ghcr.io/amet13/overfull:3` also builds. See
[GitHub Action](https://amet13.github.io/overfull/docs/action/).

**With an agent.** Claude Code, Codex, Cursor, Copilot and Gemini CLI read the
`AGENTS.md` and skills that `overfull init --here --agents` adds. The agent adds
references only through `overfull cite`, runs `overfull check --json` after each
change, and a hook stops it from editing `.bib` files by hand (Claude Code,
Codex CLI and Gemini CLI). In Claude Code, the plugin installs the skills, the hook and the
MCP server in one step:

```text
/plugin install overfull --marketplace Amet13/overfull
```

Agents without a shell can use `overfull mcp`. See
[Working with an agent](https://amet13.github.io/overfull/docs/with-an-agent/).

**On Overleaf.** Download the project source as a `.zip` and drop it on the
[browser check](https://amet13.github.io/overfull/check/): it runs in your
browser and uploads nothing. For every change, sync the project to GitHub and
use the Action. See
[Use with Overleaf](https://amet13.github.io/overfull/docs/migrate-from-overleaf/).

**Before a commit.** `overfull guard --staged` refuses a commit that adds a
bibliography entry that neither came from `overfull cite`, nor carries your own
note, nor verifies. It also works with the [pre-commit](https://pre-commit.com/)
framework (`id: overfull-guard`).

## How good is the reference check

The benchmark in `bench/refs/` runs the check over 124 real entries and 90
fabricated ones every month. No measured run has been published yet;
[How accurate is the reference check](https://amet13.github.io/overfull/docs/accuracy/)
describes the method and what the check cannot do.

## Templates

For a new document, start from a template that already passes every check:

```bash
overfull init paper my-paper     # or thesis, slides; or "Use this template" on GitHub
```

| Template | For | Accessible by default |
| ---------- | ----- | ----------------------- |
| [`thesis`](templates/thesis) | bachelor's, master's, PhD theses (A4, 14pt, 1.5 spacing) | yes, tagged PDF/UA-2 |
| [`paper`](templates/paper) | research papers and preprints | yes, tagged PDF/UA-2 |
| [`slides`](templates/slides) | defense and conference talks (Beamer) | no: Beamer slides cannot be tagged yet |

All use LuaLaTeX, biblatex and TeX Live 2026 (the paper template also builds
with pdfLaTeX for arXiv) and are licensed MIT-0. For a venue's own style, start
from the venue's author kit and run `overfull init --here` in it.

## Commands

```text
overfull check [files] [--json|--markdown|--sarif]   run the checks
overfull init --here [--all]                         add Overfull to this project
overfull init [thesis|paper|slides] [dir]            start from a template
overfull build [main.tex]                            compile (local TeX or Docker)
overfull cite <doi | arXiv:id | ACL id | PMID | "title">  add a verified reference
overfull guard --staged | --hook                     block hand-written .bib entries
overfull mcp                                         Model Context Protocol server
overfull pages <range>                               render pages to PNG
overfull diff [--base ref]                           PDF with changes highlighted
overfull explain <rule> | --list                     what a rule means and how to fix it
overfull doctor                                      check your setup
```

Every command takes `--help` and `--json`. Full reference:
[CLI](https://amet13.github.io/overfull/docs/cli/).

## Contributing

The repository is a pnpm monorepo: `packages/core` (browser-safe checks),
`packages/cli` (the command, the MCP server and the Action's API), `venues/`
(venue profiles as data), `templates/`, `skills/`, `corpus/` (failing LaTeX
documents that prove each log rule on TeX Live 2026), `bench/` and `evals/`,
`docker/` and `site/`. See [CONTRIBUTING.md](CONTRIBUTING.md) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Adding a venue is the most useful
contribution: [Adding a venue](CONTRIBUTING.md#adding-a-venue).

*Formerly **tex-thesis**. The name comes from LaTeX's `Overfull \hbox` warning.*

## License

Code: [MIT](LICENSE). Templates, skills and agent instructions: MIT-0.
