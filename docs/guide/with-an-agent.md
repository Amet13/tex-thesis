---
title: Working with an agent
description: Set up Claude Code, Codex, Cursor, GitHub Copilot or Gemini CLI on an Overfull project, the build-and-check loop agents follow, how to review their pull requests, and what they must not do.
order: 10
section: With an agent
---

AI coding agents are good at LaTeX mechanics: fixing build errors, formatting
tables, writing pgfplots code, restructuring files. They are unreliable at facts
they cannot look up, and references are the classic case. Overfull gives the
agent tools for those facts and a clear definition of done.

## What the template gives the agent

| File | Purpose |
| --- | --- |
| `AGENTS.md` | The rules: layout, build command, the check loop, hard rules on references and content. |
| `CLAUDE.md` | One line, `@AGENTS.md`, so Claude Code reads the same rules. |
| `.agents/skills/` | Task instructions in the [Agent Skills](https://agentskills.io) format, one folder per task. |
| `.claude/skills/` | A symlink to `.agents/skills/` for Claude Code. |
| `overfull.yml` | Project facts: main file, bibliography, profile, venue rules. |

The skills cover starting a paper (`start-paper`), adding citations
(`add-citation`), fixing the build (`fix-build`), adding figures (`add-figure`),
accessibility (`make-accessible`), page limits (`fit-page-limit`), arXiv
(`prepare-arxiv`), AI disclosure (`write-disclosure`), preparing a PR
(`review-changes`) and responding to reviewers (`respond-to-reviewers`).

## Setting up each agent

All of them need the `overfull` command: from a clone today, from the release
download or the Docker image after v3.0.0, or inside the Dev Container (see
[Install](./install.md)). Building also needs Docker or a local TeX Live.

**Claude Code** reads `CLAUDE.md`, which imports `AGENTS.md`, and loads skills
from `.claude/skills/`. Start it in the project folder with `claude`.

**Codex** (CLI, IDE extension and cloud) reads `AGENTS.md` at the repository root.

**Cursor** reads `AGENTS.md` as project rules.

**GitHub Copilot** coding agent and Copilot in VS Code read `AGENTS.md`. For the
cloud coding agent, make sure the environment can run Docker or install the
CLI; see GitHub's documentation on customizing the agent environment.

**Gemini CLI** reads `GEMINI.md` by default. Point it at `AGENTS.md` in
`.gemini/settings.json`:

```json
{ "context": { "fileName": ["AGENTS.md", "GEMINI.md"] } }
```

Agents that support Agent Skills find them in `.agents/skills/` or
`.claude/skills/`, depending on the tool. Agents that do not can still follow
them: `AGENTS.md` lists each skill and says to read its `SKILL.md` in
`.agents/skills/` first, and each `SKILL.md` is plain Markdown.

## The loop

`AGENTS.md` tells the agent to run this after every change:

```sh
overfull build
overfull check --json
```

It fixes every `error`, reviews every `warning`, and repeats. The task is done
when `overfull check` reports no errors (exit code 0). The JSON is a stable
`Report` (see [CLI reference](./cli.md#json-output)), so the agent gets a rule id,
a file and line or page, and a suggested fix for each problem. For a rule it does
not know, it runs `overfull explain <rule>`.

When layout matters, agents that can read images use `overfull pages 3-4` to
render pages and look at them.

## Reviewing what an agent did

Ask the agent to work on a branch and open a pull request. The `review-changes`
skill has it:

- commit one logical change at a time with descriptive messages,
- run `overfull diff --base main` to produce a PDF with changes highlighted,
- list in the PR what changed, what it could not verify, and remaining warnings.

Read the highlighted PDF, not only the LaTeX diff. Check every new citation is
one you meant, and every claim matches your notes. The template workflow builds
the PDF and runs the checks on the PR, writing the report to the job summary and
as annotations, and attaches the PDFs, including the highlighted-changes PDF, as
an artifact.

## Prompts that work

Point the agent at sources and tell it what done means:

- "Add citations for the three papers in `notes/related.md` using `overfull cite`,
  and cite them in the related-work section where the notes say."
- "The build fails. Fix it without changing the engine or removing content."
- "Make a figure from `figures/data/ablation.csv` comparing the four variants.
  Write alt text from the data."
- "We're one page over the limit. Show me options; don't cut content without asking."
- "Run `overfull check --profile arxiv` and fix what it finds. Ask me before
  stripping comments."
- "Draft the AI-use statement for this venue. Here is the policy: <link>."

Prompts that cause trouble: "write the introduction", "add some references on
X", "make it shorter" with no constraints. They ask the agent to supply facts it
does not have.

## What agents must not do

`AGENTS.md` makes these hard rules:

- Add references only with `overfull cite`. Never write BibTeX from memory, and
  never cite a key that check reports as `reference-not-found`.
- Never invent data, results, numbers or quotes. Research claims come from
  `notes/` or from you.
- Never weaken `overfull.yml` (venue rules, profile, checks, ignore lists) to make
  a check pass.
- Never shrink fonts, margins or spacing to meet a page limit.
- Keep tagging on and give every figure real alt text.
- Never claim that no AI was used in a disclosure.

If an agent breaks one, the check report or the PR diff usually shows it. See
[Responsible use](./responsible-use.md) for the reasoning.
