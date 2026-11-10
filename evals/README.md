# Evals

Small, honest measurements of whether the kit helps AI agents produce a paper
that passes preflight. Each task prepares a project, runs an agent with a
prompt, then scores the result with `overfull check` in the Docker image and
by what the agent changed.

No numbers are published from this folder until someone has run the agents:
the runs cost money and are done by the owner. Results are committed as
`evals/results/<date>-<label>.json` and listed on the guide page "Does it
help agents" (`docs/guide/evals.md`), which says so while there are none.

## Run it

```bash
# Check that every task and variant can be prepared. No agent, no Docker.
node evals/run.mjs --dry-run

# One command for a real run: all tasks, all variants, three runs each.
node evals/run.mjs --agent "claude -p {prompt} --permission-mode acceptEdits" \
  --label claude-code --model "<model name as the vendor states it>" --runs 3

# Codex CLI, one task, keep the working directories for inspection
node evals/run.mjs --agent "codex exec --full-auto {prompt}" --label codex-cli \
  --model "<model name>" --task related-work --variant bare,instructions --runs 3 --keep
```

Options:

| Option | Meaning |
| --- | --- |
| `--agent "<cmd>"` | Command that runs the agent on the host inside the project folder. `{prompt}` is replaced by the shell-quoted prompt. Do not put secrets in it: it is recorded in the results file. |
| `--label <name>` | Required. Short name of the agent setup; becomes part of the file name. |
| `--model <text>` | Free text, recorded as given (for example the exact model identifier and any effort setting). |
| `--runs <n>` | Runs per task and variant (default 1). Use 3 or more: one run says little. |
| `--variant` | `bare`, `instructions`, `guard`, a comma list, or `all` (default). `kit` is an alias of `instructions`. |
| `--task <id>` | Only this task; repeatable. |
| `--image <ref>` | Overfull image used for scoring (default `ghcr.io/amet13/overfull:3`, or `OVERFULL_IMAGE`). |
| `--keep` | Keep the working directories and print their paths. |
| `--out <dir>` | Where to write results (default `evals/results`). |
| `--dry-run` | Validate and prepare everything, call nothing. Needs `git` only. |

Scoring needs Docker. The agent runs on the host, so the agent command and its
credentials are yours to set up. The `guard` variant calls `overfull guard
--hook` from the agent's hook, so `overfull` must be on the `PATH` of the
machine that runs the agent.

## Variants

| Variant | What the agent finds in the project |
| --- | --- |
| `bare` | The template without `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.agents/`, `.claude/`, `.cursor/` and the Copilot instructions. |
| `instructions` | `AGENTS.md` and the skills, as the template ships them, without hook configuration. (`kit` is the old name.) |
| `guard` | `instructions` plus the Claude Code hook configuration the template ships in `.claude/settings.json`. When the template ships no such file, or it configures no hooks, the run is done as `instructions` and the result records a note and `effectiveVariant: "instructions"`. |

Tasks that start from an existing project instead of a template
(`adopt-existing-project`) get the agent files of the `paper` template in the
`instructions` and `guard` variants, which is what `overfull init --here
--agents` adds.

## Tasks

Tasks live in `evals/tasks/<id>.json`, one file per task.

| Task | Starts from | What it asks |
| --- | --- | --- |
| `fix-broken-build` | paper, broken by two edits | Find and fix a missing input file and an undefined command. |
| `add-five-citations` | paper, `notes/sources.md` | Add five works from a notes file in which two DOIs are wrong. |
| `fit-page-limit` | paper, limit set to 3 pages | Fit the main text without touching fonts, margins or spacing. |
| `anonymize-for-review` | paper, anonymous mode on | Remove identifying text and links, keep a copy for the camera-ready version. |
| `prepare-arxiv` | paper, `arxiv` profile, one absolute path | Make the source build on arXiv. |
| `adopt-existing-project` | `packages/cli/test/fixtures/adopt/acm-biblatex` | Set up an existing project without changing it. |
| `add-alt-text` | paper, two figures without alt text | Give each figure accurate alt text. |
| `respond-to-reviewer` | paper, `notes/reviews.md` | Address a comment that needs one new reference, and write the response. |
| `add-figure` | paper, `figures/data/latency.csv` | Plot a data file with alt text and a reference from the text. |
| `write-disclosure` | paper, disclosure required | Write the AI-use statement from stated facts only. |
| `fix-refs-and-labels` | paper, one undefined reference, one duplicate label | Fix both. |
| `switch-to-published-version` | paper, an arXiv entry that has been published | Switch the entry to the published version, keeping the key. |
| `related-work` | paper | Write a related-work section with the three original papers cited. |

No bibliographic data in a task is written from memory. The reading list and the
reviewer comment are generated from entries in
`packages/core/test/fixtures/refs/real.bib` (recorded from the indexes); the wrong
DOIs are those entries' DOIs with the last digit replaced by the next digit. The
preprint of `switch-to-published-version` comes from `evals/fixtures/preprint.bib`,
found with `evals/fixtures/collect-preprint.mjs` (an arXiv record that names its
published DOI, and the lookup of both forms).

### Task format

```jsonc
{
  "id": "fix-broken-build",               // = file name
  "title": "…",
  "prompt": "…",                          // given to the agent as is
  "template": "paper",                    // a folder in templates/ …
  "project": "packages/cli/test/…",       // … or any folder in the repository (exactly one of the two)
  "setup":  { "overfull.yml": { … } },    // YAML files, the object is deep-merged into them
  "edits":  [ { "file": "main.tex", "find": "…", "replace": "…" } ],   // literal; "find" must occur exactly once
  "write":  {                             // files to create (or append to)
    "figures/data/x.csv": "text",
    "notes/sources.md": { "generate": "reading-list", "keys": [ … ], "wrongDoi": [ … ] },
    "references.bib": { "generate": "fixture-entry", "append": true, "from": "…", "key": "…", "as": "…", "drop": [ … ] }
  },
  "allowed":   [ "sections/**", "references.bib" ],   // globs the agent may change (required)
  "tolerated": [ "notes/**" ],            // optional: changes that are not failures, but whose prose is bounded
  "maxAddedLines": 12,                    // optional: lines the agent may add inside the allowed files
  "maxOutsideAddedLines": 0,              // prose lines allowed outside the allowed files (default 0)
  "expect": {
    "status": [ "pass", "warn" ],         // allowed overall statuses of `overfull check`
    "maxErrors": 0,
    "noRules": [ "missing-file" ],        // rules that must not fire
    "citedAtLeast": 13,                   // optional: cited entries in the bibliography check
    "maxUnverified": 0,                   // optional (default 0): cited entries that are fabricated or unverified
    "files": [ "notes/response.md" ],     // files that must exist
    "contains":    [ { "file": "references.bib", "pattern": "{{doi:lamport1978time}}", "flags": "i" } ],
    "notContains": [ { "file": "references.bib", "pattern": "{{wrongdoi:dean2008mapreduce}}" } ]
  }
}
```

Globs: `*` matches within one folder, `**` any depth (`sections/**`), `?` one
character; paths are relative to the project. In `pattern`, `{{doi:KEY}}` and
`{{wrongdoi:KEY}}` expand to the recorded and the altered DOI of fixture entry
`KEY`, regex-escaped. Generators: `reading-list`, `reviewer-comment`,
`fixture-entry` (see `evals/lib/generate.mjs`).

`--dry-run` checks all of it: the template or project exists, every edit finds
its text exactly once, every generator runs, every glob and pattern parses.

## Scoring

Each run records two verdicts and the numbers behind them.

- `pass`: the `expect` block holds (check status, errors, rules, cited count,
  file contents). This is the question "does the check pass".
- `clean`: `pass`, and also
  - no cited entry is fabricated or unverified, from the check report
    (`fabricated`: not found in any index, not added by `overfull cite`, or an
    identifier that belongs to another work; `unverified`: found with
    different metadata, or the lookup did not complete). Bound:
    `maxUnverified`, default 0;
  - no changed file outside `allowed` (and `tolerated`). Build products
    (`*.pdf`, `*.aux`, `*.log`, `.overfull/` and similar) are ignored;
  - prose added outside the allowed files is within `maxOutsideAddedLines`
    (default 0): lines added to `.tex`, `.md`, `.txt`, `.rst` and `.bib` files
    the task did not ask to change. It is a cheap signal for invented content
    and says nothing about whether the content is correct;
  - lines added inside the allowed files are within `maxAddedLines`, where a
    task sets one.

The per-run record also holds the lists of fabricated and unverified keys, the
files changed outside the allowed set, the lines added, the seconds, the agent's
exit code and any variant note.

## Results file

`evals/results/<date>-<label>.json`: `date`, `label`, `model` (verbatim),
`agentCommand`, `image`, `runsPerCell`, `variants`, `tasks`, and

- `summary`: one row per task and variant with `n`, `pass` and `clean`
  as `{k, n, rate, low, high}` (Wilson 95% interval, computed in
  `evals/lib/stats.mjs` and unit-tested), the mean number of fabricated or
  unverified cited entries, mean files outside, mean prose lines outside, mean seconds;
- `byVariant`: the same, pooling all tasks of a variant;
- `results`: every run.

With a handful of runs per cell the intervals are wide; read them. Pooling
tasks treats runs of different tasks as one sample, which they are not: the
per-task rows are the evidence, the pooled row is a summary.

Agents cost money to run, so evals are not part of CI; only `--dry-run` is.
Publish numbers with the agent, model and date they were measured with, as the
results file records them.
