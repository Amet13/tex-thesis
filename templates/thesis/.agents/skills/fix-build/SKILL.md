---
name: fix-build
description: Diagnose and fix LaTeX build failures and problems that reach the PDF (TeX errors, undefined references or citations, missing files, overfull boxes, duplicate labels) using `overfull build` and `overfull check --json`. Use when the build fails, the PDF shows ?? or [?], or the build or output check reports errors or warnings.
---

# Fix the build

## Steps

1. Build and check:

   ```sh
   overfull build
   overfull check --json --checks build,output
   ```

   If nothing changed since the last good build, `overfull build` does not start
   `latexmk` (it prints "is up to date" and reports on the existing log). After a
   change to a file the build does not track, or to get a clean run, use
   `overfull build --force`. With `--json`, a build that fails before LaTeX writes
   a log prints `{"error": {"code": "build-failed", ...}}` and exits 1.

2. Work on the **first** `build` error only. Overfull groups follow-on errors
   under the root cause (`related` counts them). Fixing the first one often
   clears the rest.
3. Open `location.file` at `location.line`. Read `message`, `detail` and
   `fix`. For more, run `overfull explain <rule>`.
4. Make the smallest change that fixes the cause. Rebuild and recheck.
5. When `build` passes, fix `output` errors, then review `output` warnings.

## Common causes

| Symptom (rule id) | Usual cause | Fix |
| --- | --- | --- |
| Undefined control sequence (`undefined-control-sequence`) | Typo, or package not loaded | Fix the name. Add a package only if the author agrees. |
| Missing `$` inserted (`missing-dollar`) | `_`, `^`, `&`, `%`, `#` in text | Escape: `\_`, `\&`, `\%`, `\#`. Use math mode for math. |
| `&amp;` or `&lt;` in source | HTML escaping | Replace with `\&` or `<` in math. |
| File not found (`missing-file`, `missing-figure`) | Wrong path or case | Use the real path; paths are case-sensitive in CI. |
| Undefined reference `??` (`undefined-reference`) | Missing or misspelled `\label` | Fix the label or the `\cref`. |
| Undefined citation `[?]` (`undefined-citation`) | Bibliography not rebuilt, or the key is not in the bib (`citation-key-missing`) | Rebuild; for a missing key see the `add-citation` skill. Never write BibTeX by hand. |
| Rerun / stale bibliography (`rerun-needed`, `bibliography-stale`) | Build stopped early | Rebuild with `overfull build`. |
| Duplicate label (`duplicate-label`) | Copied figure or section | Rename one label and its references. |
| Overfull box > 10pt (`overfull-box`) | Long word, URL, table or formula | Rephrase, allow a break (`\url`, `\allowbreak`), resize the table to `\linewidth`, split the formula. |

## Missing packages

If a package is missing locally, build in Docker:

```sh
overfull build --engine docker
```

Never install TeX packages or fonts globally, and do not switch engines except
via the documented arXiv path (`prepare-arxiv`). If the
package is also missing in Docker, tell the author.

## Done

- `overfull check --checks build,output` has no errors.
- Remaining warnings (for example small overfull boxes in the author's prose)
  are listed for the author with page numbers.

## Pitfalls

- Do not wrap text in `\sloppy`, change `\hbadness`, or add negative spacing to
  hide overfull boxes.
- Do not delete content, figures or citations to make an error go away.
- Do not comment out `\DocumentMetadata` or tagging. If it causes the error,
  see the `make-accessible` skill.
- If you can read images, use `overfull pages <n>` to confirm a layout fix.
