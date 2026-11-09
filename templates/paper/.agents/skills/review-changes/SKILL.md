---
name: review-changes
description: Prepare a branch for the author's review as a pull request, with a highlighted-changes PDF from `overfull diff`, a summary of what changed and why, what could not be verified, and the remaining check warnings. Use when finishing a task, before asking the author to merge, or when the author asks what changed.
---

# Prepare changes for review

The author reviews the PDF, not only the LaTeX diff. Make that easy.

## Steps

1. Make sure the work is committed in small, logical commits on a branch (not
   `main`). Each message says what content changed.
2. Build and check:

   ```sh
   overfull build
   overfull check --json
   ```

   There must be no errors. If there are, fix them first (`fix-build`,
   `add-citation`, and so on).
3. Produce the highlighted-changes PDF against the base branch:

   ```sh
   overfull diff --base main
   ```

   Use the base branch the PR targets. The command prints where it wrote the
   PDF. `--out` must stay inside the project. With `--json` it prints
   `{pdf, base, sha, complete}`; if `complete` is `false`, the diff document had
   LaTeX errors and the PDF may be incomplete, so say so in the PR.
4. List every open question for the author. `TODO(author)` comments do not
   show in the diff PDF, so collect them from the source:

   ```sh
   grep -rn "TODO(author)" --include=*.tex --include=*.bib .
   ```

5. Write the PR description (template below). List every `TODO(author)` item
   from step 4 with its file and line.
6. Open the PR (for example `gh pr create`). The template's workflow builds the
   PDF and the diff in CI and posts the check report.

## PR description template

```markdown
## What changed
- Added Section 4.2 on X from notes/experiments.md
- New figure \cref{fig:loss} from figures/data/loss.csv
- 3 references added with `overfull cite` (keys: a2024, b2023, c2025)

## Needs the author's attention
- Claims I could not find in notes/: <list with file:line>
- TODO(author) markers (from `grep -rn "TODO(author)"`): <every one, file:line and question>
- Reference mismatches to confirm: <key: what differs>

## Check report
- Status: pass / warn
- Remaining warnings: <rule, location, why it stays>

## Review
Highlighted-changes PDF: <path or CI artifact>
```

## Done

- `overfull check` has no errors on the branch.
- The PR description lists every content change, every unverified claim, every
  `TODO(author)` marker, and every remaining warning.
- The author has a highlighted-changes PDF to read.

## Pitfalls

- Do not merge your own PR. The author merges.
- Do not squash unrelated changes into one commit; it makes the diff hard to
  review.
- Do not describe changes you did not make, or hide warnings by not listing
  them.
