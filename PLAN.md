# Overfull: plan for the next versions (3.1 to 3.4)

Written 2026-11-10, after v3.0.0 shipped, from a fresh audit of `main` at
`61cb8b8`. This file is a working document for the implementer. Delete it in the
last pull request of the plan (task Z1).

## 1. How to use this plan

You are implementing this plan one phase at a time. Each phase is one or more
pull requests against `main`. Phases are ordered by value; do them in order
unless the owner says otherwise. Every task has an id (A1, B3, ...), the files
it touches, the steps, and an acceptance test you can run.

Ground rules. They apply to every task:

1. **Read before you write.** Read `docs/ARCHITECTURE.md`, `CONTRIBUTING.md`
   and the files a task names before changing them. Where this plan and the
   code disagree, the code is right about what exists today; this plan is right
   about where it should go.
2. **Verify external facts at implementation time.** Venue rules, API
   endpoints, rate limits, plugin manifest formats and package versions change.
   Wherever a task says *verify first*, read the official source and write the
   URL and the date you read it into the code comment or data file. Never write
   a venue rule, an API field or a manifest key from memory. If you cannot
   confirm a fact, leave that item out and list it in the pull request.
3. **Keep the product principle.** Overfull verifies; it never writes research
   content and never calls a reference "fake". Checks are deterministic and
   need no AI. A new check that needs a language model is out of scope.
4. **Keep `packages/core` browser-safe.** No Node APIs there. Anything that
   touches the file system, processes or Docker goes in `packages/cli`.
5. **Every rule needs proof.** A new log rule needs a `corpus/` case built on
   the Docker image. Any other new rule needs a fixture and a unit test, an
   entry in the rule registry, an `explain` text, and a row on the site's rules
   page (the page is generated; check that it shows up).
6. **No breaking changes in 3.x.** JSON report fields, rule ids, exit codes,
   CLI flags and Action inputs only gain members. If a task seems to need a
   break, stop and ask the owner.
7. **Tests are never skipped or weakened to get green.** Run `pnpm check`
   (lint, typecheck, tests), `node scripts/sync-templates.mjs --check` and, for
   anything touching templates or the image, `scripts/e2e-templates.sh` before
   pushing. A live-network test must stay opt-in (`refs.live.test.ts` shows the
   pattern).
8. **Small pull requests.** One task, or a few closely related tasks, per pull
   request. Each updates `CHANGELOG.md` under an "Unreleased" heading and the
   docs page that describes the changed behaviour.
9. **Standing owner decisions.** Node.js 26 minimum. No npm package. pnpm,
   TypeScript, Vitest, Biome, Astro as today. Plain, specific wording in all
   user-facing text; no marketing adjectives. The site keeps its own visual
   language; do not restyle it with a generic component kit.
10. **Releases.** After each phase is merged and `main` is green, run
    `node scripts/bump-version.mjs <version>`, merge that, then the owner runs
    Actions → release → Run workflow with "publish". You cannot push tags.

## 2. What the audit found

### 2.1 What is good and must stay

- The engine is solid: 86 rules with stable ids, a 60-case corpus that proves
  the log rules on real TeX Live output, fuzz tests, a clear result model
  (`packages/core/src/types.ts`), four report formats.
- Reference handling is careful: statuses are verified, mismatch, not found,
  unverifiable; `overfull cite` writes provenance; `requireCite` closes the
  hand-written-BibTeX hole.
- The same core runs in the CLI, the Action and the browser check.
- Release pipeline: native executables, checksums, provenance, multi-arch
  image, one-click release from the Actions tab.

### 2.2 The main problem: the product is built around its own templates

Almost every path into Overfull starts with `overfull init <template>`. Real
authors almost never start that way:

- They already have a paper, usually in the venue's own style (NeurIPS, ICLR,
  ICML, ACL, CVPR, `acmart`, `IEEEtran`, Springer LNCS) or their university's
  thesis class.
- Many write on Overleaf and never open a terminal.
- Many use an agent in an existing repository and want one command or one
  plugin, not a new project layout.

Evidence from running the CLI as a new user in an existing folder:

| # | Finding | Where |
| --- | --- | --- |
| F1 | No way to add Overfull to an existing project. `init` only copies a template. A user must hand-write `overfull.yml` and copy `AGENTS.md`, skills, Makefile and workflow from a template. | `packages/cli/src/commands/init.ts` |
| F2 | Without `overfull.yml`, the main file is assumed to be `main.tex`. In a folder whose only source is `paper.tex`, the report still says "overfull main.tex" and looks for `main.log`. | `packages/cli/src/config.ts:273` |
| F3 | `overfull check refs.bib` silently ignores the argument. Positional arguments to `check` are not rejected or used. | `packages/cli/src/commands/check.ts`, `args.ts` |
| F4 | Only five venue profiles exist (generic, thesis, paper, arxiv, double-blind). None names a real venue, so "venue rules" means "set a number yourself". | `packages/core/src/venue/profiles.ts` |
| F5 | With no PDF, `venue` reports `page-limit-label-missing` ("counted all pages") although nothing was counted. | `packages/core/src/venue/pages.ts:61` |
| F6 | Reference summary says "2 with differing metadata" while the two problems listed are `reference-doi-wrong-work` errors. Counts and listed problems use different groupings. | `packages/core/src/refs/check.ts` |
| F7 | The message for an unverifiable entry nests three levels of brackets and repeats the same timeout twice. | `packages/core/src/refs/check.ts`, `verify.ts` |
| F8 | 17 references took 33 s with one source timing out. Each failing source costs its full 10 s timeout several times before it is skipped; there is no progress output. | `packages/core/src/refs/verify.ts:378`, `http.ts` |
| F9 | `doctor` prints "✓ api.crossref.org HTTP 405" as a success line. | `packages/cli/src/commands/doctor.ts:55` |
| F10 | Sources are doi.org, CrossRef, DBLP, arXiv, OpenAlex (key needed). Missing: Semantic Scholar, ACL Anthology, OpenReview, PubMed/Europe PMC, DataCite. ML and NLP papers cite many works that live only in these. | `packages/core/src/refs/sources/` |
| F11 | No check for retracted works, for preprints that have since been published, or for duplicate entries. All three are deterministic and commonly wanted. | new |
| F12 | The claim "the kit helps agents" has no published number. `evals/` has three tasks and no results. Reference accuracy has no published number either, while competing checkers publish theirs. | `evals/` |
| F13 | Agent rules are instructions only. Nothing stops an agent from hand-editing `references.bib`; the violation is found later by `check`. Claude Code, Codex and Cursor all support hooks that could block it at once. | `shared/agents/`, new |
| F14 | No packaged install for agents: no plugin manifest, no MCP server. Skills reach a project only through a template copy. | new |
| F15 | Install is a `curl` of a raw binary. No install script, no Homebrew or Scoop, no Intel macOS build. The only image is about 3 GB, even for CI jobs that only check. | `README.md`, `release.yml`, `docker/` |
| F16 | Overleaf users have only the browser check, one file type at a time. No zip of the project, no guide for Overleaf's GitHub sync. | `site/src/pages/check/`, `docs/guide/migrate-from-overleaf.md` |
| F17 | Test files are named after audit rounds (`round3.test.ts`, `round4.test.ts`, `round2-leftovers.test.ts`), not after what they test. `log/explain.ts` is 959 lines of mixed text and logic. | `packages/*/test`, `packages/core/src/log/explain.ts` |
| F18 | README and site lead with "write your paper with any AI agent, or by hand" and with templates. The strongest reason to use Overfull today (below) is in the fourth row of a table. | `README.md`, `site/src/pages/index.astro` |

### 2.3 What changed outside the repository

Read these before Phase C and Phase E; they set the priorities.

- ICLR 2026 desk-rejected papers with confirmed hallucinated references and
  requires disclosure of LLM use
  ([ICLR policy post](https://blog.iclr.cc/2025/11/19/iclr-2026-response-to-llm-generated-papers-and-reviews/),
  [ICLR retrospective](https://blog.iclr.cc/2026/03/31/a-retrospective-on-the)).
  Press coverage reports the same direction at NeurIPS and arXiv
  ([Fortune](https://fortune.com/2026/01/21/neurips-ai-conferences-research-papers-hallucinations/));
  *verify first* against the venues' own pages before quoting any of it.
- Several reference checkers now exist: RefChecker, CheckIfExist
  ([arXiv 2602.15871](https://arxiv.org/abs/2602.15871)), BibTeX Verifier
  ([site](https://merfanian.github.io/Bibtex-Verifier/)), a `check-citations`
  agent skill, and commercial ones. A benchmark paper, HALLMARK
  ([arXiv 2607.18360](https://www.alphaxiv.org/abs/2607.18360.md)), says no
  shared comparison existed. Most use Semantic Scholar, which Overfull lacks.
- Cloud editors with built-in agents (OpenAI Prism, Overleaf AI Assist) are
  where many authors now write. They generate; none of them is an independent
  check the author can show to a co-author or a venue.

## 3. The idea, restated

**Old framing:** a kit of templates, skills and checks for writing LaTeX with
or without an agent.

**New framing:** *the check you run before you submit, on the paper you already
have.* One command on any LaTeX project answers: does every reference exist and
match, does the PDF show what you meant, does it meet this venue's rules. It
works where the author is: terminal, CI, agent, Overleaf, browser.

What follows from that:

1. **Any project first, templates second.** Templates stay as good starting
   points and as the reference setup, but nothing may require them.
2. **References are the headline.** It is the check with real consequences
   (desk rejection) and the one where a deterministic tool beats a model.
   Coverage, speed, honest wording and a published accuracy number matter more
   than a sixth kind of check.
3. **Real venues, as data.** Profiles for named venues, each with a source URL
   and a "checked on" date, contributed like corpus cases.
4. **Enforce, don't only instruct.** Where an agent harness has hooks, block
   the bad action (hand-written BibTeX) when it happens.
5. **Prove it.** Publish the eval numbers and the reference-check accuracy,
   with method and date, and rerun them on every release.

Non-goals (do not build): writing or rewriting text, judging whether a cited
paper supports a claim, plagiarism or AI-text detection, a hosted service or
accounts, an editor, an npm package, telemetry.

## 4. Phases

Version targets: Phase A and B → 3.1.0. Phase C → 3.2.0. Phase D and E → 3.3.0.
Phase F and G → 3.4.0. Phase Z closes the plan.

---

### Phase A. Fix what the audit broke on (small, do first)

**A1. Main-file detection without config.** (F2)
Files: `packages/cli/src/config.ts`, `packages/cli/src/project.ts`, tests in
`packages/cli/test/config.test.ts`.
When there is no `overfull.yml` and no `main:`: if `main.tex` exists use it;
otherwise scan `*.tex` in the project root (not subfolders) for files with an
uncommented `\documentclass`; if exactly one, use it and derive `jobname` from
it; if several, prefer one with a matching `.log`/`.pdf`, else exit 2 with a
message listing the candidates and the fix (`overfull check --main x.tex` or
set `main:`). Add `--main` to `check`, `pages`, `diff` if missing.
Accept: in a folder with only `paper.tex`, `overfull check` prints "overfull
paper.tex" and looks for `paper.log`. Two candidates give exit 2 and both names.

**A2. Positional arguments to `check`.** (F3)
`overfull check <file...>`: a `.tex` is the main file; `.bib`, `.log`, `.pdf`,
`.aux` map to `--bib`, `--log`, `--pdf`, `--aux`; when only `.bib` files are
given, run only the references check. Anything else is a usage error (exit 2).
Update `--help`, `docs/guide/cli.md`.
Accept: `overfull check refs.bib` runs references only on that file;
`overfull check foo.xyz` exits 2.

**A3. Page-limit noise with no PDF.** (F5)
`page-limit-label-missing` must only fire when pages were counted. With no PDF,
only `page-limit-unchecked` is reported.
Accept: unit test in `packages/core/test/venue.test.ts`.

**A4. Reference summary and messages.** (F6, F7)

- The summary counts must use the same groups as the listed problems: name
  wrong-work results as "N with an identifier that points to another work".
- Rewrite the unverifiable/lookup-incomplete message as one sentence plus a
  `detail` list: one line per source, each source named once, with its last
  error. No nested brackets. Keep `data` fields unchanged.
Accept: snapshot tests for human and Markdown formats; JSON `data` unchanged.

**A5. Failing sources fail fast; progress on a terminal.** (F8)
Files: `packages/core/src/refs/http.ts`, `verify.ts`, `packages/cli/src/check.ts`.

- Circuit breaker per host: after 2 consecutive timeouts or 5xx, skip that host
  for the rest of the run (today it retries more before skipping; measure and
  fix). Connect/first-byte timeout 4 s, total 10 s.
- Query independent sources for one entry concurrently, not in sequence, while
  keeping the per-host rate limits.
- When stderr is a TTY and not `--json`, show one updating line
  ("references 12/31"). Nothing in CI or under `--json`.
Accept: a test with a fake `fetch` where one host always hangs: 30 entries
finish in under 12 s of fake time and that host is called at most twice.
`refs-bench.test.ts` still passes.

**A6. `doctor` wording.** (F9)
Print "reachable" for any HTTP response and keep the status only under
`--json`. Use a GET the API answers with 200 (*verify first*).

**A7. Test and source hygiene.** (F17)

- Move every test in `round*.test.ts` and `round2-leftovers.test.ts` into the
  file named after the module it tests (create files where needed). No test is
  dropped: the test count before and after must match; put both numbers in the
  pull request.
- Split `packages/core/src/log/explain.ts`: rule texts into a data module, the
  logic stays. No behaviour change; corpus and tests unchanged.

---

### Phase B. Any project, in one minute

**B1. `overfull init --here` (adopt an existing project).** (F1)
Files: `packages/cli/src/commands/init.ts`, `templates.ts`, new
`packages/cli/src/adopt.ts`, tests, `docs/guide/install.md`, new
`docs/guide/existing-project.md`.
`overfull init --here` (alias `overfull adopt`) in an existing LaTeX folder:

1. Detect: main file (A1), engine (from `.latexmkrc`, a `% !TEX program` line,
   `fontspec`/`\DocumentMetadata` use, else pdfLaTeX), bibliography files and
   backend (`\addbibresource`, `\bibliography`, biber vs bibtex), document
   class and known venue style files (see C2 for the mapping).
2. Write `overfull.yml` with what was detected, each value commented with how
   it was found. `references.requireCite: false` here (existing entries were
   not written by `cite`); the file explains how to turn it on.
3. Ask (TTY) or take flags for the optional parts; never overwrite an existing
   file without `--force`, and print every file written:
   `--agents` (AGENTS.md, pointer files, `.agents/skills/`), `--ci` (a workflow
   that builds with the detected engine and runs the Action), `--make`
   (Makefile targets; skip if a Makefile exists and print the lines to add).
4. Never touch `.tex` or `.bib` files.
5. `--json` prints what was detected and written. `--dry-run` writes nothing.
The agent files must come from the same source as the templates
(`shared/agents`, `skills/`), bundled into the CLI and the single-file builds;
extend `scripts/sync-templates.mjs --check` or the build so they cannot drift.
`AGENTS.md` must not assume the template layout: make the Layout table
conditional or generic, and say "read `overfull.yml` for the paths".
Accept: e2e test on three fixture projects (NeurIPS-style pdfLaTeX + bibtex,
`acmart` + biblatex, a multi-file thesis): `init --here --agents --ci` then
`overfull check --offline` gives exit 0 or 1, never 2; no `.tex`/`.bib` file
changed (hash compare); a second run changes nothing.

**B2. `check` explains what it assumed.**
With no `overfull.yml`, print one line: main file, profile, and "run
`overfull init --here` to save these settings". Not under `--json` (add an
`assumed` object to the report instead; additive).

**B3. Check-only image and Action speed.** (F15)
Files: `docker/Dockerfile` (new target), `.github/workflows/image.yml`,
`docs/guide/action.md`, `docker/README.md`.
Publish `ghcr.io/amet13/overfull:<v>-check`: the CLI, veraPDF, poppler, no TeX
Live. Target under 400 MB. The full image stays the default for building.
Document: build with any TeX setup, check with the Action (no image) or the
`-check` image.
Accept: image job builds both for amd64 and arm64; smoke test in CI runs
`overfull check` on the committed fixture project inside `-check`.

**B4. Install without thinking.** (F15)

- `install.sh` (POSIX sh) and `install.ps1` at the repository root, served
  from the site: detect OS and CPU, download the release asset, verify it
  against `SHA256SUMS`, install to `~/.local/bin` (or `%LOCALAPPDATA%`), print
  the PATH line if needed. No `sudo`. ShellCheck clean; tested in CI on the
  three OS runners against the latest release.
- Add a `darwin-x64` build if a runner for it still exists (*verify first*);
  otherwise document Rosetta.
- Homebrew tap and Scoop bucket need new repositories the owner must create:
  write the formula and manifest into `packaging/` with instructions, and list
  this as an owner action. Do not create repositories.
Accept: `curl -fsSL <site>/install.sh | sh` on a clean container gives a
working `overfull --version`; a tampered download fails the checksum.

**B5. Overleaf path.** (F16)

- Browser check accepts a project `.zip` (Overleaf "Download source") and a
  folder drop: finds the main file, the `.bib` files, a `.log` and PDF if
  present, and runs references plus the source-only venue checks. Unzip in the
  browser; nothing is uploaded. Put a size limit and a zip-bomb guard (entry
  count, total uncompressed size, no paths outside the root).
- Rewrite `docs/guide/migrate-from-overleaf.md` as "Use with Overleaf": browser
  check for a quick look; Overleaf GitHub sync plus the Action for every
  change (*verify first* what Overleaf's current plans allow).
Accept: Playwright test drops a fixture zip and gets the same reference
results as the CLI on the unzipped folder.

---

### Phase C. References: wider, faster, measured

**C1. More sources.** (F10)
Files: `packages/core/src/refs/sources/`, `verify.ts`, `lookup.ts`, fixtures in
`packages/core/test/fixtures/refs/http.json`, `docs/guide/references.md`.
Add, each behind the existing source interface, each with recorded fixtures
and a live opt-in test. *Verify first* the endpoint, the fields, whether a key
is needed and the rate limit, and record them in the source file header:

1. Semantic Scholar Graph API (works without a key at a low rate; optional
   `SEMANTIC_SCHOLAR_API_KEY`).
2. ACL Anthology (ids like `2020.acl-main.1`, `aclanthology.org` URLs).
3. OpenReview (forum ids and URLs; covers ICLR, NeurIPS, TMLR).
4. Europe PMC or PubMed (PMID, PMCID).
5. DataCite (dataset and software DOIs; check whether doi.org content
   negotiation already covers these and only add what is missing).
OpenAlex: *verify first* whether a key is still required; use it keyless if
allowed. Order and stopping rule: identifier lookups first; for title search,
stop at the first confident match; never query more than three title-search
sources for one entry. `overfull cite` gains the same sources.
Accept: fixtures for at least 5 real works per new source verify offline from
recordings; the fabricated fixture still reports every fabricated entry.

**C2. New deterministic reference rules.** (F11)

- `reference-retracted` (error): the matched work is retracted or withdrawn
  per CrossRef (Retraction Watch data) or arXiv. *Verify first* the fields.
- `reference-published-version` (info): an arXiv entry whose record names a
  published DOI; suggest `overfull cite <doi>`.
- `reference-duplicate` (warning): two entries with the same DOI, arXiv id or
  normalized title and year. Offline.
- `reference-uncited` (info, off by default, `references.reportUncited`).
Each: registry entry, explain text, fixture, test, docs row.

**C3. Benchmark and published accuracy.** (F12)
New `bench/refs/`: a dataset of real entries (at least 300, across fields,
including preprints, books, theses, non-English titles) and fabricated ones
(invented, real title with wrong authors or year, real DOI on the wrong work).
If HALLMARK's dataset licence allows, add a loader for it rather than copying
it. `node bench/refs/run.mjs` reports per-status precision and recall, false
"not found" on real works (the number that matters most), and time; it writes
`bench/refs/results.json` with date, version and source availability. Runs in
a scheduled workflow monthly and on release, not on every pull request.
Publish the table on a site page "How accurate is the reference check" with
method, limits and date. State plainly what the check cannot do.
Accept: the workflow produces the JSON; the page renders from it; false
"not found" on real works is under 2% or the pull request lists the misses
and files issues for them.

**C4. Cache and offline behaviour.**
Shared user-level cache keyed as today, 30-day default lifetime for positive
results, 1 day for "not found", never cache transport errors. `--refresh`
flag. In the Action, document the `actions/cache` lines.
Accept: second run of `overfull check` on the paper template makes zero
network calls (fake fetch counter).

---

### Phase D. Real venues, as data

**D1. Venue profile format and loader.** (F4)
Files: new `venues/*.yml` at the repository root, schema in
`packages/core/src/venue/`, build step that compiles them into core,
`docs/guide/venues.md`, site page per venue.
A profile: id, name, year or "rolling", `source` URLs, `checkedOn` date,
paper size, page limit (number, what counts, what is excluded), anonymity,
disclosure requirement, required style file name(s) and optionally their
SHA-256 from the official kit, accessibility requirement, free-text notes.
`profile: neurips-2027` resolves it; `extends` keeps working. A profile older
than 14 months prints an info note that it may be out of date.

**D2. First profiles.**
*Verify first, every field, from the official call for papers or author kit.*
Start with what can be confirmed: NeurIPS, ICLR, ICML, ACL (ARR), EMNLP, CVPR,
AAAI, ACM (`acmart` formats), IEEE conference (`IEEEtran`), Springer LNCS,
arXiv. One pull request per two or three venues, each field with its source.
If a venue's next call is not out, ship the latest published year and say so.

**D3. Venue rules that need new checks.**

- `style-file-modified` (warning): the official style file in the project
  differs from the recorded hash.
- `layout-tampering` (warning): commands commonly used to squeeze space in the
  source, e.g. negative `\vspace` near floats or sections, changed
  `\baselinestretch`, `\textheight`, `\columnsep`, `savetrees`, changed font
  size. Report location; wording says "check your venue allows this".
- `anonymity-link` (warning, anonymous profiles): links to personal GitHub,
  institutional pages, non-anonymized repositories; allow known anonymizers.
- `margins` from the PDF: text outside the profile's text block, measured with
  pdf.js on every page (only when the profile gives a text block).
Each with fixtures and tests; none may fire on the three shipped templates.

**D4. Contributing a venue.**
`CONTRIBUTING.md` section and an issue form: fields, required source URL, how
to test. CI validates every `venues/*.yml` against the schema and fails on a
missing `source` or `checkedOn`.

---

### Phase E. Agents: install in one step, enforce the rules

**E1. Guard: block hand-written bibliography edits.** (F13)
New command `overfull guard`:

- `overfull guard --staged` (pre-commit): fails when a `.bib` change adds or
  alters an entry that neither carries valid `cite` provenance nor verifies;
  prints the `overfull cite` command to use.
- `overfull guard --hook` reads a harness hook payload on stdin and answers in
  that harness's format, denying direct writes to `.bib` files and allowing
  everything else. *Verify first* the current hook formats of Claude Code,
  Codex CLI, Cursor and Gemini CLI; implement only those you confirmed, each
  with a recorded payload fixture.
- `init` and `init --here --agents` write the hook config for the harnesses
  present, and a `.pre-commit-hooks.yaml` at the repository root makes
  Overfull usable from pre-commit.
The author can still edit the `.bib` by hand outside the agent; the pre-commit
guard then asks for `note = {overfull: author-provided}` as today.
Accept: fixture payloads are denied or allowed correctly; e2e: a git commit
adding a fabricated entry is refused, one added by `cite` passes.

**E2. Plugin packaging.** (F14)
*Verify first* the current Claude Code plugin and marketplace manifest format,
and the equivalent for Codex and Cursor if they have one. Add the manifest(s)
so the skills, the hook from E1 and (after E3) the MCP server install with one
command from this repository. The skills in the plugin are the same files as
`skills/`; extend the sync check. Document in `docs/guide/with-an-agent.md`.

**E3. `overfull mcp` (stdio MCP server).**
For agents without a shell (desktop apps, cloud editors). Tools: `check`,
`cite`, `explain`, `pages`, `doctor`; read-only except `cite`, which writes
only inside the project as today (`safety.ts` rules apply). Results are the
same JSON as `--json`. *Verify first* the current MCP SDK and spec version.
Bundle into the single-file builds; measure the size increase and report it.
Accept: an MCP client test lists the tools and runs `check` on the fixture.

**E4. Evals with published numbers.** (F12)

- Grow `evals/tasks/` to at least 12: fix a broken build, add five citations
  from a notes file that contains two wrong DOIs, fit the page limit,
  anonymize for review, prepare arXiv, adopt an existing project, add alt
  text, respond to a reviewer comment that needs a new reference.
- Score more than "check passes": count fabricated or unverified cited
  entries, changed files outside the task, and whether research content was
  invented (a simple diff-size bound on prose sections is enough).
- Variants: bare, instructions only, instructions plus guard.
- The owner runs them (they cost money). Make that one command, write
  `evals/results/<date>-<agent>.json`, and render a site page from the
  committed results with agent, model, date, runs and confidence intervals.
  Do not write any number that was not measured.

**E5. Trim the agent text.**
`AGENTS.md` is about 1,400 words and the ten skills about 5,400. After E1,
rules that the guard enforces can shrink to one line each. Target: `AGENTS.md`
under 900 words, each skill under 450, no rule lost (map old → new in the
pull request). Re-run the evals before and after if results exist.

---

### Phase F. Say what it is

**F1. README and site lead.** (F18)
Lead with the new framing: what it checks on the paper you already have, the
60-second path (`install` → `overfull check` in your folder), then CI, agents,
Overleaf, and templates last. Put the browser check and the accuracy page one
click from the top. Keep the existing visual design and tone.
Add a "How it compares" docs page: a factual table against other reference
checkers and editor assistants (*verify first*, with links and date; no claims
you did not check; say where others are better).

**F2. Docs restructure.**
Order the guide by entry point: existing project, CI, agent, Overleaf,
templates. Every page starts with the one command. Check every command in the
docs by running it in the e2e script (extract fenced `bash` blocks marked for
testing).

**F3. Templates.**
Keep thesis, paper, slides. Add nothing venue-specific as a template: venue
kits change yearly and are the venue's to publish; `init --here` on the
official kit is the supported path, and `docs/guide/venues.md` shows it.

---

### Phase G. Smaller items (any order, after F)

- **G1.** `overfull check --watch`: rerun the offline checks when the log or
  PDF changes; references only on `.bib` change.
- **G2.** `overfull check --sarif` for GitHub code scanning upload.
- **G3.** Action: optional sticky pull-request comment with the Markdown
  report (needs `pull-requests: write`; off by default).
- **G4.** `--lang` for report text is *not* planned; note it in the FAQ as a
  possible contribution, with how messages are structured.
- **G5.** Image size: measure which TeX Live collections the templates and
  corpus need; if a medium scheme plus named collections builds all of them,
  offer it as `:<v>-medium`. Keep the full image the default.

---

### Phase Z. Close

- **Z1.** Delete `PLAN.md`. Move anything unfinished into GitHub issues, one
  per task, with the task text.
- **Z2.** Update `docs/ARCHITECTURE.md` for everything added (adopt, guard,
  mcp, venues, bench).

## 5. Order, size and dependencies

| Phase | Depends on | Rough size | Release |
| --- | --- | --- | --- |
| A | none | 5 to 7 small pull requests | 3.1.0 |
| B | A1, A2 | 5 pull requests; B1 is the largest | 3.1.0 |
| C | A4, A5 | 4 to 6 pull requests | 3.2.0 |
| D | B1 (style detection) | 1 format + several data pull requests | 3.3.0 |
| E | B1 (agent files), C (guard uses verify) | 5 pull requests | 3.3.0 |
| F | B to E mostly done | 2 to 3 pull requests | 3.4.0 |
| G | none | independent | 3.4.0 |

If time is short, the order of value is: A, B1, C1, C3, E1, D1 + D2, F1.

## 6. Risks and how to handle them

- **False "not found" on real works** is the worst failure: it teaches authors
  to ignore the tool. C3 measures it; any new source or matching change must
  not raise it. When unsure, the status is "unverifiable", never "not found".
- **Stale venue data.** Every profile carries its source and date and warns
  when old (D1). Wrong data is worse than none: leave a field out if not
  confirmed.
- **API limits and outages.** Circuit breaker (A5), cache (C4), polite-pool
  `mailto`, keys optional. A source outage must never turn into an error
  status for the document.
- **Hook formats differ and change.** Implement only verified formats, keep
  each behind a small adapter with a fixture (E1).
- **Scope creep.** Section 3 lists the non-goals. A task that needs a model to
  judge text does not belong here.

## 7. Decisions for the owner (defaults in brackets)

1. Command name for adopting a project: `init --here` with alias `adopt`.
   [both]
2. Create `homebrew-overfull` and `scoop-overfull` repositories for B4? [yes,
   later; the plan only prepares the files]
3. Run the paid evals (E4) and with which agents and models? [two agents,
   3 runs per task and variant]
4. Keep the slides template? [keep; it costs little]
5. Make the GHCR package public and list the Action on the Marketplace (both
   still open from 3.0.0). [yes]
