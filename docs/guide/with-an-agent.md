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
| `GEMINI.md` | `@AGENTS.md` for Gemini CLI. |
| `.github/copilot-instructions.md` | A short pointer to `AGENTS.md` for GitHub Copilot. |
| `.cursor/rules/overfull.mdc` | An always-on Cursor rule pointing to `AGENTS.md`. |
| `.agents/skills/` | Task instructions in the [Agent Skills](https://agentskills.io) format, one folder per task. |
| `.claude/skills/` | A symlink to `.agents/skills/` for Claude Code. |
| `.claude/settings.json`, `.gemini/settings.json` | The [guard](#guard) hook for Claude Code and Gemini CLI. |
| `overfull.yml` | Project facts: main file, bibliography, profile, venue rules. |

The skills cover starting a paper (`start-paper`), adding citations
(`add-citation`), fixing the build (`fix-build`), adding figures (`add-figure`),
accessibility (`make-accessible`), page limits (`fit-page-limit`), arXiv
(`prepare-arxiv`), AI disclosure (`write-disclosure`), preparing a PR
(`review-changes`) and responding to reviewers (`respond-to-reviewers`).

## Setting up each agent

All of them need the `overfull` command: from the release download, the Docker
image, or inside the Dev Container (see [Install](./install.md)). Building also needs Docker or a local TeX Live.

**Claude Code** reads `CLAUDE.md`, which imports `AGENTS.md`, and loads skills
from `.claude/skills/`. Start it in the project folder with `claude`.

**Codex** (CLI, IDE extension and cloud) reads `AGENTS.md` at the repository root.

**Cursor** reads `AGENTS.md` and the always-on rule in `.cursor/rules/overfull.mdc`.

**GitHub Copilot** coding agent and Copilot in VS Code read `AGENTS.md` and
`.github/copilot-instructions.md`. For the
cloud coding agent, make sure the environment can run Docker or install the
CLI; see GitHub's documentation on customizing the agent environment.

**Gemini CLI** reads `GEMINI.md`, which imports `AGENTS.md`.

Other agents (Windsurf, Cline, Zed, Aider and more) read `AGENTS.md` or can be
told to; every instruction they need is in that file and in plain-Markdown skills.

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

## Guard

Rules in `AGENTS.md` are requests. The guard enforces the one that matters most:
no hand-written bibliography entries. It works at two points.

**In the agent.** `overfull guard --hook` answers an agent's pre-tool-use hook.
When the agent's file tools try to write or edit a `.bib` file, the hook denies
the call and tells the agent to use `overfull cite`. Reading a `.bib` file, and
every other tool and file, is allowed. The template ships the hook settings for
two agents; the formats were read from their documentation on 2026-11-10.

| Agent | Settings file | Event and tools | Documentation |
| --- | --- | --- | --- |
| Claude Code | `.claude/settings.json` | `PreToolUse`: `Write`, `Edit`, `MultiEdit` | <https://code.claude.com/docs/en/hooks> |
| Gemini CLI | `.gemini/settings.json` | `BeforeTool`: `write_file`, `replace` | <https://geminicli.com/docs/hooks/> |

Codex CLI and Cursor have hooks too, but their documentation does not show the
payload of a file edit (Codex sends a patch in `tool_input.command`; Cursor does
not list the input of its `Write` tool), so there is no hook for them yet. They
still get the rules in `AGENTS.md` and the pre-commit guard below.

`overfull init --here --agents` writes these files. If one already exists, the
Overfull hook is added and your other settings are kept; a file that is not
valid JSON is left alone. The hook command does nothing when `overfull` is not
on `PATH`, because the guard is a small command that is not run through Docker:

```sh
command -v overfull >/dev/null 2>&1 && overfull guard --hook claude || exit 0
```

It uses a POSIX shell, so on Windows it needs Git Bash or WSL. An unreadable or
unknown payload is always allowed: a broken guard must not stop the agent's
other tools.

A shell command that writes a `.bib` file, such as `echo ... >> refs.bib`, is
not detected. Overfull does not try to parse shell. The pre-commit guard and
`overfull check` catch it.

**At commit time.** `overfull guard --staged` compares the staged `.bib` files
with `HEAD`, entry by entry. A new or changed entry passes when it was added by
`overfull cite`, when it carries `note = {overfull: author-provided}` (or
`overfull: skip`), or when the indexes confirm it. Otherwise the commit is
refused and each entry is listed with the `overfull cite` command to use:

```text
refs.bib:12  ongaro2014search
  not added by `overfull cite`, and no index confirms it
  add it properly:  overfull cite "In search of an understandable consensus algorithm"
  or, if you wrote it yourself, add to the entry:  note = {overfull: author-provided}
```

Moved entries, removed entries and whitespace or order changes pass. Use
`--offline` to skip the lookup. Install it in one of three ways:

- `overfull init --here --hooks` writes `.git/hooks/pre-commit` if there is none.
  If one exists it is not changed and the line to add is printed.
- With the [pre-commit](https://pre-commit.com) framework, add to
  `.pre-commit-config.yaml`:

  ```yaml
  repos:
    - repo: https://github.com/amet13/overfull
      rev: v3.1.0  # a release tag
      hooks:
        - id: overfull-guard
  ```

- By hand: put `overfull guard --staged || exit 1` in your pre-commit hook.

The author can still add an entry by hand: write it, add
`note = {overfull: author-provided}`, and commit. That note is the author's
statement; the agent rules forbid the agent to add it.

## Install as a Claude Code plugin

The repository is also a Claude Code plugin and a plugin marketplace
(`.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, read from
<https://code.claude.com/docs/en/plugins-reference> and
<https://code.claude.com/docs/en/plugin-marketplaces> on 2026-11-10). The plugin
loads the ten skills from `skills/` (the same files the templates carry) and the
guard hook. It needs the `overfull` command on `PATH`. In a shell:

```sh
claude plugin marketplace add amet13/overfull
claude plugin install overfull@overfull
```

Or inside Claude Code:

```text
/plugin marketplace add amet13/overfull
/plugin install overfull@overfull
```

Plugin skills are namespaced, for example `/overfull:add-citation`. The plugin
does not write `AGENTS.md` or `overfull.yml` into a project; run
`overfull init --here` for that. Codex, Cursor and Gemini CLI also have
extension formats, but they were not read for this release, so there is no
package for them.

## Agents without a shell

Desktop apps and cloud editors cannot run `overfull` in a terminal. For them,
`overfull mcp` offers the same checks as a Model Context Protocol server. See
[Using Overfull over MCP](./mcp.md).
