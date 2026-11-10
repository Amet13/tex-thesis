---
title: CLI reference
description: Every overfull command and flag, exit codes, the --json output of each command, and the JSON report schema with an example.
order: 40
section: Reference
---

```text
overfull init [thesis|paper|slides] [dir] [--force] [--no-git] [--json]
overfull build [main.tex] [--engine auto|local|docker] [--image name] [--verbose] [--force]
               [--json] [--config file]
overfull check [file...] [--main file] [--checks a,b] [--profile p] [--offline] [--refresh]
               [--fail-on error|warning|never]
               [--json | --markdown | --annotations | --sarif] [--verbose]
               [--pdf file] [--log file] [--aux file] [--bib a.bib,b.bib]
               [--mailto address] [--no-verapdf] [--engine auto|local|docker] [--image name]
               [--config file]
overfull cite <doi | arXiv:id | "title"> [--bib file] [--key k] [--author name] [--year yyyy]
              [--dry-run] [--json] [--mailto addr] [--config file]
overfull pages <range> [--main file] [--pdf file] [--out dir] [--dpi n] [--json] [--config file]
overfull diff [--base ref] [--main file] [--out file] [--engine auto|local|docker] [--json]
              [--config file]
overfull explain <rule> [--json]
overfull explain --list [--json]
overfull doctor [--json] [--config file]
overfull mcp [--cwd dir]
```

`overfull --version` prints the version (3.0.0). `overfull <command> --help` (or
`-h`) prints the options of one command.

Every command takes `--json` and then prints JSON on stdout. See
[JSON output](#json-output) for the shape of each one.

Commands read `overfull.yml` in the current directory for the main file, job
name, bibliography, profile and checks. Flags override it for one run. See
[Configuration](./config.md).

## init

```sh
overfull init paper my-paper
```

Copies a template (`thesis`, `paper` or `slides`) into `dir`. The template
defaults to `thesis` and `dir` to `./<template>`. `overfull init my-thesis`
creates the thesis template in `my-thesis`. Each template includes
`overfull.yml`, a Makefile, a GitHub workflow, `AGENTS.md` and skills.

| Flag | Effect |
| --- | --- |
| `--force` | Copy into a directory that is not empty. Existing files are overwritten. |
| `--no-git` | Do not run `git init`. By default a new project outside a Git repository gets `git init -b main` and, when `user.name` and `user.email` are set, an initial commit. |
| `--json` | Print `{template, dir, git}`. |

To add Overfull to a project you already have, run `overfull init --here` in
its folder (alias `overfull adopt`). It detects the main file, engine,
bibliography and venue style file, writes `overfull.yml`, and never touches a
`.tex` or `.bib` file. Options: `--main <file>`, `--agents`, `--ci`, `--make`,
`--hooks`, `--all`, `--force`, `--dry-run`; `--json` prints `{detected, written, skipped}`.
See [Add Overfull to an existing project](./existing-project.md).

## build

```sh
overfull build
overfull build main.tex --engine docker
```

Compiles the document with `latexmk`, then checks the build log and the PDF
(the `build` and `output` checks) and prints the report. `main.tex` defaults to
`main` in `overfull.yml`.

`--engine auto` (the default) uses a local `latexmk` if one is found and the
Docker image otherwise. `local` and `docker` force one. Without a `.latexmkrc`,
Overfull runs `latexmk -lualatex`. If the project has a `.latexmkrc` (all
templates do), `latexmk` follows it.

| Flag | Effect |
| --- | --- |
| `--engine e` | `auto` (default), `local` or `docker`. |
| `--image name` | Docker image. Overrides `$OVERFULL_IMAGE` and `build.image`. |
| `--verbose`, `-v` | Show `latexmk` output and the fix for each problem. |
| `--force` | Rebuild even when nothing changed since the last build. |
| `--json` | Print the report as JSON, the same shape as `overfull check --json` (schema below). |
| `--config file` | Config file (default `overfull.yml`). |

When no source changed since the last good build (the main file, the `.bib`
files, the other inputs `latexmk` recorded, and `.latexmkrc`), and the log shows
nothing left to rerun, `build` does not start `latexmk`. It prints
`<main> is up to date` on stderr and reports on the existing log and PDF. Use
`--force` to run `latexmk` anyway (it passes `-g`).

Output goes to `build.outDir` from `overfull.yml` (passed as `-outdir` and
`-auxdir`), else the `$out_dir` of a `.latexmkrc`, else the project folder.
Only build projects you trust: a `.latexmkrc` is Perl code that `latexmk` runs.

Without `--image`, the image is `$OVERFULL_IMAGE` if set, else `build.image`
from `overfull.yml`, else `ghcr.io/amet13/overfull:3`. Exit codes: 0 built,
1 build failed, 2 usage error. With `--json`, a build that fails before LaTeX
writes a log prints `{"error": {"code": "build-failed", "message", "exitCode"}}`.

## check

```sh
overfull check
overfull check --json
overfull check --checks build,output --fail-on warning
overfull check --profile arxiv
overfull check paper.tex
overfull check refs.bib
```

Runs the checks on the output of the last build. It reads `<jobname>.log`,
`<jobname>.pdf` and `<jobname>.aux` and the `.bib` files, and does not build
anything.

Without `overfull.yml` and without `main:`, the main file is `main.tex` if it
exists. Otherwise it is the one `.tex` file in the project folder (not in
subfolders) with an uncommented `\documentclass`; the jobname is its name without
`.tex`. If several files qualify, the one with a matching `.log` or `.pdf` is
used; if that does not decide it, `check` exits with 2 and lists the candidates.
Pick one with `--main file.tex` or set `main:` in `overfull.yml`. When there is
no `overfull.yml`, `check` prints one line on stderr (not with `--json`,
`--markdown` or `--annotations`) saying which main file and profile it assumed,
and the JSON report gains an `assumed` object.

Files can be given as arguments. A `.tex` file is the main file (like `--main`);
`.bib`, `.log`, `.pdf` and `.aux` files work like `--bib`, `--log`, `--pdf` and
`--aux`. When only `.bib` files are given, only the references check runs, on
those files. Any other extension is a usage error (exit 2).

| Flag | Effect |
| --- | --- |
| `--main file` | Main `.tex` file. Overrides `main:` in `overfull.yml` and detection. `pages` and `diff` take it too. |
| `--checks a,b` | Run only these checks: `build`, `output`, `references`, `accessibility`, `venue`. |
| `--profile p` | Use this venue profile instead of the one in `overfull.yml`: `generic`, `thesis`, `paper`, `arxiv`, `double-blind`. |
| `--offline` | Do not look references up online. The references check is skipped. Missing keys and `.bib` syntax errors are still reported. |
| `--refresh` | Ignore cached reference answers and look every reference up again. The new answers are still written to the cache. |
| `--fail-on level` | `error` (default), `warning` or `never`. |
| `--json` | Print the report as JSON (schema below). |
| `--markdown` | Print a Markdown summary, for PR comments and job summaries. |
| `--annotations` | Print GitHub workflow annotations. |
| `--sarif` | Print a SARIF 2.1.0 log, for GitHub code scanning (see [the Action](./action.md#code-scanning-sarif)). Problems without a source file point at the main file, line 1. |
| `--verbose`, `-v` | Show why each problem happened and how to fix it. |
| `--pdf file` | PDF to check (default `<jobname>.pdf`). |
| `--log file` | Build log (default `<jobname>.log`). |
| `--aux file` | `.aux` file (default `<jobname>.aux`). |
| `--bib a.bib,b.bib` | Bibliography files (default: `bib` in `overfull.yml`, else the files named in `main.tex`). |
| `--mailto address` | Contact address for CrossRef's polite pool. |
| `--no-verapdf` | Do not run veraPDF, even if it is installed. |
| `--engine e` | Where veraPDF and `pdffonts` run when they are not installed: `auto` (the Overfull image, when Docker already has it), `docker` or `local`. |
| `--image name` | Docker image for veraPDF and `pdffonts`. Default: `$OVERFULL_IMAGE`, else `ghcr.io/amet13/overfull:3`. |
| `--config file` | Config file (default `overfull.yml`). |

Use only one of `--json`, `--markdown`, `--annotations` and `--sarif`; combining them is a usage error (exit 2). The exit code is the same for every format.

On an interactive terminal, the references check shows one updating line (`references 12/31`) on stderr. It is not shown in CI, when stderr is redirected, or with `--json`, `--markdown`, `--annotations` or `--sarif`.

If `verapdf` is on
the `PATH`, the accessibility check runs it (PDF/UA-2, falling back to PDF/UA-1
for PDFs older than 2.0). Without it, the check reports `verapdf-not-run` as
`info`.

`check` never uses `build.image` from `overfull.yml`. A project that is only
checked must not choose which container image runs on your machine, so the
image comes from `--image`, `$OVERFULL_IMAGE` or the default. (`build`, `diff`
and `pages` do use `build.image`; only build projects you trust.)

## cite

```sh
overfull cite 10.1145/3442188.3445922
overfull cite arXiv:1706.03762 --key vaswani2017
overfull cite "Attention Is All You Need" --dry-run
```

Looks up a DOI, an arXiv id or a title in CrossRef, doi.org, arXiv and DBLP, and
appends a BibTeX entry built from the indexed record to the bibliography. OpenAlex
is also searched for titles when the `OPENALEX_API_KEY` environment variable is
set. Prints the citation key as its last line.

| Flag | Effect |
| --- | --- |
| `--bib file` | Write to this file (default: the first file in `bib`, else `references.bib`). |
| `--key k` | Use this citation key. |
| `--author name` | Narrow a title query to works with this author surname. |
| `--year yyyy` | Narrow a title query to works from this year (±1). |
| `--dry-run` | Print the entry, write nothing. |
| `--json` | Print `{key, entry, source, confidence, added, bib}`. Ambiguous and not-found results have their own shapes (see below). |
| `--mailto addr` | Contact address for CrossRef's polite pool. |
| `--config file` | Config file (default `overfull.yml`). |

The file given with `--bib` (or the first `bib` file) must be inside the project,
also after resolving symlinks.

Every entry `cite` writes ends with a provenance marker:

```bibtex
  x-overfull = {cite doi.org 2026-11-09 514dc6c201be}
```

The last part is a hash over the entry's type, key, title, authors, year, DOI and
eprint. It makes later edits evident. It is not authentication: anyone can
recompute it. With `references.requireCite`, an entry without an intact marker
is reported as `reference-unproven`. See [References](./references.md#provenance).

If no confident match is found, nothing is written and the command exits with 1.
If the work is already in the bibliography (same DOI, same arXiv id, or same key
and title), nothing is written, the existing key is printed and the command exits
with 0. `cite` never edits or replaces an existing entry. If `--key` names a key
that a different entry already uses, the command exits with 2.

Short or shared titles are ambiguous: for example, several works are titled
"Literate Programming". Then cite lists the candidates with their DOIs, writes
nothing and exits with 1. Cite the right one by DOI, or rerun with `--author`
or `--year`:

```sh
overfull cite "Literate programming" --author Knuth
```

## pages

```sh
overfull pages 3
overfull pages 2-4 --dpi 150 --out .overfull/pages
```

Renders PDF pages to PNG images and prints their paths. The range is a page
(`3`), a range (`2-5`), a list (`1,4,7`) or an open range (`8-`, to the last
page). Useful for agents that can read images, and for quick looks. It uses
`pdftoppm` if installed, otherwise the Docker image.

| Flag | Effect |
| --- | --- |
| `--pdf file` | Render this PDF (default `<jobname>.pdf`). |
| `--out dir` | Write images here (default `.overfull/pages`; files are named `page-<n>.png`). Must be inside the project, also after resolving symlinks. |
| `--dpi n` | Resolution (default 110). |
| `--json` | Print `{pages: [{page, file}]}`. |
| `--config file` | Config file (default `overfull.yml`). |

## diff

```sh
overfull diff --base main
overfull diff --base submitted-v1 --main main.tex
```

Builds a PDF with changes since a Git ref highlighted, using `latexdiff`. Use it
to review an agent's pull request or to send a marked-up revision to reviewers.
Prints the path of the PDF. The project must be in a Git repository.

| Flag | Effect |
| --- | --- |
| `--base ref` | Revision to compare with. Default: the merge base with `origin/main`, else `HEAD~1`. |
| `--main file` | Main `.tex` file (default `main` in `overfull.yml`). |
| `--out file` | Output PDF (default `overfull-diff.pdf`). Must be inside the project, also after resolving symlinks. |
| `--engine e` | `auto` (default), `local` or `docker`. |
| `--json` | Print `{pdf, base, sha, complete}`. `complete` is `false` when the diff document had LaTeX errors and the PDF may be incomplete. |
| `--config file` | Config file (default `overfull.yml`). |

## explain

```sh
overfull explain undefined-reference
overfull explain --list
overfull explain verapdf-8-2-5-26 --json
```

Prints what a rule means and how to fix it. Every rule id in a report can be
explained. veraPDF failures have ids of the form `verapdf-<clause>`. An unknown
id prints suggestions and exits with 2 (with `--json`, as a usage error).

| Flag | Effect |
| --- | --- |
| `--list` | List every rule id with its check and title. |
| `--json` | Print the rule (or, with `--list`, an array of all rules) as JSON. |

## doctor

```sh
overfull doctor
overfull doctor --json
```

Reports which tools are available (Node.js, latexmk, LuaLaTeX, Biber, poppler,
veraPDF, latexdiff, Git, Docker), whether the Docker image is pulled, whether
`api.crossref.org` answers (any HTTP response prints "reachable"; `--json` also
has the status code), whether `overfull.yml` is valid, and what is
disabled without each missing tool. It exits with 1 when nothing can build the
document: no local TeX Live (`latexmk`) and no usable Docker image. Other missing
tools only limit what can run, and the exit code stays 0. `--json` prints
`{"canBuild", "message", "items": [{"name", "ok", "detail", "needFor"?, "status"?}]}`.
`--config file` checks a different config file.

## guard

```sh
overfull guard --staged            # git pre-commit hook
overfull guard --staged --offline
overfull guard --hook              # agent pre-tool-use hook, reads JSON on stdin
```

Blocks hand-written bibliography entries when they happen. `--staged` reads the
staged changes to `.bib` files and checks each entry that was added or changed.
An entry passes when it has a valid `overfull cite` marker, carries
`note = {overfull: author-provided}` or `overfull: skip`, or is found in the
indexes. Removed entries and whitespace or field-order changes pass. Otherwise
the commit is refused and the file, key and the `overfull cite` command to use
are printed. It works before the first commit. `--hook` answers an AI agent's
hook and denies direct writes to `.bib` files by the agent's file tools; anything
it does not recognise is allowed. See [Guard](./with-an-agent.md#guard).

| Flag | Effect |
| --- | --- |
| `--staged` | Check the staged `.bib` changes. |
| `--hook [claude\|gemini]` | Answer a hook payload from stdin. Without a name, the harness is detected from the payload. |
| `--offline` | With `--staged`: do not ask the indexes. |
| `--json` | With `--staged`: print `{status, files, checked, passed, blocked}`. |

Exit codes: 0 pass, 1 blocked, 2 usage or internal error. `--hook` always exits 0.

## mcp

```sh
overfull mcp
overfull mcp --cwd /path/to/project
```

Runs Overfull as a Model Context Protocol server on stdin and stdout, for AI
tools that have no shell. An MCP client starts it; you do not run it by hand.
It offers the tools `check`, `cite`, `explain`, `pages` and `doctor`, with the
same results as the commands' `--json` output. It works on the folder it was
started in, or on `--cwd`, and never on a folder or an output path chosen by the
client. See [Using Overfull over MCP](./mcp.md).

| Flag | Effect |
| --- | --- |
| `--cwd dir` | The project folder. Default: the current directory. |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success. For `check`: pass, or warnings without `--fail-on warning`; always 0 with `--fail-on never`. `doctor`: 0 when something can build the document. |
| 1 | Problems found. For `check`: at least one error (or warning with `--fail-on warning`). For `build`: the build failed. For `cite`: no confident match, or an ambiguous title. For `pages` and `diff`: rendering or building the PDF failed. For `doctor`: nothing can build the document. |
| 2 | Usage error (bad flag, missing file, unknown rule or profile, invalid `overfull.yml`) or internal error. Set `OVERFULL_DEBUG=1` for a stack trace. |

Under `--json`, a usage or internal error is also JSON on stdout (see below), with
the same exit code 2.

## JSON output

Every command prints JSON on stdout with `--json`:

| Command | Output |
| --- | --- |
| `check`, `build` | A `Report` (below). |
| `init` | `{template, dir, git}`; `git` is a note, or `null`. |
| `cite` | `{key, entry, source, confidence, added, bib}`. Ambiguous title: `{ambiguous: true, message, candidates}`. No match or no network: `{found: false, query, searched, failures, message}`. Both exit with 1. |
| `pages` | `{pages: [{page, file}]}`. |
| `diff` | `{pdf, base, sha, complete}`. |
| `explain <rule>` | `{id, check, severity, title, summary, fix, corpus?}`. With `--list`, an array of these. |
| `doctor` | `{canBuild, message, items: [{name, ok, detail, needFor?, status?}]}`. `status` is the HTTP status of the CrossRef probe. |

Failures that the command itself reports (a failed build, a page that cannot be
rendered, a diff that cannot be built) print `{"error": {"code", "message"}}` and
exit with 1. The codes are `build-failed` (also `exitCode`), `render-failed` (also
`page`) and `diff-failed`. Usage errors (bad flag, missing file, unknown rule,
invalid `overfull.yml`) and internal errors print
`{"error": {"code": "usage" | "internal", "message"}}` and exit with 2. A script
can read stdout as JSON in every case and use the exit code for the verdict.

`overfull check --json` and `overfull build --json` print a `Report`. The schema
is stable; fields may be added, never renamed.

```json
{
  "tool": "overfull",
  "version": "3.0.0",
  "target": "paper.pdf",
  "status": "fail",
  "checks": [
    {
      "check": "build",
      "status": "pass",
      "summary": "Build succeeded (paper.pdf, 8 pages)",
      "problems": []
    },
    {
      "check": "references",
      "status": "fail",
      "summary": "11 of 12 references verified (1 not found)",
      "stats": { "error": 0, "mismatch": 0, "notFound": 1, "total": 12, "unverifiable": 0, "verified": 11 },
      "problems": [
        {
          "rule": "reference-not-found",
          "check": "references",
          "severity": "error",
          "message": "`lee2023deep` was not found in CrossRef, dblp or arXiv",
          "location": { "file": "references.bib", "line": 88 },
          "detail": "Searched CrossRef, dblp or arXiv: no similar record. The reference may be mistyped or may not exist; Overfull cannot tell which.",
          "fix": "Check the DOI and title against the publisher page, or re-add it from real metadata with `overfull cite \"Deep Graph Transformers\"`. If it is real but unindexed, add `note = {overfull: skip}`.",
          "data": { "key": "lee2023deep", "status": "not-found" }
        }
      ]
    },
    {
      "check": "accessibility",
      "status": "skipped",
      "skippedReason": "No paper.pdf — run `overfull build` first",
      "problems": []
    }
  ]
}
```

Keys are written in this order. Optional fields are left out when empty, and
the object keys inside `stats` and `data` are sorted. The example is shortened:
a real report has one entry per check that ran.

| Field | Type | Notes |
| --- | --- | --- |
| `tool` | `"overfull"` | |
| `version` | string | Overfull version. |
| `target` | string? | The PDF that was checked, or the main file when there is no PDF. |
| `assumed` | object? | Only when there is no `overfull.yml`: `{main, mainSource, jobname, profile, bib}`, what the run assumed. `mainSource` is `--main`, `main.tex`, `detected` or `default`. |
| `status` | `pass` \| `warn` \| `fail` | Worst status of the checks that ran. Skipped checks do not count. |
| `checks[].check` | string | `build`, `output`, `references`, `accessibility`, `venue`. |
| `checks[].status` | `pass` \| `warn` \| `fail` \| `skipped` | `skipped` has `skippedReason`. |
| `checks[].summary` | string? | Short human summary. |
| `checks[].skippedReason` | string? | Present when `status` is `skipped`. |
| `checks[].stats` | object? | Counters. |
| `problems[].rule` | string | Stable kebab-case id. See `overfull explain --list`. |
| `problems[].check` | string | The check that reported it. |
| `problems[].severity` | `error` \| `warning` \| `info` | |
| `problems[].message` | string | One line. |
| `problems[].location` | `{ file?, line?, page? }` | File paths are relative to the project root. |
| `problems[].detail` | string? | Why it happened. |
| `problems[].fix` | string? | What to do. |
| `problems[].related` | number? | Follow-on problems folded into this one. |
| `problems[].evidence` | string? | Raw log lines or bib entry. |
| `problems[].data` | object? | Machine-readable extras (keys, measurements). |
