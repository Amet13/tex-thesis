---
title: How it compares
description: Overfull next to other open reference checkers, RefChecker, BibTeX Verifier and CheckIfExist, from what each project's own page says, including where they do more.
order: 55
section: Project
---

Several free tools now check bibliographies for references that do not exist.
This page compares them with Overfull from what each project says about itself
on its own page, read on 2026-11-10. Tools change quickly; follow the links for
the current state. Corrections are welcome as an issue.

| | Overfull | [RefChecker](https://github.com/markrussinovich/refchecker) | [BibTeX Verifier](https://merfanian.github.io/Bibtex-Verifier/) | [CheckIfExist](https://arxiv.org/abs/2602.15871) |
| --- | --- | --- | --- | --- |
| Indexes asked | CrossRef, doi.org, arXiv, DBLP, Semantic Scholar, ACL Anthology, Europe PMC, OpenAlex | Semantic Scholar, OpenAlex, CrossRef, DBLP, ACL Anthology | Semantic Scholar, CrossRef, OpenAlex as a fallback | CrossRef, Semantic Scholar, OpenAlex |
| Uses a language model | No | Yes: an LLM web search flags likely fabricated references | No (string matching, as described) | No (string similarity scores, as described) |
| Runs as | CLI, GitHub Action, browser page, MCP server, agent hook | Web UI, desktop app, CLI, HTTP API | Browser page | Web tool |
| Fixes the `.bib` | No: `overfull cite` adds new entries from the record; existing entries are reported, not changed | Not stated on the page | Yes: fills missing DOIs and metadata and offers a corrected `.bib` | Returns BibTeX and APA records |
| Beyond references | Build log, PDF output, accessibility, venue rules | AI-generated text detection, bulk scans of OpenReview venues | No | No |

## Where the others do more

- **RefChecker** can scan many papers at once, including whole OpenReview
  venues, and its LLM search can find sources that no index lists. Overfull
  checks one project at a time and only asks indexes, so a work that no index
  has is reported as "could not be checked" or "not found".
- **BibTeX Verifier** corrects metadata in place and shows a field-by-field
  diff you can edit. Overfull reports a metadata mismatch and leaves the change
  to you.
- **CheckIfExist** returns formatted APA citations as well as BibTeX.

## What Overfull is for

Overfull is a preflight for a whole LaTeX project rather than a bibliography
checker alone. The same report covers the build, the PDF, accessibility and the
venue's rules, and it runs where the paper is written: in CI on every pull
request, as a hook that stops an AI agent from writing BibTeX by hand, and in
the browser for Overleaf projects. Its verdicts come from the indexes and from
fixed rules, never from a model, so the same input always gives the same
report. How well the reference check does on real and fabricated entries is
measured in [How accurate is the reference check](./accuracy.md).
