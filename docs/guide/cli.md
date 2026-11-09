---
title: CLI reference
description: Every overfull command and flag, exit codes, and the JSON report schema with an example.
order: 40
section: Reference
---

```text
overfull init [thesis|paper|slides] [dir] [--force]
overfull build [main.tex] [--engine auto|local|docker] [--image name] [--verbose] [--config file]
overfull check [--checks a,b] [--profile p] [--offline] [--fail-on error|warning|never]
               [--json | --markdown | --annotations] [--verbose]
               [--pdf file] [--log file] [--aux file] [--bib a.bib,b.bib]
               [--mailto address] [--no-verapdf] [--config file]
overfull cite <doi | arXiv:id | "title"> [--bib file] [--key k] [--author name] [--year yyyy]
              [--dry-run] [--json] [--mailto addr] [--config file]
overfull pages <range> [--pdf file] [--out dir] [--dpi n] [--config file]
overfull diff [--base ref] [--main file] [--out file] [--engine auto|local|docker] [--config file]
overfull explain <rule> [--json]
overfull explain --list [--json]
overfull doctor [--json] [--config file]
```

`overfull --version` prints the version. `overfull <command> --help` (or `-h`)
prints the options of one command.

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
| `--config file` | Config file (default `overfull.yml`). |

Without `--image`, the image is `$OVERFULL_IMAGE` if set, else `build.image`
from `overfull.yml`, else `ghcr.io/amet13/overfull:3`. Exit codes: 0 built,
1 build failed, 2 usage error.

## check

```sh
overfull check
overfull check --json
overfull check --checks build,output --fail-on warning
overfull check --profile arxiv
```

Runs the checks on the output of the last build. It reads `<jobname>.log`,
`<jobname>.pdf` and `<jobname>.aux` and the `.bib` files, and does not build
anything.

| Flag | Effect |
| --- | --- |
| `--checks a,b` | Run only these checks: `build`, `output`, `references`, `accessibility`, `venue`. |
| `--profile p` | Use this venue profile instead of the one in `overfull.yml`: `generic`, `thesis`, `paper`, `arxiv`, `double-blind`. |
| `--offline` | Do not look references up online. The references check is skipped. Missing keys and `.bib` syntax errors are still reported. |
| `--fail-on level` | `error` (default), `warning` or `never`. |
| `--json` | Print the report as JSON (schema below). |
| `--markdown` | Print a Markdown summary, for PR comments and job summaries. |
| `--annotations` | Print GitHub workflow annotations. |
| `--verbose`, `-v` | Show why each problem happened and how to fix it. |
| `--pdf file` | PDF to check (default `<jobname>.pdf`). |
| `--log file` | Build log (default `<jobname>.log`). |
| `--aux file` | `.aux` file (default `<jobname>.aux`). |
| `--bib a.bib,b.bib` | Bibliography files (default: `bib` in `overfull.yml`, else the files named in `main.tex`). |
| `--mailto address` | Contact address for CrossRef's polite pool. |
| `--no-verapdf` | Do not run veraPDF, even if it is installed. |
| `--config file` | Config file (default `overfull.yml`). |

Use only one of `--json`, `--markdown` and `--annotations`. If `verapdf` is on
the `PATH`, the accessibility check runs it (PDF/UA-2, falling back to PDF/UA-1
for PDFs older than 2.0). Without it, the check reports `verapdf-not-run` as
`info`.

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
| `--json` | Print `{key, entry, source, confidence, added, bib}`, or `{ambiguous, message, candidates}`. |
| `--mailto addr` | Contact address for CrossRef's polite pool. |
| `--config file` | Config file (default `overfull.yml`). |

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
| `--out dir` | Write images here (default `.overfull/pages`; files are named `page-<n>.png`). |
| `--dpi n` | Resolution (default 110). |
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
| `--out file` | Output PDF (default `overfull-diff.pdf`). |
| `--engine e` | `auto` (default), `local` or `docker`. |
| `--config file` | Config file (default `overfull.yml`). |

## explain

```sh
overfull explain undefined-reference
overfull explain --list
overfull explain verapdf-8-2-5-26 --json
```

Prints what a rule means and how to fix it. Every rule id in a report can be
explained. veraPDF failures have ids of the form `verapdf-<clause>`. An unknown
id prints suggestions and exits with 2.

| Flag | Effect |
| --- | --- |
| `--list` | List every rule id with its check and title. |
| `--json` | Print the rule (or, with `--list`, all rules) as JSON. |

## doctor

```sh
overfull doctor
overfull doctor --json
```

Reports which tools are available (Node.js, latexmk, LuaLaTeX, Biber, poppler,
veraPDF, latexdiff, Git, Docker), whether the Docker image is pulled, whether
`api.crossref.org` is reachable, whether `overfull.yml` is valid, and what is
disabled without each missing tool. It always exits with 0. `--json` prints
`{"items": [{"name", "ok", "detail", "needFor"?}]}`. `--config file` checks a
different config file.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success. For `check`: pass, or warnings without `--fail-on warning`; always 0 with `--fail-on never`. `doctor` always exits with 0. |
| 1 | Problems found. For `check`: at least one error (or warning with `--fail-on warning`). For `build`: the build failed. For `cite`: no confident match, or an ambiguous title. For `pages` and `diff`: rendering or building the PDF failed. |
| 2 | Usage error (bad flag, missing file, unknown rule or profile, invalid `overfull.yml`) or internal error. Set `OVERFULL_DEBUG=1` for a stack trace. |

## JSON output

`overfull check --json` prints a `Report`. The schema is stable; fields may be
added, never renamed.

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
