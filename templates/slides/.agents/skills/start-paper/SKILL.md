---
name: start-paper
description: Set up a new paper or thesis from a fresh Overfull template, filling metadata.tex, outlining sections or chapters from the author's notes, choosing the profile and venue rules in overfull.yml with the author, and running the first build and check. Use when the repository was just created from a template, metadata still holds placeholders, or the author says they are starting a new document.
---

# Start a paper

## Steps

1. Read `overfull.yml`, `main.tex`, `metadata.tex` and everything in `notes/`.
2. Ask the author for anything that is not in `notes/`:
   - title, authors, affiliations, ORCID, contact email, keywords;
   - document type and venue (thesis, conference, journal, arXiv only);
   - the venue's page limit, anonymity (double-blind or not) and AI-disclosure
     requirement, with a link to the call for papers or style guide;
   - the document language.
3. Fill `metadata.tex` with what the author gave you. Leave a
   `% TODO(author):` comment for anything missing. Never make up names,
   affiliations or emails.
4. Set the language in `\DocumentMetadata` if it is not English.
5. Set up `overfull.yml` with the author's answers. This is the one time you
   edit it, and only with their confirmation:

   ```yaml
   profile: paper            # generic | thesis | paper | arxiv | double-blind
   references:
     mailto: author@example.org
   venue:
     pageLimit: { max: 9, endLabel: overfull:main-end }
     anonymous: true
     disclosure: required
   ```

   For a page limit with `endLabel`, make sure `\label{overfull:main-end}` sits
   where the venue's counted main text ends (usually just before the
   references).
6. Outline: create one file per section or chapter from the structure in
   `notes/` (or the author's outline), each with a `\section`/`\chapter`
   heading, a `sec:` label, and a comment listing the notes it should draw on.
   Do not write body text unless the author asks, and then only from `notes/`.
7. Remove the template's sample content the author does not want. Ask before
   deleting sample figures or references.
8. First build and check:

   ```sh
   overfull build
   overfull check --json
   ```

   Fix errors (see `fix-build`). Placeholder references from the template will
   be flagged; ask the author before removing them.
9. Commit: "Set up metadata, outline and venue configuration".

## Done

- `metadata.tex` holds real data or clear TODO markers.
- `overfull.yml` matches the venue as the author described it.
- The outline builds and `overfull check` reports no errors.
- You gave the author a list of open TODOs and the venue link you used.

## Pitfalls

- Do not copy text from the venue's call for papers or another paper into the
  document.
- Do not guess the page limit or anonymity rules from memory. Ask for the
  official link.
- For double-blind venues, keep author names out of `metadata.tex` output as
  the template shows, and out of PDF metadata.
