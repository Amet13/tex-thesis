---
name: fit-page-limit
description: Bring the document within the venue page limit measured by the Overfull venue check, by tightening prose, merging or resizing figures, and moving material to the appendix, without shrinking fonts or margins or hacking spacing. Use when the venue check reports the page limit is exceeded or the author asks to cut the paper to N pages.
---

# Fit the page limit

## Measure

```sh
overfull build
overfull check --json --checks venue
```

Find `page-limit-exceeded` in the `venue` check. Its `message` and `data` say
how many pages count and what the limit is. The limit comes from
`venue.pageLimit` in `overfull.yml` (or the profile). If `endLabel` is set, only
pages up to `\label{overfull:main-end}` count; references and appendices after
that label do not.

If check reports `page-limit-label-missing`, the label is not in the document
or the `.aux`. Check the label is in the right place: directly before the bibliography or the
appendix, as the venue's rules define the main text. Ask the author if unsure.
Do not move it to gain pages.

## Allowed ways to cut

Work from least to most invasive and ask before cutting content:

1. Find the overrun. If you can read images, `overfull pages <last pages>` to
   see how much is over: three lines or two pages need different plans.
2. Fix widows: a paragraph ending with one or two words on its own line. Small
   rewording of that paragraph often saves a line.
3. Resize figures that are wider or taller than their content needs. Combine
   related plots into a single plot (one `tikzpicture` or one image) if the
   author agrees. Do not use the `subcaption` package: it breaks PDF tagging.
4. Tighten prose you or an agent wrote. Propose cuts in the author's prose as
   suggestions in the PR, do not apply them silently.
5. Move proofs, extra experiments, extended tables or implementation details to
   an appendix after `\label{overfull:main-end}`, if the venue allows appendices
   or supplementary material.
6. If still over, tell the author how many lines remain and which sections are
   longest. Cutting research content is their decision.

## Not allowed

These usually violate venue rules and can lead to desk rejection:

- Changing font size, `\baselinestretch`, margins, `geometry`, column sep, or
  the document class options.
- Negative `\vspace`, `\vskip`, shrinking `\abovecaptionskip`, `\parskip`,
  section spacing, or `\looseness` hacks across the document.
- Using `\small`/`\footnotesize` for body text, or tiny fonts in tables beyond
  what the venue template allows.
- Moving the end label, or editing `venue.pageLimit` in `overfull.yml`.

## Done

- The venue check reports no page-limit error.
- `overfull check` shows no new errors or warnings (especially `overfull-box`
  from resized figures).
- The PR lists what moved to the appendix and what text changed, with
  `overfull diff --base main` for the author to review.
