---
title: Configuration
description: Reference for overfull.yml, the project configuration file read by every overfull command and the GitHub Action.
order: 41
section: Reference
---

`overfull.yml` lives at the project root (`overfull.yaml` also works, and
`--config file` names another file). Every command reads it, and command flags
override it for a single run. All fields are optional; the templates ship a
filled-in file. Unknown keys are an error: Overfull stops with exit code 2 and
suggests the closest valid key. Paths are relative to the folder that holds the
config file.

```yaml
main: main.tex
jobname: thesis           # output is thesis.pdf / thesis.log
bib: [references.bib]
profile: thesis           # built-in name; venue fields below override it
checks: [build, output, references, accessibility, venue]
references:
  mailto: you@example.org # polite pool for CrossRef (and OpenAlex)
  ignore: [rfc9110]
venue:
  pageLimit: { max: 9, endLabel: overfull:main-end }
  anonymous: false
  disclosure: required
build:
  engine: auto            # local latexmk if present, else Docker
  image: ghcr.io/amet13/overfull:3
```

## Top level

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `main` | path | `main.tex` | Main `.tex` file. |
| `jobname` | string | `main` without `.tex` | Output name. Overfull looks for `<jobname>.pdf`, `<jobname>.log` and `<jobname>.aux`. |
| `bib` | string or list of paths | the files named by `\addbibresource` or `\bibliography` in `main`, else every `.bib` in the project folder | Bibliography files. `overfull cite` writes to the first one unless `--bib` is given (and to `references.bib` if there is none). |
| `profile` | string | `generic` | Venue profile: `generic`, `thesis`, `paper`, `arxiv` or `double-blind`. See [Venues](./venues.md). A mapping with the `venue` fields is also accepted. |
| `checks` | string or list | the profile's checks (all five for every built-in profile) | Checks to run: `build`, `output`, `references`, `accessibility`, `venue`. |

## references

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mailto` | email | `$OVERFULL_MAILTO`, else none | Contact address sent to CrossRef (and OpenAlex) for their polite pool. `--mailto` overrides it. |
| `ignore` | string or list of keys | `[]` | Entries not to verify. |
| `cache` | `user` \| `project` | `user` | Where lookups are cached. `user`: your cache folder, outside the project (see [Cache](#cache)). `project`: `.overfull/cache/refs.json`, the old location. |
| `requireCite` | boolean | `false` | Require every entry to carry the `x-overfull = {cite …}` field that `overfull cite` writes. The templates turn it on. |

`mailto` does not turn OpenAlex on. OpenAlex title search is used only when the
`OPENALEX_API_KEY` environment variable is set. There is no config key for the
key, so it never ends up in the repository.

You can also skip a single entry with `note = {overfull: skip}` in the `.bib`.
See [References](./references.md).

## venue

Fields here override the chosen profile. `profile` can also hold these fields
as a mapping.

| Field | Type | Meaning |
| --- | --- | --- |
| `pageLimit` | number or mapping | A number is shorthand for `{ max: <number> }`. |
| `pageLimit.max` | number | Maximum pages that count. |
| `pageLimit.endLabel` | string | Count only up to the page of this `\label`, conventionally `overfull:main-end`. |
| `paper` | `a4` \| `letter` \| `any` | Expected paper size. Wrong size is a warning (3 mm tolerance). |
| `anonymous` | boolean | Check for author-identifying information. |
| `disclosure` | `required` \| `recommended` \| `off` | A missing AI-use disclosure is an error with `required`, `info` with `recommended`, and not checked with `off`. An unfinished one is an error with `required`, a warning with `recommended`. |
| `accessibility` | `required` \| `recommended` \| `off` | Accessibility problems are errors with `required`, warnings with `recommended`, and the check is skipped with `off`. |
| `arxiv` | boolean | Apply the arXiv packaging rules. |
| `checks` | list | Checks to run, as the top-level `checks` (the top-level key wins). |
| `name`, `description` | string | Label for the profile. |
| `extends` | string | Built-in profile to start from (default: `profile`, else `generic`). |

## build

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `engine` | `auto` \| `local` \| `docker` | `auto` | How `overfull build` and `overfull diff` run their tools. `auto` uses a local `latexmk` if found, else Docker. |
| `image` | string | `ghcr.io/amet13/overfull:3` | Docker image. Pin it to keep builds reproducible. The `OVERFULL_IMAGE` environment variable overrides it, and `overfull build --image` overrides both. |
| `outDir` | path | the `$out_dir` of a `.latexmkrc`, else `.` | Where latexmk writes the PDF, log and aux files. `overfull build` passes it as `-outdir`/`-auxdir`, and `overfull check` reads from it. |

`main`, `jobname` and `outDir` may contain only letters, digits, `.`, `_`, `-`
(and `/` except in `jobname`), and no `..`: latexmk passes them to a shell.
Paths (`bib`, `--pdf`, `--log`, `--aux`) must stay inside the project folder.

## Cache

Reference lookups are cached outside the project, in your user cache folder:
`$XDG_CACHE_HOME/overfull` (else `~/.cache/overfull`), or
`%LOCALAPPDATA%\overfull` on Windows, one subfolder per project. A cache inside
the repository could be committed, and a committed cache would let a pull
request mark a made-up reference as verified. Delete the folder to force fresh
lookups.

`references.cache: project` keeps the cache in `.overfull/cache/refs.json`
instead. When that file is tracked by git and the check runs in CI (`CI` or
`GITHUB_ACTIONS` is `true`), Overfull ignores it and says so
(`refs-cache-ignored`).

`overfull pages` writes images to `.overfull/pages`, and `overfull diff` builds
in `.overfull/diff`. The templates add `.overfull/` to `.gitignore`.

## Environment variables

| Variable | Effect |
| --- | --- |
| `OVERFULL_MAILTO` | Contact address, used when `references.mailto` and `--mailto` are not set. |
| `OVERFULL_IMAGE` | Docker image, overrides `build.image`. |
| `OPENALEX_API_KEY` | Enables OpenAlex title search for `check` and `cite`. |
| `OVERFULL_DEBUG` | Set to `1` to print a stack trace on an internal error. |

## Agents and this file

`AGENTS.md` tells agents to read this file and not to change the `venue`
section, `profile`, `checks` or `references.ignore` to make a check pass. Review
any pull request that touches it.
