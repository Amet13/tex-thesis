---
title: Add Overfull to an existing project
description: Run overfull init --here in a LaTeX folder you already have. It detects the main file, engine, bibliography and venue style file, writes overfull.yml, and never touches a .tex or .bib file.
order: 3
section: Start
---

You do not need a template. In a folder that already holds your paper or
thesis, run:

```sh
overfull init --here
```

`overfull adopt` does the same. Overfull reads your files, writes
`overfull.yml`, and prints what it found and what it wrote. It never creates or
changes a `.tex` or `.bib` file.

## What it detects

| Setting | How it is found |
| --- | --- |
| Main file | `main.tex`, or the only `.tex` file with `\documentclass`. With several, it stops (exit 2), lists them and asks for `--main file.tex`. |
| Job name | `$jobname` in `.latexmkrc`, else the main file name. |
| Engine | `$pdf_mode` or `$pdflatex` in `.latexmkrc`, else a `% !TEX program = …` line, else `fontspec` or `unicode-math` (LuaLaTeX), else pdfLaTeX. |
| Bibliography | `\addbibresource{…}` and `\bibliography{…}`, else every `.bib` file in the folder. |
| Backend | biber when `biblatex` is loaded without `backend=bibtex`, else BibTeX. |
| Profile | The venue whose style file the project uses (see [Venues](./venues.md)); `thesis` for a `report`, `book` or `memoir` with `\chapter`; else `generic`. |

Every value in `overfull.yml` has a comment that says how it was found. Fix
what is wrong; `overfull check` reads that file.

`references.requireCite` is `false` in the file. The entries in your `.bib`
file were not written by `overfull cite`, so none carries its proof. Overfull
still looks each one up. Set it to `true` when new entries come only from
`overfull cite`, for example when an agent works on the project.

When the engine is not LuaLaTeX and the folder has no `.latexmkrc`, Overfull
also writes a two-line `.latexmkrc` that keeps your engine. Without one,
`overfull build` uses LuaLaTeX.

## Optional parts

| Flag | Adds |
| --- | --- |
| `--agents` | `AGENTS.md`, the pointer files `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md` and `.cursor/rules/overfull.mdc`, the skills in `.agents/skills/`, and `.claude/skills` as a link to them (a copy where links are not allowed). These are the same files the templates carry. |
| `--ci` | `.github/workflows/overfull.yml`: builds with `latexmk` and your engine in the Overfull image, then runs the checks. |
| `--make` | A `Makefile` with `build`, `watch`, `check`, `pages`, `diff` and `clean`. If you already have one it is not touched; the lines to add are printed. |
| `--hooks` | A git pre-commit hook that runs `overfull guard --staged`, only if `.git/hooks/pre-commit` does not exist. If it does, the line to add is printed. With `--agents`, the hook settings for Claude Code and Gemini CLI are written too. See [Guard](./with-an-agent.md#guard). |
| `--all` | All four. |

On a terminal, with none of these flags, Overfull asks about each part.

## Safe to run again

- A file that already exists is never overwritten unless you pass `--force`.
  Every file written and every file skipped, with the reason, is printed.
  A `Makefile` is never overwritten, even with `--force`.
- A second run changes nothing and says so.
- `--dry-run` writes nothing and lists what would be written.
- `--json` prints `{detected, written, skipped}`.

```sh
overfull init --here --all --dry-run   # look first
overfull init --here --all
overfull build
overfull check
```

Overfull cannot know your venue's rules from a style file it does not have
data for. If the profile is `generic`, set `venue:` in `overfull.yml` (for
example `pageLimit: { max: 8 }`) or pick a profile; see [Venues](./venues.md).
