# Evals

Small, honest measurements of whether the kit helps AI agents produce a paper
that passes preflight. Each task copies a template, runs an agent with a
prompt, then scores the result with `overfull check` in the Docker image.

Two variants run per task:

- `kit`: the template as shipped, with `AGENTS.md`, skills and the CLI.
- `bare`: the same template with `AGENTS.md`, `CLAUDE.md` and skills removed.

```bash
# Claude Code
node evals/run.mjs --agent "claude -p {prompt} --permission-mode acceptEdits"

# Codex CLI
node evals/run.mjs --agent "codex exec --full-auto {prompt}"

# One task, three runs, keep the working directories for inspection
node evals/run.mjs --agent "..." --task related-work --runs 3 --keep
```

Results are written to `evals/results.json`. Tasks live in `evals/tasks/*.json`:
`prompt`, `template`, optional `setup` (patches for `overfull.yml`) and
`expect` (allowed statuses, max errors, rules that must not fire).

Agents cost money to run, so evals are not part of CI. Publish numbers with
the agent, model and date they were measured with.
