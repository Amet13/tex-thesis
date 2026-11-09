---
name: respond-to-reviewers
description: Turn reviewer or advisor comments into a tracked revision, mapping each comment to a change in the LaTeX source, keeping a response letter in notes/response.md, and verifying with `overfull check` and `overfull diff`. Use when the author shares reviews, a rebuttal or revision is due, or an advisor returns comments on a thesis draft.
---

# Respond to reviewers

The author decides how to answer each comment. You keep the bookkeeping exact
and make the agreed changes.

## Steps

1. Save the reviews verbatim in `notes/reviews.md` (if the author has not).
   Number every comment: `R1.1`, `R1.2`, `R2.1`, …
2. Create `notes/response.md` with one entry per comment:

   ```markdown
   ## R1.2
   > Quote of the reviewer's comment.

   **Plan:** (agreed with the author) clarify the definition in Section 3.1.
   **Change:** sections/method.tex, paragraph starting "We define …"
   **Response:** TODO(author)
   **Status:** open
   ```

3. Go through the list with the author. For each comment record the plan: change
   the paper, answer without change, or disagree. Do not decide for them.
4. Make each agreed change in its own commit with the comment id in the
   message: "R1.2: clarify definition of X in Section 3.1".
   - New experiments, numbers or results come only from the author.
   - New references only through `overfull cite` (see `add-citation`).
   - Page limits still apply (see `fit-page-limit`).
5. After each change: `overfull build`, `overfull check --json`. No errors.
6. Fill **Change** with the file and location, and set **Status** to `done`.
   Draft **Response** text only if the author asks, and mark it for review.
7. Produce the highlighted PDF against the submitted version:

   ```sh
   overfull diff --base <submitted tag or commit>
   ```

   Ask the author for the tag or commit of the submitted version. Many venues
   want this PDF with the revision.
8. Open a PR (see `review-changes`) listing comment ids and their status.

## Done

- Every comment in `notes/reviews.md` has an entry in `notes/response.md`
  with a plan and a status.
- Every `done` entry points to a real change in the diff.
- `overfull check` has no errors and the highlighted PDF exists.

## Pitfalls

- Do not claim a change in the response that is not in the diff.
- Do not quietly change text the reviewers did not ask about; list any extra
  changes separately.
- Keep `notes/` out of the submitted source if it contains private discussion;
  the arXiv and venue packages should not include it.
