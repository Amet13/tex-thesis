---
title: Configuration
description: Reference for overfull.yml, the project configuration file read by every overfull command and the GitHub Action.
order: 41
section: Reference
---

`overfull.yml` lives at the project root. Every command reads it, and command
flags override it for a single run. All fields are optional; the templates ship
a filled-in file.

```yaml
main: main.tex
jobname: thesis           # output is thesis.pdf / thesis.log
bib: [references.bib]
profile: thesis           # built-in name; venue fields below override it
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

## Top level

| Field | Type | Meaning |
| --- | --- | --- |
| `main` | path | Main `.tex` file. |
| `jobname` | string | Output name. Overfull looks for `<jobname>.pdf`, `<jobname>.log` and `<jobname>.aux`. |
| `bib` | list of paths | Bibliography files. `overfull cite` writes to the first one unless `--bib` is given. |
| `profile` | string | Venue profile: `generic`, `thesis`, `paper`, `arxiv` or `double-blind`. See [Venues](./venues.md). |
| `checks` | list | Checks to run: `build`, `output`, `references`, `accessibility`, `venue`. |

## references

| Field | Type | Meaning |
| --- | --- | --- |
| `mailto` | email | Contact address for CrossRef and OpenAlex. Enables OpenAlex title search. |
| `ignore` | list of keys | Entries not to verify. |

You can also skip a single entry with `note = {overfull: skip}` in the `.bib`.
See [References](./references.md).

## venue

Fields here override the chosen profile.

| Field | Type | Meaning |
| --- | --- | --- |
| `pageLimit.max` | number | Maximum pages that count. |
| `pageLimit.endLabel` | string | Count only up to the page of this `\label`, conventionally `overfull:main-end`. |
| `paper` | `a4` \| `letter` \| `any` | Expected paper size. |
| `anonymous` | boolean | Check for author-identifying information. |
| `disclosure` | `required` \| `recommended` \| `off` | Whether an AI-use disclosure must be present (error), should be (info), or is not checked. |
| `accessibility` | `required` \| `recommended` \| `off` | How strictly accessibility problems count. |
| `arxiv` | boolean | Apply the arXiv packaging rules. |

## build

| Field | Type | Meaning |
| --- | --- | --- |
| `engine` | `auto` \| `local` \| `docker` | How `overfull build` runs `latexmk`. |
| `image` | string | Docker image for the `docker` engine. Pin it to keep builds reproducible. |

## Cache

Reference lookups are cached in `.overfull/cache/refs.json`. The templates add
`.overfull/` to `.gitignore`. Delete the folder to force fresh lookups.

## Agents and this file

`AGENTS.md` tells agents to read this file and not to change the `venue`
section, `profile`, `checks` or `references.ignore` to make a check pass. Review
any pull request that touches it.
