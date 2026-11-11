# Overfull: improvement plan (after 3.1.0)

> **Status:** implemented in one pull request, including the items listed under
> "Not in this round" (skills trimmed, unused exports removed, ECCV 2026 and
> AISTATS 2027 added, npm publishing behind an `NPM_TOKEN` secret). F1 (the first
> published benchmark) runs after the release; F2 (evals) is the owner's call.

Written on 2026-11-11 from an audit of `main` at 76c95ff (3.1.0 plus the CodeQL
fixes). Every finding below was reproduced; the evidence is given with it. Work is
grouped into seven pull requests, in the order they should land. Each item names
its files and says how to know it is done.

## What the audit found

Healthy:

- `pnpm audit`: no known vulnerabilities. Two dependencies are a patch behind
  (astro 7.4.7 → 7.4.8; site TypeScript 6.0.3 while the root uses 7.0.2).
- Duplicated code: 0.18 % (jscpd, blocks of 12+ lines).
- Tests: 866 passing; 92 % of lines, 77 % of branches in `packages/*/src`.
- The 3.1.0 release is complete: binaries for five platforms, `SHA256SUMS`, the
  three images public on ghcr.io, `v3` moved, site and installers live.
- The self-maintenance from 3.1.0 works: `autorelease` published 3.1.0 by itself.
- No open issues or pull requests; CI on `main` is green (the Website job needed
  three attempts on 2026-11-11, see C1).

Broken or weak, most important first:

1. **The reference check almost never calls an invented reference "not
   found".** A partial live run of the benchmark (`node bench/refs/run.mjs
   --limit 30`) from a cloud machine:

   | Class | verified | mismatch | not-found | unverifiable | error |
   | --- | ---: | ---: | ---: | ---: | ---: |
   | real (30) | 25 | 0 | 0 | 5 | 0 |
   | invented (30) | 0 | 1 | **0** | 0 | **29** |
   | wrong metadata (30) | 0 | 5 | 0 | 2 | 23 |
   | wrong DOI (30) | 0 | 30 | 0 | 0 | 0 |

   Invented references: 1 of 30 detected. The cause is one line:
   `REQUIRED_FOR_NOT_FOUND = ['crossref', 'dblp']`
   (`packages/core/src/refs/verify.ts:40`). dblp.org now answers automated
   requests with a bot challenge (HTTP 202, an HTML page titled "Making sure
   you're not a bot!"), so every title-only entry ends as `error` ("could not be
   checked because dblp did not answer"), a warning, not an error. CrossRef and
   OpenAlex answered every request in the same run. The same happens for
   `overfull cite` on an unknown title, and in the browser check, which leaves
   dblp and arXiv out by design and so reports every title-only entry as
   "could not be checked here" (`verify.ts:362`). The benchmark workflow has
   never run (`bench.yml`: 0 runs), so nobody saw it.
2. **A folder with nothing to check passes.** `overfull check` in an empty
   directory prints `overfull main.tex PASS`, all five checks skipped, exit 0;
   `main.tex` does not even exist. The Action does the same when the workflow
   built nothing or `working-directory` is wrong: a green check on an unchecked
   paper.
3. **One missing citation is reported twice.** On the CLI fixture project,
   `ghost2020` gives both `undefined-citation` (output) and
   `citation-key-missing` (references), same file and line.
4. **Summaries say the wrong thing.** The references line reads "1 references
   not checked (offline)" while the check fails for a different reason (the
   missing key); "1 references" is ungrammatical; the venue line reads "main
   text 2 of 1 pages".
5. **`overfull cite` keeps the preprint when a published version exists.**
   "Language Models are Few-Shot Learners" is added as `@misc` from arXiv,
   although it was published at NeurIPS 2020; Overfull's own
   `reference-published-version` rule would then flag the entry it just wrote.
   A CrossRef record for a KDD paper produced both `collection` and `series`
   with the same value (`collection` is not a BibTeX field).
6. **CI depends on Ubuntu's package mirrors.** The Website job runs
   `playwright install --with-deps chromium`; on 2026-11-11 the runner could
   not resolve `security.ubuntu.com`, the step hung for 10 to 20 minutes, and
   `main` was red until a third attempt.
7. **A module used on every check is untested.**
   `packages/core/src/log/bibliography.ts` (points `.bbl` errors at the `.bib`
   entry) has 3 % line coverage. The Semantic Scholar source has 19 %; the MCP
   stdio framing 65 %; `cli/src/pdf.ts` 23 % of branches.
8. **The documentation describes an older product.** `docs/ARCHITECTURE.md`
   still calls `make build` / `make check` "the classic way", lists the old
   reference order (no Semantic Scholar, ACL, Europe PMC), omits `guard`,
   `mcp`, `init --here`, `--sarif`, `--watch` and the venue profiles.
   `action.yml` describes `profile` as "generic, thesis, paper, arxiv,
   double-blind" only. `overfull --help` lists both `adopt` and `init --here`
   for the same thing.
9. **Loose ends.** knip reports 8 files nothing imports
   (`bench/refs/collect.mjs`, `bench/refs/make-fabricated.mjs`,
   `evals/fixtures/collect-preprint.mjs`, four recorders in
   `packages/core/test/fixtures/refs/`, `site/scripts/og.mjs`), one undeclared
   dependency (`shiki` in `site/src/lib/shiki-theme.mjs`), and `jq` used by
   `image.yml`. The single-file binaries are 153 MB each.
10. **No published evidence.** No benchmark results, no eval results; the
    README and the accuracy page say so.

## Principles for this round

- Fix what the user relies on before adding anything: the reference check's
  headline promise, and "PASS" meaning something was checked.
- Measure before and after. Every reference-check change is judged by the
  benchmark, and the numbers go in the pull request.
- Keep "never call a reference fake". Changing when "not found" may be said is
  in scope; changing the vocabulary is not.
- No new commands, checks or venues in this round.

## PR 1: Reference check that detects invented references

Files: `packages/core/src/refs/verify.ts`, `refs/http.ts`, `refs/search.ts`,
`refs/sources/dblp.ts`, `refs/sources/openalex.ts`, `packages/core/test/`,
`bench/refs/`, `docs/guide/references.md`, `docs/guide/accuracy.md`.

- **A1. Replace "CrossRef and dblp must answer" with a quorum.** A title-only
  scholarly entry may be `not-found` when CrossRef answered and at least one
  other general index answered (OpenAlex or Semantic Scholar), none has a
  similar title, and no answering source failed partway. arXiv and dblp add
  coverage when they answer; they are no longer required. Keep `error` for
  "fewer than two general indexes answered". Write the rule in one place,
  `notFoundQuorum(evidence)`, with a doc comment listing the cases.
- **A2. Recognise a bot wall as "this source is unavailable", once.** An HTML
  answer (HTTP 200 or 202) to a JSON API request, such as dblp's challenge page,
  switches that source off for the whole run on the first hit (the circuit
  breaker already exists). It is mentioned once in the check summary ("dblp
  refused automated requests; not asked"), not on every entry.
- **A3. OpenAlex: always identify.** Send `mailto` when one is configured, and
  the project URL otherwise, so requests go to the polite pool. Note in
  `docs/guide/config.md` that setting `references.mailto` makes runs faster
  and steadier. Verify the 429s seen from a cloud machine without `mailto`
  disappear with it.
- **A4. Browser check.** Apply the same quorum to the sources the browser can
  reach (CrossRef, OpenAlex, Semantic Scholar if it allows CORS: check it).
  When the quorum is met, the browser may say "not found" too; when not, the
  page says which index could not be asked.
- **A5. Lock it with a recording.** Record a 20-entry run (10 real, 10
  invented; `run.mjs --record`), including a dblp challenge response, and
  replay it in a unit test that asserts detection of invented entries ≥ 9/10
  and zero real entries `not-found`.
- **A6. Re-measure "wrong metadata".** After A1, run the benchmark with
  `--limit 60`. If detection is still below 50 %, list the misses by cause
  (year off by one, author order, subtitle) in the pull request and fix only
  causes that cannot flag correct entries.

Done when: a full live run (`node bench/refs/run.mjs`) shows invented
detection ≥ 85 %, false "not found" on real works ≤ 2 %, and the numbers are in
the pull request.

## PR 2: Reports that mean what they say

Files: `packages/cli/src/check.ts`, `packages/cli/src/commands/check.ts`,
`packages/core/src/types.ts`, `packages/core/src/report/*`,
`packages/core/src/refs/check.ts`, `packages/core/src/venue/*`,
`packages/cli/src/commands/cite.ts`, `packages/core/src/refs/entry.ts`,
`action/src/index.ts`.

- **B1. Nothing checked is not a pass.** When every requested check is
  skipped, the report status is `skipped`, the headline reads "Nothing was
  checked" with the first reason (no log, no PDF, no `.bib`), and the exit code
  is 1. The Action fails the step with the same message unless `fail-on:
  never`. When the main file itself does not exist, say so first ("No main.tex
  here; pass the main file or run in the project folder"). Add `skipped` to
  the `status` output's documented values. Note it in the CHANGELOG as a
  behaviour change.
- **B2. One finding per missing key.** When `citation-key-missing` and
  `undefined-citation` name the same key, keep `citation-key-missing` (it
  carries the fix) and drop the log duplicate; same for the same key at
  several lines (one finding, the other lines in `related`).
- **B3. Summary lines.** The references summary counts what decided the
  status ("1 cited key has no entry; 4 references not checked (offline)");
  pluralise every count through one helper in `report/shared.ts`; venue line
  "main text is 2 pages, the limit is 1". Add a test that renders every check's
  summary for 0, 1 and 2 items.
- **B4. `cite` prefers the published version.** When the arXiv record links a
  DOI (arXiv's `journal_ref`/DOI field, or a CrossRef match on the title with a
  strong score), write the published record and keep `eprint` and
  `archivePrefix`. Never write `collection`; map CrossRef's collection data to
  `series` only.

Done when: the empty-folder run exits 1 with "Nothing was checked"; the fixture
project shows `ghost2020` once; the summary test passes; `overfull cite
"Language Models are Few-Shot Learners"` writes an `@inproceedings` with the
NeurIPS DOI and the arXiv id.

## PR 3: CI that survives a bad network day

Files: `.github/workflows/ci.yml`, `pages.yml` (if it installs browsers),
`.github/workflows/watchdog.yml`.

- **C1. Website job without `--with-deps`.** Run `playwright install chromium`
  (no system packages); check first that the runner image has Chromium's
  libraries (a test run without `--with-deps`).
  Cache `~/.cache/ms-playwright` keyed on the Playwright version. Give the
  install step `timeout-minutes: 5`. If a library turns out to be missing,
  install only that one with `apt-get` and a retry.
- **C2. Time limits on every network step.** Any step that downloads
  (`pnpm install`, `apt-get`, `docker pull`) gets a `timeout-minutes` so an
  outage fails in minutes, not after the job's own limit.
- **C3. Fewer watchdog runs.** The watchdog ran 8 times for one merge. Limit
  its `workflow_run` list to the workflows it reports on, and exit early for
  runs on branches other than `main` and the automation branches.

Done when: the Website job takes under 3 minutes with a warm cache, and a
forced DNS failure (point `security.ubuntu.com` nowhere in a test branch) no
longer affects it.

## PR 4: Tests where the risk is

Files: `packages/core/test/`, `packages/cli/test/`, `vitest.config.ts`.

- **D1. `log/bibliography.ts`.** Tests for BibTeX (`\bibitem`) and biblatex
  (`\entry`) `.bbl` files: an error at a `.bbl` line is moved to the right
  `.bib` entry; an unknown key is left alone; several `.bib` files.
- **D2. Semantic Scholar.** Recorded responses for a match, no match, a 429
  and an API key; the same shape as the other sources' tests.
- **D3. MCP stdio.** Split messages, two messages in one chunk, a message over
  `MAX_MESSAGE_BYTES`, invalid JSON.
- **D4. Keep it.** Set coverage thresholds in `vitest.config.ts` a little below
  today's numbers (lines 90, branches 76) so coverage cannot quietly drop; add
  `@vitest/coverage-v8` and run coverage in the Linux CI job only.

Done when: `bibliography.ts` ≥ 90 % of lines, Semantic Scholar ≥ 80 %,
thresholds enforced in CI.

## PR 5: Documentation and cleanup

- **E1. Rewrite `docs/ARCHITECTURE.md`** from the code as it is: any project
  first (`check` on what exists, `init --here`), the full source list and the
  quorum from PR 1, every command (`guard`, `mcp`, `cite` with ACL ids and
  PMIDs, `check --sarif --watch`), venue profiles as data, the images
  (`:3`, `:3-check`, `:3-medium`), the automation (one paragraph pointing to
  `MAINTAINING.md`). Keep it under 300 lines.
- **E2. `action.yml`:** `profile` lists the built-in profiles and says that
  any venue id from `overfull explain --list` or the Venues page works; the
  `status` output lists `skipped` (B1).
- **E3. One name per command.** `overfull --help` shows `init --here` only;
  `adopt` stays as an alias, mentioned in `init --help`.
- **E4. Files nothing imports.** Move the recording and collection scripts
  into one folder per area with a short README saying when to run them
  (`bench/refs/tools/`, `packages/core/test/fixtures/refs/tools/`), or delete
  those no longer needed; wire `site/scripts/og.mjs` into the site build or
  delete it; declare `shiki` in `site/package.json`.
- **E5. Dependencies.** astro 7.4.8; move the site to TypeScript 7 if
  `@astrojs/check` accepts it, otherwise note why it stays on 6 in
  `site/package.json`'s neighbouring README.
- **E6. Binary size (investigate, then decide).** Measure what makes the 153 MB
  binaries large (Node runtime, ICU, the embedded templates, pdf.js) and
  whether `--without-intl`-style options or compression are possible with the
  Node single-executable build. Report the numbers; change only if one option
  saves a third or more without breaking `--version`, `check` and `init`.

Done when: a reader of `ARCHITECTURE.md` can find every command and every
reference source; knip reports no unused files.

## PR 6: First published evidence

- **F1. Run the benchmark** (`workflow_dispatch` on `bench.yml`) after PR 1 is
  released; `automerge` merges the results pull request and the accuracy page
  shows real numbers. Update the README's "How good is the reference check"
  paragraph with the two headline numbers and the date.
- **F2. Evals** cost money and are the owner's call (see below). If run once,
  the result decides whether the skills need trimming: without it, any trim is
  guesswork.

## PR 7: Keep the outside data current

Overfull depends on four kinds of outside data. Pinned tools (TeX Live image,
Node, veraPDF, pnpm, npm packages, Actions) already update on their own
(Dependabot, `update-pins.yml`). The reference indexes are queried live, so
their data is always current, but nothing notices when one stops answering:
dblp's bot challenge went unseen. Venue profiles are updated by hand from an
issue that only says "look at this". This PR closes those gaps. It reuses
`.github/scripts/automation-pr.sh` and `issue.sh`, and every workflow reports
failures through `watchdog.yml` like the others. G1 does not depend on the
other PRs and can land first.

- **G1. Weekly source health** (`.github/workflows/sources-health.yml`,
  `scripts/sources-health.mjs`). For each reference source, two fixed queries
  through the core's own source modules: one that must match (a known DOI,
  arXiv id, ACL id, PMID or title) and one that must not (an invented title).
  It records for each source: answered or not, HTTP status, JSON or not, and
  whether the expected match came back. One issue, "Reference sources need a
  look", lists sources that stopped answering, return HTML (a bot wall) or no
  longer find the known record; the issue closes itself when all pass. It
  never fails because of one slow answer: a source counts as broken after two
  failed attempts a minute apart.
- **G2. Monthly refresh of the recorded responses** (`.github/workflows/
  refresh-recordings.yml`). Re-record the fixtures the offline tests replay
  (`packages/core/test/fixtures/refs/http*.json`, through the existing
  `record.mjs` and `record-sources.mjs`) and open a pull request when they
  changed. CI runs the tests against the new recordings, so a changed API
  format shows up as a red pull request, not as a silent difference between
  tests and the live service. Strip `Set-Cookie`, dates and request ids from
  the recordings first so a refresh with no real change produces no diff. The
  benchmark dataset (`bench/refs/dataset/`) stays fixed on purpose: months
  must stay comparable.
- **G3. Style files follow the official kit** (`scripts/venues-kits.mjs`, run
  from `venues-watch.yml`). For each profile with `styleFiles`, download the
  author kit from its `source` list (the `.zip` or `.sty` URL), compute each
  file's SHA-256 and the text block from the geometry, and open a pull request
  "Venue kit changed: <id>" when a hash or `textBlock` differs, with the kit's
  file date in the body. The kit is the authority, so this update is
  mechanical. It does not touch `checkedOn`: that date still means a person
  read the rules.
- **G4. Venue pages: show what changed** (`venues/.fingerprints.json`,
  `scripts/venues-watch.mjs`). For each `source` page, store a hash and a
  plain-text copy of the main content (navigation and dates removed). When a
  page's text changes, the monthly issue shows the changed paragraphs as a diff
  under the profile's name, so the person reviewing reads the change, not the
  whole call for papers. When the person updates the profile, they refresh the
  fingerprints with `node scripts/venues-watch.mjs --accept <id>` in the same
  pull request.
- **G5. arXiv's build environment.** Add arXiv's own help pages on the TeX Live
  version and the build process to the watched pages (G4), so a change in
  arXiv's TeX Live year or processing rules reaches the person maintaining
  `venue/arxiv.ts`.

What stays with a person, deliberately: page limits, what counts toward them,
anonymity and disclosure rules. These are prose; extracting them by script or
by a language model could produce a wrong limit that rejects a correct paper.
The automation detects and shows the change; a person decides
(CONTRIBUTING.md, "Adding a venue"). Update `MAINTAINING.md`'s table with the
three new schedules and this boundary.

Done when: G1 run against a test branch where one source URL points to an HTML
page opens the issue naming that source, and closes it on the next good run;
G2 opens no pull request when nothing changed; G3 opens a pull request after a
profile's `sha256` is edited by hand to a wrong value; G4's issue shows a diff
for a page whose stored copy was edited.

Release: after PR 1 to PR 5 and PR 7 merge, `autorelease` proposes 3.2.0 on the 1st of
the month, or start it by hand (CONTRIBUTING.md, "Cutting a release"). B1 is a
behaviour change; give it its own CHANGELOG line under "Changed".

## Not in this round

- **Trimming the skills** (left from the previous plan). Measured again: the ten
  skills share no repeated boilerplate (the only lines that repeat are
  headings and code fences), 400 to 830 words each. Without eval results a trim
  would be guesswork; decide after F2.
- New venues, new checks, new commands, an npm package.
- Exports used only by tests (knip lists 58): they are test seams, not dead
  code.

## For the owner (cannot be done from a pull request)

- Branch protection on `main` with required status checks (Scorecard's main
  remaining finding; MAINTAINING.md lists the checks to require).
- An evals budget, if wanted (F2).
- Whether B1's new exit code needs a minor or a major version. The plan
  assumes minor (3.2.0): a check that checked nothing was never meant to pass.
