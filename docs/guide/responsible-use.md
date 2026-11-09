---
title: Responsible use
description: What Overfull is for, how it supports research integrity, AI-use disclosure, human review, and what it will not help with.
order: 51
section: Project
---

Overfull exists to make papers and theses more correct. It checks; it does not
write. This page explains the principles behind that and what we ask of people
who use it, with or without an AI agent.

## What Overfull is for

- Catching mistakes before submission: build errors, broken references,
  inaccessible PDFs, venue rule violations.
- Giving AI agents facts they cannot know from training data, so their
  mechanical work on a LaTeX project can be verified.
- Making changes reviewable, through small commits and highlighted-changes PDFs.

## What it is not for

- Generating research content, references or data. Overfull has no command that
  writes prose, and its agent instructions forbid inventing results, numbers,
  quotes or citations.
- Producing papers at scale for others to sign (paper mills), or helping anyone
  submit work that is not their own.
- Hiding AI use. The disclosure skill drafts statements from actual use and is
  written never to claim that no AI was used.
- Evading venue rules, for example by squeezing spacing to meet a page limit or
  leaving identifying details in an anonymous submission.

## The author signs

Whoever submits the document is responsible for every sentence, figure, number
and reference in it. A passing `overfull check` means the document builds, its
references exist and match the indexes, and it meets the configured rules. It
does not mean:

- the cited work supports the claim it is attached to;
- the results are correct or reproducible;
- the text is original;
- the document meets every rule of the venue (only the ones you configured).

## Human review

When an agent works on your paper:

- Ask it to work on a branch and open a pull request.
- Read the highlighted-changes PDF from `overfull diff`, not only the summary.
- Check every new reference against what you intended to cite.
- Check every claim against your notes and data.
- Merge only what you would have written yourself, or would sign as written.

## Disclosure

Venues and universities have their own, changing policies on AI use. Read the
current policy for your venue and follow it. If an agent helped, say how. The
`write-disclosure` skill drafts a statement from the repository's history; you
edit and approve it. See [Venues](./venues.md#ai-use-disclosure).

## Integrity of the checks

Agents are instructed not to weaken the configuration to make checks pass: no
removing checks, no ignore-list entries, no edits to venue rules. If you see a
pull request that does this, treat it as a red flag and ask why.

## Reporting misuse or problems

If you find a way Overfull's tools or instructions make it easier to fabricate
content or hide AI use, please open an issue or follow `SECURITY.md` for
sensitive reports.
