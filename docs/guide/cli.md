---
title: CLI reference
description: Every overfull command and flag, exit codes, and the JSON report schema with an example.
order: 40
section: Reference
---

```text
overfull init [thesis|paper|slides] [dir]
overfull build [main.tex] [--engine auto|local|docker]
overfull check [--json|--markdown] [--checks a,b] [--profile p] [--offline] [--fail-on error|warning]
overfull cite <doi | arXiv:id | "title"> [--bib file] [--key k] [--dry-run]
overfull pages <range> [--pdf file] [--out dir] [--dpi n]
overfull diff [--base ref] [--main main.tex]
overfull explain <rule>
overfull doctor
```

Commands read `overfull.yml` in the current directory for the main file, job
name, bibliography, profile and checks. Flags override it for one run. See
[Configuration](./config.md).

## init

```sh
overfull init paper my-paper
```

Copies a template (`thesis`, `paper` or `slides`) into `dir`. Each template
includes `overfull.yml`, a Makefile, a GitHub workflow, `AGENTS.md` and skills.

## build

```sh
overfull build
overfull build main.tex --engine docker
```

Compiles the document with `latexmk`. `--engine auto` (the default) uses a local
`latexmk` if one is found and the Docker image otherwise. `local` and `docker`
force one. The image is set by `build.image` in `overfull.yml`.

## check

```sh
overfull check
overfull check --json
overfull check --checks build,output --fail-on warning
overfull check --profile arxiv
```

Runs the checks on the output of the last build.

| Flag | Effect |
| --- | --- |
| `--json` | Print the report as JSON (schema below). |
| `--markdown` | Print a Markdown report, for PR comments and job summaries. |
| `--checks a,b` | Run only these checks: `build`, `output`, `references`, `accessibility`, `venue`. |
| `--profile p` | Use this venue profile instead of the one in `overfull.yml`. |
| `--offline` | Make no network requests. The references check is skipped. |
| `--fail-on error\|warning` | Exit with 1 on errors (default), or also on warnings. |

## cite

```sh
overfull cite 10.1145/3442188.3445922
overfull cite arXiv:1706.03762 --key vaswani2017
overfull cite "Attention Is All You Need" --dry-run
```

Looks up a DOI, an arXiv id or a title, and appends a BibTeX entry built from the
indexed record to the bibliography. Prints the citation key.

| Flag | Effect |
| --- | --- |
| `--bib file` | Write to this file (default: the first file in `bib`). |
| `--key k` | Use this citation key. |
| `--dry-run` | Print the entry, write nothing. |

If no confident match is found, nothing is written and the command exits with 1.

## pages

```sh
overfull pages 3
overfull pages 2-4 --dpi 150 --out .overfull/pages
```

Renders PDF pages to PNG images and prints their paths. Useful for agents that
can read images, and for quick looks in a terminal.

| Flag | Effect |
| --- | --- |
| `--pdf file` | Render this PDF (default: the job's output PDF). |
| `--out dir` | Write images here. |
| `--dpi n` | Resolution. |

## diff

```sh
overfull diff --base main
overfull diff --base submitted-v1 --main main.tex
```

Builds a PDF with changes since a Git ref highlighted, using `latexdiff`. Use it
to review an agent's pull request or to send a marked-up revision to reviewers.
Prints the path of the PDF.

## explain

```sh
overfull explain undefined-reference
```

Prints what a rule means, why it happens and how to fix it. Every rule id in a
report can be explained.

## doctor

Reports the Overfull version and which tools are available (latexmk, LuaLaTeX,
Biber, Docker, veraPDF, latexdiff, poppler), and what is disabled without each.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Pass, or warnings without `--fail-on warning`. |
| 1 | Fail: at least one error (or warning with `--fail-on warning`). For `cite`: no confident match. |
| 2 | Usage error or internal error. |

## JSON output

`overfull check --json` prints a `Report`. The schema is stable; fields may be
added, never renamed.

```json
{
  "tool": "overfull",
  "version": "0.1.0",
  "target": "paper.pdf",
  "status": "fail",
  "checks": [
    {
      "check": "build",
      "status": "pass",
      "problems": []
    },
    {
      "check": "references",
      "status": "fail",
      "summary": "11 of 12 references verified",
      "stats": { "verified": 11, "notFound": 1 },
      "problems": [
        {
          "rule": "reference-not-found",
          "check": "references",
          "severity": "error",
          "message": "No indexed record matches \"Deep Graph Transformers\" (2023)",
          "location": { "file": "references.bib", "line": 88 },
          "fix": "Check the title or add a DOI. If the work does not exist, remove the entry and its citations.",
          "data": { "key": "lee2023deep" }
        }
      ]
    },
    {
      "check": "accessibility",
      "status": "skipped",
      "skippedReason": "No PDF found. Run overfull build first.",
      "problems": []
    }
  ]
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `status` | `pass` \| `warn` \| `fail` | Worst status of the checks that ran. |
| `checks[].check` | string | `build`, `output`, `references`, `accessibility`, `venue`. |
| `checks[].status` | `pass` \| `warn` \| `fail` \| `skipped` | `skipped` has `skippedReason`. |
| `checks[].summary` | string? | Short human summary. |
| `checks[].stats` | object? | Counters. |
| `problems[].rule` | string | Stable kebab-case id. |
| `problems[].severity` | `error` \| `warning` \| `info` | |
| `problems[].message` | string | One line. |
| `problems[].location` | `{ file?, line?, page? }` | File paths are relative to the project root. |
| `problems[].detail` | string? | Why it happened. |
| `problems[].fix` | string? | What to do. |
| `problems[].related` | number? | Follow-on problems folded into this one. |
| `problems[].evidence` | string? | Raw log lines or bib entry. |
| `problems[].data` | object? | Machine-readable extras (keys, measurements). |

Rule ids in this example are illustrative; `overfull explain <rule>` and the
rules page on the website list the real ones.
