---
title: FAQ
description: Common questions about Overfull, its checks, references, agents, privacy and templates.
order: 50
section: Project
---

## Do I need to use an AI agent?

No. Every check works the same from `make check`. The agent files in the
templates do nothing unless an agent reads them, and you can delete them.

## Do I need to install TeX Live?

No. Docker is enough: the templates build in the Overfull image. If you already
have TeX Live, `overfull build` uses it.

## Can I use Overfull with my own template or class?

Yes. Add an `overfull.yml` with your main file, job name and bibliography, build
as you normally do, and run `overfull check`. The accessibility check depends on
whether your class supports tagging.

## Does it work with pdfLaTeX or XeLaTeX?

The checks read logs from LuaLaTeX, pdfLaTeX and XeLaTeX. The templates use
LuaLaTeX because LaTeX's tagging support works best with it. The paper template
also builds with pdfLaTeX (`make arxiv` or `latexmk -pdf`), because arXiv does
not support LuaLaTeX. See [Venues](./venues.md#arxiv).

## A real reference is reported as not found. What now?

Add a `doi` field if the work has one, and check the title for typos or LaTeX
markup. Some venues are not indexed. If you are sure the entry is right, opt it
out with `note = {overfull: skip}` or `references.ignore`. See
[References](./references.md#false-positives).

## Does Overfull say a reference is fake?

No. It reports what the indexes returned: verified, mismatch, not found,
unverifiable, or lookup failed. You decide what that means.

## What data leaves my machine?

Reference checks (and `overfull cite`) send titles, DOIs and arXiv ids of your
cited entries to CrossRef, doi.org, arXiv and DBLP. If you set the
`OPENALEX_API_KEY` environment variable, titles also go to OpenAlex, with the
key. If you set a `mailto` address, it goes to CrossRef and OpenAlex. Nothing
else is sent. Use `--offline` to send nothing. The browser check on the website
reads your files in the browser and never uploads them; with online
verification on, it sends each reference's DOI or title to CrossRef and doi.org
only.

## Does Overfull use AI?

No. All checks are deterministic: log parsing, PDF analysis, index lookups and
rules. It is designed to check work that AI agents (or people) produced.

## Will a passing check get my paper accepted?

No. It means the document builds cleanly, its references exist, the PDF is
tagged, and it meets the rules you configured. Content, originality and fit for
the venue are up to you and the reviewers.

## Can I make check pass by ignoring a rule?

You can opt individual references out and choose which checks run. Agents are
told never to do this on their own. If a rule seems wrong, run
`overfull explain <rule>` and open an issue if you still disagree.

## How do I count only the main text toward the page limit?

Put `\label{overfull:main-end}` where the counted part ends and set
`venue.pageLimit.endLabel` to that label. See [Venues](./venues.md#page-limits).

## Which agents are supported?

Any agent that reads `AGENTS.md` or `CLAUDE.md`: Claude Code, Codex, Cursor,
GitHub Copilot, Gemini CLI (with a one-line setting) and others. See
[Working with an agent](./with-an-agent.md).

## What licence do the templates use?

MIT-0. You can use them for your thesis or paper without attribution or licence
notices.

## I used tex-thesis. Is it gone?

It became Overfull. See [Migrate from tex-thesis](./migrate-from-tex-thesis.md).
