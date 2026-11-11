# Overfull architecture

Overfull checks a LaTeX paper or thesis before it is submitted: the build log,
the PDF, the references, accessibility and the venue's rules. It works on the
project an author already has; templates are one way in, not a requirement.

Product principles:

- **Verification, not generation.** Overfull never writes research content. Every
  check adds information the author or their coding agent does not have: whether a
  reference exists, what the PDF really contains, what the venue requires.
- **Deterministic and explainable.** No model decides anything. Every finding has a
  stable rule id, a file and line or page, and a fix (`overfull explain <rule>`).
- **Never "fake".** A reference is verified, differs from its record, is not found,
  or could not be checked. Absence is claimed only when enough indexes agree.

## Repository layout

```text
packages/core/     @overfull/core: browser-safe TypeScript, no Node APIs
  src/types.ts     Problem, CheckResult, Report, RuleInfo: the contract
  src/log/         build-log parser → build and output checks; .bbl attribution
  src/bib/         BibTeX/biblatex parser and writer, cited keys from .aux/.bcf
  src/refs/        reference verification and lookup, one module per source
  src/pdf/         PDF facts (pdf.js injected) → output and accessibility checks
  src/venue/       venue profiles and checks; venues.generated.ts comes from venues/*.yml
  src/report/      human, JSON, Markdown, SARIF and GitHub-annotation output
  src/rules.ts     every RuleInfo (allRules())
packages/cli/      the `overfull` command and the API the Action uses
  src/check.ts     runCheck: finds the inputs, runs the checks, builds the Report
  src/adopt.ts     `init --here`: detect a project, write overfull.yml and extras
  src/guard/       `guard --staged` (git pre-commit) and `guard --hook` (agent hooks)
  src/mcp/         `overfull mcp`: Model Context Protocol server on stdio, no dependencies
action/            the GitHub Action (action.yml at the root; action/dist is bundled)
venues/            venue profiles as data: one YAML file each, with sources and check date
corpus/            one failing LaTeX document per log rule, proven on TeX Live 2026
templates/         thesis, paper, slides: accessible by default, agent-ready
skills/, shared/   Agent Skills and AGENTS.md, synced into each template
docker/            the images (below)
site/              Astro site on GitHub Pages: guide, rules, browser check
bench/refs/        reference-check benchmark: real and fabricated entries, monthly run
evals/             agent tasks scored by Overfull itself (run by hand; they cost money)
packaging/         Homebrew formula and Scoop manifest, generated per release
scripts/           build, sync, release, maintenance and installer-test scripts
.claude-plugin/    Claude Code plugin and marketplace manifests
```

## Tooling

Node 26 LTS (the Action runs on Node 24, the newest Actions runtime), pnpm 12
workspaces, TypeScript 7, Vitest 5 with coverage floors, Biome 2, Astro 7,
pdf.js 6. ESM only. The site stays on TypeScript 6 because `@astrojs/check`
0.9.12 accepts only 5 or 6. Tests live in `packages/*/test/`, `site/tests/`,
`bench/refs/test/`, `evals/test/`, `scripts/test/` and `packaging/`.

## The result model

`packages/core/src/types.ts`. Rule ids are stable kebab-case.

- Severity `error`: the paper is wrong or will be rejected (`??` in the PDF, a
  reference not found, over the page limit). `warning`: needs a person's look
  (metadata differs, could not be checked). `info`: a note (not checkable
  automatically, advice).
- Check status: `fail` with any error, `warn` with any warning, `pass` otherwise,
  `skipped` with `skippedReason` when its inputs are missing.
- Report status: the worst check status. When every check was skipped, the report
  is `skipped` ("nothing checked"), never `pass`, and the exit code is 1.
- The same finding is never reported twice: a cited key with no `.bib` entry is
  `citation-key-missing` (references), not also `undefined-citation` (output)
  (`report/dedupe.ts`).

Exit codes: 0 pass (or warnings without `--fail-on warning`), 1 fail or nothing
checked, 2 usage or internal error. The JSON report is the `Report` type, stable
for agents and scripts.

## Checks

| Check | Reads | Finds |
| --- | --- | --- |
| build | the log | TeX errors grouped by cause, with file and line (`-file-line-error` and the file stack) |
| output | the log and PDF | `??` and `[?]`, undefined references, stale bibliography, missing files, overfull boxes over 10 pt, duplicate labels, font substitutions |
| references | the `.bib` files, `.aux`/`.bcf` | entries that do not exist, differ from their record, point at another work, are retracted, duplicated, or uncited; cited keys with no entry |
| accessibility | the PDF (veraPDF when available) and `.tex` | untagged PDF, missing language or title, figures without alt text, PDF/UA failures |
| venue | the PDF, `.aux`, `.tex`, style files | page limit (up to `\label{overfull:main-end}`), paper size, anonymity, AI-use disclosure, modified style file, layout tampering, text outside the text block, arXiv build rules |

Errors inside the typeset bibliography are moved from the `.bbl` line to the
`.bib` entry that caused them (`log/bibliography.ts`).

## References

`refs/verify.ts` decides; `refs/search.ts` asks the sources; `refs/http.ts` is the
polite client (first-byte 4 s and total 10 s timeouts, one retry on 429/5xx with
`Retry-After`, per-host spacing, and a circuit breaker: two failures, or one HTML
answer from a JSON API, take a host out for the run).

Order for one entry:

1. A DOI: doi.org (CSL), then the publisher's BibTeX for `cite`. An arXiv id: the
   arXiv API. An ACL Anthology id: the Anthology. A PMID or PMCID: Europe PMC. An
   identifier decides on its own.
2. Otherwise by title: CrossRef and dblp at the same time, then arXiv, then OpenAlex
   (always with `OPENALEX_API_KEY`; without a key, when dblp gave no answer), then
   Semantic Scholar and Europe PMC until three sources have answered.
3. `match.ts` compares title, authors and year: verified, mismatch (with the
   differing fields) or no match.

**Not found** needs a quorum (`notFoundQuorum`): CrossRef plus at least one more
general index (OpenAlex, Semantic Scholar or dblp) answered, and none has a similar
title. No single index is required, so one that is down or behind a bot wall does
not stop the check. With fewer answers the entry is `error` ("could not be
checked", a warning). When an index knows other works with the same title, the
entry is `unverifiable` ("could not tell"), because the right record may be lower
in a relevance-ranked list. Websites, software, datasets and standards are never
looked up by title.

Answers are cached in the user cache directory (30 days for a record, 1 day for
"no match"; failures never). `references.cache: project` keeps them in
`.overfull/cache/refs.json`, which CI ignores.

`overfull cite` uses the same lookup and writes the publisher's BibTeX when there
is a DOI. When an arXiv record names the DOI of its published version, it writes
that version and keeps the arXiv id. Every entry it writes carries an `x-overfull`
provenance field (source, date, hash over the identifying fields), which `guard`
checks.

The browser check asks only the sources that allow requests from web pages:
CrossRef, doi.org and OpenAlex.

## Command line

```text
overfull init --here [--agents] [--ci] [--make] [--hooks] [--all]   add Overfull to this project
overfull init [thesis|paper|slides] [dir]                           start from a template
overfull build [main.tex] [--engine auto|local|docker]              compile with latexmk, check the log
overfull check [files] [--json|--markdown|--sarif|--annotations] [--checks a,b]
               [--profile p] [--offline] [--refresh] [--fail-on error|warning|never] [--watch]
overfull cite <doi | arXiv:id | ACL id | PMID | PMCID | "title"> [--bib f] [--key k]
overfull guard --staged | --hook [claude|gemini|codex]              block hand-written .bib entries
overfull mcp                                                        MCP server: check, cite, explain, pages, doctor
overfull pages <range>                                              PDF pages to PNG
overfull diff [--base ref]                                          PDF with changes highlighted (latexdiff)
overfull explain <rule> | --list
overfull doctor
```

`adopt` is an alias of `init --here`. Without `overfull.yml`, `check` finds the
main file (`main.tex`, or the only `.tex` file with `\documentclass`) and says what
it assumed. `check` never runs code the project chooses: `build.image` is used by
`build` only.

Configuration (`overfull.yml`, written by `init --here`; every key optional):

```yaml
main: main.tex
jobname: thesis            # output is thesis.pdf / thesis.log
bib: [references.bib]
profile: neurips-2026      # a built-in profile or a venue id
checks: [build, output, references, accessibility, venue]
references:
  mailto: you@example.org  # CrossRef and OpenAlex polite pool
  ignore: [rfc9110]
  requireCite: true        # unverified entries need an overfull cite marker or an author note
  reportUncited: false
  cache: user              # or project
venue:                     # overrides on top of the profile
  pageLimit: { max: 9, endLabel: overfull:main-end }
  anonymous: true
  disclosure: required
build:
  engine: auto             # local latexmk if present, else Docker
  image: ghcr.io/amet13/overfull:3
```

API keys come from the environment only: `OPENALEX_API_KEY`,
`SEMANTIC_SCHOLAR_API_KEY`, `OVERFULL_MAILTO`.

## Venue profiles

Built in: `generic`, `thesis`, `paper`, `arxiv`, `double-blind`. Venues are data
in `venues/*.yml` (NeurIPS, ICLR, ICML, CVPR, AAAI, ACL Rolling Review, EMNLP,
IEEE and ACM conferences, Springer LNCS, …): each extends a built-in profile and
records its official `source` pages, `checkedOn` date and the SHA-256 of the
official style files. `scripts/build-venues.mjs` validates them and generates
`venues.generated.ts`. Rules are read from the official pages by a person;
automation only reports changes (see `MAINTAINING.md`).

## Delivery

- **Executables** for Linux, macOS and Windows: a Node.js single-executable
  application (`scripts/build-standalone.mjs --sea`), about 150 MB, almost all of
  it the Node runtime; a gzip copy (about 50 MB) ships next to each. `overfull.cjs`
  is the same program for an existing Node 26. `install.sh` and `install.ps1`
  check downloads against `SHA256SUMS`. Homebrew and Scoop files are generated
  per release. Releases carry build provenance.
- **Images** (`docker/Dockerfile`): `ghcr.io/amet13/overfull:3` (TeX Live 2026 at
  a pinned digest, fonts, poppler, qpdf, veraPDF, latexdiff, Node 26 and the CLI),
  `:3-check` (the same without TeX Live) and `:3-medium` (TeX Live's medium scheme
  plus what the templates need).
- **GitHub Action** (`uses: amet13/overfull@v3`): `overfull check` on what an
  earlier step built; annotations, job summary, optional SARIF, outputs `status`
  and `report`. Bundled to `action/dist` (Node 24).
- **Agents**: `AGENTS.md` and skills from `init --here --agents`, the Claude Code
  plugin (skills, guard hook, MCP server), the Gemini CLI extension, and
  `overfull mcp` for agents without a shell.
- **Browser check** on the website: the core package in the page; a project
  `.zip` or folder is checked without uploading anything.

## Templates

```text
main.tex  metadata.tex  overfull.yml  references.bib
sections/ (or chapters/)  figures/  notes/
AGENTS.md  CLAUDE.md  GEMINI.md  .agents/skills/  .claude/skills -> ../.agents/skills
Makefile  .github/workflows/paper.yml  .devcontainer/  LICENSE (MIT-0)
```

Accessible by default: `\DocumentMetadata{… tagging=on}`, LuaLaTeX, alt text on
every figure, document language and title set. CI builds every template in the
full and the medium image and requires them to pass their own `overfull check`,
veraPDF PDF/UA included (Beamer slides cannot be tagged yet).

## Automation

The repository maintains itself: Dependabot and `update-pins.yml` keep pinned
tools current, `regenerate.yml` rebuilds generated files, `automerge.yml` merges
labelled pull requests once every check passed, `autorelease.yml` proposes and
publishes releases, `bench.yml` measures the reference check monthly,
`sources-health.yml` probes every reference source weekly, `venues-watch.yml`
reports venue changes, and `watchdog.yml` opens an issue when any of them fails.
`MAINTAINING.md` has the schedule and what stays with a person.
