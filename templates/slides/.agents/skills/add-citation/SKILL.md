---
name: add-citation
description: Add a verified reference to the bibliography with `overfull cite` and cite it in the LaTeX source. Use whenever a sentence needs a citation, the author gives a DOI, arXiv id or paper title, or `overfull check` reports an undefined citation or a not-found reference. Never write BibTeX by hand or from memory.
---

# Add a citation

References are where a model's memory is most often wrong. `overfull cite` looks
the work up in the scholarly indexes and writes the entry from the indexed record
(the published version when arXiv names one). You only choose where to cite it.

## Steps

1. Get an identifier from the author or from `notes/`. Prefer, in order:
   a DOI, an arXiv id, the exact title. Do not take an identifier from your own
   memory of the literature.
2. Preview the entry:

   ```sh
   overfull cite 10.1145/3442188.3445922 --dry-run
   overfull cite arXiv:1706.03762 --dry-run
   overfull cite "Attention Is All You Need" --dry-run
   ```

3. Check that the preview is the work the author meant: title, authors, year,
   venue. If a title search returns a different paper, stop.
4. Write it:

   ```sh
   overfull cite arXiv:1706.03762
   overfull cite 10.1145/3442188.3445922 --key bender2021parrots
   ```

   Use `--key` only to match a key the author already uses, and `--bib file`
   only if `overfull.yml` lists more than one bibliography. Do not edit an entry
   `cite` wrote: its `x-overfull` marker would no longer match.
5. Cite the printed key where the author wants it: `\cite{key}`,
   `\textcite{key}` or `\parencite{key}` (biblatex), matching what the
   document already uses.
6. `overfull build` then `overfull check --json --checks build,output,references`.

## When cite says the title is ambiguous

Short or shared titles ("Literate programming") match several works. Cite then
lists candidates with their DOIs and adds nothing. Pick the one the author means:

- If the author or `notes/` names the authors or year, rerun with
  `--author <surname>` and/or `--year <yyyy>`, or cite the listed DOI directly.
- If you cannot tell which work is meant, show the candidates to the author and ask.
  Never pick one by guessing.

## When cite finds nothing

If `overfull cite` reports no confident match, do not retry with guessed
details and do not write an entry yourself. Tell the author:

- what you searched for (the exact query),
- that no indexed record matched,
- what you need: a DOI, an arXiv id, or the exact title.

Books, websites, software, standards and datasets are often not indexed. The
author can add those entries by hand. Check reports them as
`reference-unverifiable` (info), which is fine.

## Fixing problems check reports

- `reference-not-found` (error): remove the `\cite` and tell the author. Do not
  swap in a similar-sounding paper.
- `reference-metadata-mismatch` (warning): the entry differs from the record in
  year, authors or title. Show the author both versions. `overfull cite` never
  overwrites an entry (it prints the existing key and adds nothing). If the
  author agrees to replace it, they remove the old entry (or you do, at their
  request), then run `overfull cite <doi> --key <same key>`.
- `reference-doi-wrong-work`, `reference-arxiv-wrong-work` (error): the DOI or
  arXiv id belongs to a different paper. Do not re-add from that identifier.
  Ask the author for the right one, or search by exact title with
  `overfull cite "<title>"`.
- `reference-lookup-failed` (warning): too few indexes answered; not evidence
  against the entry. Ask the author for its DOI or arXiv id (those are checked
  directly), or rerun later.
- `reference-unproven` (error, with `references.requireCite`, which the
  templates turn on): the entry was not added with `overfull cite` and no index
  confirms it. Get a DOI or arXiv id from the author and add it with `cite`, or
  remove the `\cite`. Do not add the marker or an author-provided note yourself.
- `reference-not-reverified` (warning): the entry came from `cite` but could not
  be checked again (offline or an index was down). Rerun with network access.
- `bib-outside-project` (warning): a `.bib` outside the project was not read.
  Tell the author.
- `citation-key-missing` (error): the key is not in the bib. Add it with
  `overfull cite` or remove the `\cite`.

## Done

- Every new `\cite` key came from `overfull cite` or from the author.
- `overfull check` shows no `references` or `output` errors.
- You told the author about any entry you could not add.

## Pitfalls

- Do not add `note = {overfull: skip}`, `note = {overfull: author-provided}`,
  `references.ignore`, or an `x-overfull` field yourself: only the author opts
  an entry out.
- Do not cite a paper to support a claim you have not seen in `notes/` or from
  the author. A real reference attached to the wrong claim is still wrong.
