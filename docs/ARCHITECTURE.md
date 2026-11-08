# Overfull architecture

Overfull is a preflight kit for LaTeX papers and theses. It serves two kinds of
authors from one engine:

- **With an agent**: an AI coding agent (Claude Code, Codex, Cursor, Copilot…)
  works on a repo made from an Overfull template. `AGENTS.md` and skills in
  `.agents/skills/` tell it how to build, cite and verify. Deterministic tools
  supply what a model cannot know: whether a reference exists, what the PDF
  contains, what the venue requires.
- **The classic way**: a person writes the LaTeX. `make build` and `make check`
  run the same tools with plain-language output.

Product principle: **verification beats generation**. Overfull never writes
research content. Every tool adds information the author or the agent does not
have.

## Repository layout

```text
packages/core/      @overfull/core — browser-safe TypeScript. No Node APIs.
  src/types.ts      Problem / CheckResult / Report / RuleInfo (the contract)
  src/log/          build-log parser → build + output checks
  src/bib/          BibTeX/biblatex parser + serializer, cited-key extraction
  src/refs/         reference verification + lookup (CrossRef, doi.org, DBLP, arXiv, OpenAlex)
  src/pdf/          PDF facts → output + accessibility checks (pdf.js injected)
  src/venue/        venue profiles + checks (page limit, anonymity, disclosure, arXiv)
  src/report/       human, JSON, Markdown, GitHub annotation formatters
  src/rules.ts      registry of every RuleInfo (allRules())
packages/cli/       `overfull` — Node CLI and programmatic API used by the Action
action.yml + action/dist/   GitHub Action (node24, bundled)
corpus/             one folder per failing LaTeX document that proves a log rule
templates/          thesis, paper, slides — accessible by default, agent-ready
skills/             canonical Agent Skills (SKILL.md); synced into each template
docker/             TeX Live 2026 image + poppler + veraPDF + latexdiff + overfull
site/               Astro static site → GitHub Pages (docs, rules, browser check)
evals/              agent tasks scored by preflight
scripts/            corpus runner, template sync, misc
```

## Tooling (2026)

Node ≥22.12 (CI on 24), pnpm 12 workspaces, TypeScript 7, Vitest 5, Biome 2,
Astro 7, pdf.js 6. ESM only. Tests live in `packages/*/test/*.test.ts`.

## The result model

See `packages/core/src/types.ts`. Rules have stable kebab-case ids. Severity:

- `error` — the paper is wrong or will be rejected (?? in PDF, unknown reference, page limit).
- `warning` — likely problem, needs a human look (metadata differs, overfull box > 10pt).
- `info` — could not be checked automatically (unindexed reference), or advice.

Check status: `fail` if any error, `warn` if any warning, `pass` otherwise,
`skipped` with `skippedReason` when inputs are missing (no PDF, offline…).

## Module contracts

### log (`src/log/index.ts`)

```ts
parseLog(text: string): ParsedLog
analyzeLog(text: string, opts?: { root?: string; overfullThresholdPt?: number }):
  { build: CheckResult; output: CheckResult; parsed: ParsedLog }
logRules: RuleInfo[]
```

- `build` = TeX errors (`! …` lines), grouped by root cause; follow-on errors
  within 3 lines in the same file are folded into `related`.
- `output` = problems that reach the PDF: undefined citations/references,
  stale bibliography (rerun biber/bibtex), missing files/figures, overfull boxes
  above threshold (default 10pt → warning; 1–10pt ignored), duplicate labels,
  font-shape substitutions, "Label(s) may have changed".
- File attribution tracks the TeX file stack `(./file.tex … )` properly.
- Must handle LuaLaTeX, pdfLaTeX, XeLaTeX logs, `-file-line-error` style
  (`./file.tex:12: message`), and 79-column wrapped lines.

### bib (`src/bib/index.ts`)

```ts
parseBib(text: string): BibEntry[]   // { key, type, fields, line, raw }
formatBibEntry(e: BibEntry): string
citedKeys(auxOrBcf: string): string[]  // \citation{}, \abx@aux@cite{..}{key}, <bcf:citekey>
```

### refs (`src/refs/index.ts`)

```ts
type RefStatus = 'verified' | 'mismatch' | 'not-found' | 'unverifiable' | 'error';
verifyEntries(entries: BibEntry[], opts: RefsOptions): Promise<RefResult[]>
refsCheck(results: RefResult[]): CheckResult
lookup(query: string, opts: RefsOptions): Promise<LookupResult | null>  // DOI, arXiv id, or title
```

- `RefsOptions` = `{ fetch?, mailto?, openalexKey?, cache?, concurrency?, timeoutMs?, offline? }`.
  `fetch` defaults to `globalThis.fetch` (works in browsers and Node).
- Order: DOI → doi.org/CrossRef; arXiv id → arXiv API; otherwise title search
  on CrossRef, then DBLP, then OpenAlex (only if a key/mailto is configured).
- Never says "fake". `not-found` only for scholarly types (article,
  inproceedings, incollection, phdthesis…) when no candidate is similar.
  Websites, software, standards (RFCs), datasets → `unverifiable` (info).
- `mismatch`: found, but year/authors/title differ meaningfully (warning).
- Results are cacheable by a stable key (`doi:` / `arxiv:` / `title:` + normalized).
- Entries can opt out: `note = {overfull: skip}` or config `references.ignore`.

### pdf (`src/pdf/index.ts`)

```ts
extractPdfFacts(data: Uint8Array, pdfjs: PdfjsLike): Promise<PdfFacts>
pdfOutputProblems(facts): Problem[]      // "??" and "[?]" in text, with page
accessibilityCheck(facts, opts: { verapdf?: VeraPdfResult | null; level?: 'required' | 'recommended' | 'off' }): CheckResult
parseVeraPdfReport(xmlOrJson: string): VeraPdfResult
```

`PdfFacts`: pages, per-page text, info dict, XMP language/title, `tagged`
(MarkInfo), structure-tree figures with/without alt text, fonts (when
available), PDF/UA claim. pdf.js is injected so the same code runs in the
browser and in Node.

### venue (`src/venue/index.ts`)

```ts
builtinProfiles: Record<string, VenueProfile>   // generic, thesis, paper, arxiv, double-blind
resolveProfile(nameOrInline): VenueProfile
venueCheck(profile, ctx: VenueContext): CheckResult
```

`VenueContext` = `{ facts?, aux?, texFiles?: { path, content }[], log? }`.
Checks: page limit (optionally counted up to the page of `\label{overfull:main-end}`
from the .aux), paper size, anonymity (PDF Author metadata, `\author` content,
acknowledgments) for double-blind, AI-use disclosure presence when required,
arXiv rules (absolute paths, `.eps` with pdfLaTeX, `minted`/shell-escape,
`.bbl` presence when packaging).

### report (`src/report/index.ts`)

```ts
formatHuman(report, { color?: boolean; verbose?: boolean }): string
formatJson(report): string
formatMarkdown(report): string           // GitHub job summary / PR comment
githubAnnotations(report): string[]      // ::error file=…,line=…,title=…::message
```

## CLI (`overfull`)

```text
overfull init [thesis|paper|slides] [dir]   copy a template
overfull build [main.tex] [--engine auto|local|docker]
overfull check [--json|--markdown] [--checks a,b] [--profile p] [--offline] [--fail-on error|warning]
overfull cite <doi | arXiv:id | "title"> [--bib file] [--key k] [--dry-run]
overfull pages <range> [--pdf file] [--out dir] [--dpi n]
overfull diff [--base ref] [--main main.tex]
overfull explain <rule>
overfull doctor
```

Exit codes: 0 pass (or warn without `--fail-on warning`), 1 fail, 2 usage or
internal error. JSON output is the `Report` type, stable for agents.

Configuration lives in `overfull.yml` at the project root:

```yaml
main: main.tex
jobname: thesis           # output is thesis.pdf / thesis.log
bib: [references.bib]
profile: thesis           # built-in name, or inline fields below override it
checks: [build, output, references, accessibility, venue]
references:
  mailto: you@example.org # polite pool for CrossRef/OpenAlex
  ignore: [rfc9110]
venue:
  pageLimit: { max: 9, endLabel: overfull:main-end }
  anonymous: false
  disclosure: required
build:
  engine: auto            # local latexmk if present, else Docker
  image: ghcr.io/amet13/overfull:0.1
```

Cache: `.overfull/cache/refs.json` (git-ignored by templates).

## Docker image

`ghcr.io/amet13/overfull:<version>` — TeX Live 2026 (pinned digest), Microsoft
core fonts, poppler-utils, qpdf, veraPDF, latexdiff, Node 24 and the `overfull`
CLI. `overfull build --engine docker` and the template Makefiles use it, so the
classic path needs only Docker.

## GitHub Action

`uses: amet13/overfull@v1` runs `overfull check` on outputs an existing
workflow already produced (log, PDF, bib). It writes annotations, a job summary
and outputs `status` and `report`. Full builds, veraPDF and latexdiff run in the
Docker image via the template workflow.

## Templates

Each template is a standalone repo layout:

```text
main.tex  metadata.tex  overfull.yml  references.bib
sections/ (or chapters/)  figures/  notes/
AGENTS.md  CLAUDE.md (@AGENTS.md)  .agents/skills/  .claude/skills -> ../.agents/skills
Makefile  .github/workflows/paper.yml  LICENSE (MIT-0)
```

Accessible by default: `\DocumentMetadata{… tagging=on}`, LuaLaTeX, alt text on
every figure, document language and title set. CI requires the thesis and
paper templates to pass `overfull check` including veraPDF PDF/UA.
