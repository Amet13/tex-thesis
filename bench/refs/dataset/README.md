# Reference-check benchmark: dataset

Two BibTeX files. Each entry carries its class in `x-bench`, so scoring needs no
separate labels file.

| File | Class (`x-bench`) | Entries | How they were obtained |
| --- | --- | --- | --- |
| `real.bib` | `real` | 124 | Looked up, never written by hand. 51 come from `packages/core/test/fixtures/refs/real.bib` (recorded from the indexes on 2026-11-08). The rest were found through the indexes' own listings (CrossRef `sample` by type, CrossRef title searches at random offsets, arXiv category listings) and then fetched with Overfull's lookup on 2026-11-10. `x-bench-source` on each entry says which listing and which lookup. |
| `fabricated.bib` | `invented` | 30 | Title words shuffled across three unrelated real titles, with the author list of a fourth work and no identifier. |
| `fabricated.bib` | `wrong-metadata` | 30 | A real title with another work's authors and a year 3 to 9 years off, no identifier. |
| `fabricated.bib` | `wrong-doi` | 30 | A real work's title, authors and year with the DOI of a different real work. |

The real set covers journal articles, proceedings papers, preprints (arXiv,
bioRxiv, medRxiv, SSRN), books, a dissertation and titles in other languages,
across computer science, physics, mathematics, biology, medicine, economics and
the social sciences.

`fabricated.bib` is generated, deterministically, from `real.bib`:

```bash
node bench/refs/make-fabricated.mjs --seed 1 --per-class 30
```

An invented title could in principle match a real work. The generator rejects
shuffles that overlap too much with any source title, but it does not ask an
index, so a coincidence cannot be ruled out completely.

To add real entries, look them up (for example `overfull cite --dry-run <doi>`)
and record where the identifier came from in `x-bench-source`. Then run the
generator again.
