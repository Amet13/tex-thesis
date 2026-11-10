---
title: Does it help agents
description: The agent evaluation tasks, variants and scoring for Overfull, and how to run them; no results are published until runs have been measured.
order: 54
section: Project
---

No results have been published yet. Running agents costs money, so the runs
are done by the maintainer and committed as `evals/results/<date>-<label>.json`
with the agent, the model, the date and the number of runs. This page will list
them when they exist.

## Tasks

Thirteen tasks in `evals/tasks/`, each a prompt, a starting project and what
the result must satisfy:

| Task | What the agent is asked to do |
| --- | --- |
| `related-work` | Write a related-work section citing three named papers. |
| `add-five-citations` | Cite five works from a notes file in which two DOIs are wrong. |
| `respond-to-reviewer` | Answer a reviewer comment that needs one new reference. |
| `switch-to-published-version` | Replace an arXiv citation with its published version. |
| `fix-broken-build` | Fix a build that fails. |
| `fix-refs-and-labels` | Fix an undefined reference and a duplicate label. |
| `fit-page-limit` | Bring the paper within its page limit. |
| `anonymize-for-review` | Prepare the paper for double-blind review. |
| `prepare-arxiv` | Make the source build the way arXiv builds it. |
| `add-figure` | Add a figure from data. |
| `add-alt-text` | Give every figure alternative text. |
| `write-disclosure` | Write the AI-use disclosure. |
| `adopt-existing-project` | Add Overfull to an existing project. |

## Variants

- **bare**: the project without any agent instructions.
- **instructions**: `AGENTS.md` and the skills, as the templates ship them.
- **guard**: instructions plus the hook that blocks direct `.bib` edits.

## Scoring

A run passes when `overfull check` meets the task's expectations. The results
also count cited entries that are fabricated or unverified, files changed
outside the ones the task allows, and prose added to sections the task did not
ask to change. Pass rates are reported with 95% Wilson intervals.

## Run it

```bash
node evals/run.mjs --dry-run
node evals/run.mjs --agent "claude -p {prompt} --permission-mode acceptEdits" \
  --label claude-code --model "<model>" --runs 3
```

See [evals/README.md](https://github.com/amet13/overfull/blob/main/evals/README.md)
for every option.
