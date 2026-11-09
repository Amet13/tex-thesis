---
name: write-disclosure
description: Draft an AI-use disclosure statement based on how AI tools were actually used in this repository (commits, PRs, notes), for the author to edit and approve. Use when overfull.yml sets venue.disclosure to required, the venue check reports a missing disclosure, or the author asks for an AI statement or acknowledgment. Never claim that no AI was used.
---

# Draft an AI-use disclosure

Venues and universities have different, changing policies on AI use and how to
disclose it. The statement is the author's declaration. You draft it from
evidence; the author edits it, decides and signs.

## Steps

1. Find the venue's current policy. Ask the author for the link, or use the URL
   in `notes/` if there is one. Do not rely on what you remember about a
   venue's policy; it may have changed.
2. Collect evidence of actual use in this repository:

   ```sh
   git log --format='%h %an %s%n%b' | grep -i -E 'claude|codex|copilot|cursor|gemini|agent|co-authored-by'
   ```

   Also look at PR descriptions, `notes/`, and what you did in this session.
   Sort the uses into categories, for example: LaTeX build fixes, formatting,
   figure code, reference lookup with verification, language editing, drafting
   text, analysis code.
3. Ask the author about uses you cannot see: chat assistants used outside the
   repo, AI in data analysis, translation, literature search.
4. Draft a short statement that names the tools, what they were used for, and
   that the authors reviewed the output and take responsibility for the content.
   Follow the venue's requested place and format (a section, an acknowledgment,
   or a form field).
5. Put the draft where the venue asks, with the label the venue check looks
   for, marked for review:

   ```latex
   % TODO(author): review and approve this AI-use statement before submission.
   \section*{Use of Generative AI}\label{overfull:disclosure}
   ```

   Use the heading the venue asks for. If the statement goes into a form
   instead of the PDF, keep the draft in `notes/disclosure.md` and tell the
   author the venue check will keep reporting it.

6. `overfull build` and `overfull check --json --checks venue`.
7. Tell the author clearly: this is a draft, check it against the policy at
   `<link>`, and edit it to be accurate.

## Example draft (adapt, do not copy)

> We used Claude Code to fix LaTeX build errors, format tables and write
> pgfplots code for figures from our data. References were added with
> Overfull, which retrieves entries from CrossRef and arXiv; we checked each
> one. All text, analysis and conclusions are our own, and we take full
> responsibility for the content.

Only include claims that are true for this repository. If an agent drafted
paragraphs of text, say so.

## Done

- A draft statement exists where the venue expects it, with the TODO marker.
- The author has the policy link and a list of the evidence you used.
- The venue check reports no `disclosure-missing`. While the text is a
  placeholder, it reports `disclosure-placeholder`; the author finishes it.

## Never

- Never write that no AI tools were used.
- Never understate use to fit a policy. If use may conflict with the policy,
  tell the author.
- Never remove the TODO marker yourself; the author removes it after approval.
