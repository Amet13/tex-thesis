---
title: References
description: How Overfull verifies bibliography entries against CrossRef, doi.org, arXiv, DBLP and (with an API key) OpenAlex, the outcomes, false positives, opting out, configuration, offline use, and why it never calls a reference fake.
order: 31
section: Checks
---

Invented references are the most visible failure of AI-assisted writing, and
they also happen by hand: a wrong year copied from a blog, a title from memory,
a DOI with a typo. The `references` check looks up every cited entry in public
scholarly indexes.

## How it works

For each entry that your document cites (keys come from the `.aux` or `.bcf`; if
neither exists, every entry is checked):

1. If it has a DOI, resolve it through doi.org and CrossRef (DataCite DOIs for
   datasets and software resolve through doi.org too).
2. Else, if it has an arXiv id (`eprint` with `archivePrefix = {arXiv}`, or an
   arXiv URL), query the arXiv API.
3. Else, if it names an ACL Anthology id or URL (`2020.acl-main.1`,
   `aclanthology.org/P19-1001`), fetch the record from the ACL Anthology; if it
   has a PubMed or PubMed Central id (`pmid`, `pmcid`, or a PubMed URL), fetch it
   from Europe PMC.
4. Else, search by title: CrossRef and DBLP at the same time, then arXiv (and
   OpenAlex when the `OPENALEX_API_KEY` environment variable is set). When none
   of them finds the work, Semantic Scholar and then Europe PMC are asked, one at
   a time, and at most three title searches answer for one entry. When DBLP
   cannot be reached and no OpenAlex key is set, OpenAlex is asked without a key.
5. Compare the best candidate's title, authors and year with your entry.

Entries that are websites, software, datasets, standards or manuals are not
looked up. An entry with a DOI or arXiv id is judged by that identifier alone.

Results are cached in your user cache folder (`~/.cache/overfull`, see
[Configuration](./config.md#cache)), so repeat runs are fast and make few
network requests. The cache is kept outside the project so it cannot be
committed: a committed cache could make a made-up reference look verified.
`references.cache: project` moves it into `.overfull/cache/refs.json`; that
opt-in is ignored in CI and when the cache path goes through a symlink.

A found record is reused for 30 days and a "not found" answer for 1 day (new
DOIs and new indexing appear quickly). A timeout, a server error or a bot wall
is never cached. Run `overfull check --refresh` (`refresh: true` in the core API) to
ignore stored answers, ask the indexes again and store the new ones.

An index that times out or answers with a server error twice in a row is
skipped for the rest of the run, so one slow service cannot stall the check. A
request must start answering within 4 seconds and finish within 10. The
indexes for one entry are asked at the same time, with the per-host spacing
unchanged.

## The outcomes

| Outcome | Rule id | Severity | Meaning |
| --- | --- | --- | --- |
| `verified` | none | none | Found, and title, authors and year match. |
| `mismatch` | `reference-metadata-mismatch` | warning | Found, but the year, authors or title differ meaningfully. |
| `mismatch` (wrong work) | `reference-doi-wrong-work`, `reference-arxiv-wrong-work` | error | The entry's DOI or arXiv id exists but belongs to a different paper (other title or authors). Find the right identifier, or re-add the entry with `overfull cite "<title>"`. Do not re-add it from the wrong identifier. |
| `not-found` | `reference-not-found` | error | An article, inproceedings, conference or incollection entry with no similar record in any index, or an entry whose DOI or arXiv id does not exist. |
| `unverifiable` | `reference-unverifiable` | info | Not the kind of thing indexes cover (websites, software, standards, datasets, manuals), a book, thesis or report that no index has, or an entry opted out. |
| `error` | `reference-lookup-failed` | warning | The lookup itself failed (a timeout, rate limit or service error). |

A failed lookup says nothing about your entry; run the check again later. The
cache means a second run only retries what failed.

The references check also reports problems that are not lookup outcomes:
`citation-key-missing` (error: a `\cite` key that no `.bib` file defines),
`bib-parse-error` (error, or warning for a duplicate field or undefined macro:
a malformed entry), `bib-outside-project` (warning: the document names a `.bib`
outside the project folder, for example `\bibliography{../shared/refs}`; it is
not read, so its entries were not checked; pass it with `--bib` from a project
that contains it, or move it in), `reference-unproven` and
`reference-not-reverified` (see [Provenance](#provenance)), and
`refs-cache-ignored` (info, see [Configuration](./config.md#cache)).

Four more rules look at the entries themselves:

| Rule id | Severity | Meaning |
| --- | --- | --- |
| `reference-retracted` | error | CrossRef records the matched work as retracted or withdrawn (its `updated-by` data, which includes Retraction Watch). The message names the notice. Asked once per 40 DOIs; answers are kept for one day. |
| `reference-published-version` | info | An arXiv entry whose arXiv record names a published DOI. Cite the published version with `overfull cite <doi>` if your venue prefers it. |
| `reference-duplicate` | warning | Two entries with the same DOI, the same arXiv id, or the same title and year. Works offline. |
| `reference-uncited` | info | No `\cite` uses the entry. Off by default: set `references.reportUncited: true`. Needs the cited keys from the `.aux`, `.bcf` or sources. |

## Why it never says "fake"

`not-found` means "no index we searched has this". That is strong evidence for
an invented reference when the entry is a recent journal article, and weak
evidence for an old book chapter, a workshop paper, or a thesis from a small
university. Overfull reports what it observed and leaves the judgement to you.

## False positives

Common reasons a real work shows as `not-found` or `mismatch`:

- The title in your entry is abbreviated, translated or has LaTeX markup that
  changes words.
- The work is a preprint and its published version has a different title or
  year. Cite the version you read.
- The venue is not indexed by CrossRef or DBLP (some workshops, regional
  journals, theses).
- Authors are listed differently (initials, transliteration, "and others").

The fastest fix is to add a `doi` field. If there is no DOI, check the title
character by character.

## Adding entries that pass

Let Overfull write the entry from the index:

```sh
overfull cite 10.1145/3442188.3445922
overfull cite arXiv:1706.03762
overfull cite "Attention Is All You Need"
overfull cite "Literate programming" --author Knuth
overfull cite 10.1145/3442188.3445922 --key bender2021 --dry-run
```

`--dry-run` prints the entry without writing it. `--bib` chooses the file when
you have several, and `--key` sets the citation key. If the lookup is not
confident, `cite` writes nothing and exits with 1. If a title matches several
works, it lists them with their DOIs and writes nothing; pick one by DOI or add
`--author` and `--year`. `cite` never overwrites an existing entry. The `.bib`
file must be inside the project.

## Opting an entry out

For an entry you know is right but cannot be verified, either add a note field:

```bibtex
@misc{internal-report-2024,
  title = {Internal Evaluation Report},
  note  = {overfull: skip},
}
```

or list its key in `overfull.yml`:

```yaml
references:
  ignore: [internal-report-2024, rfc9110]
```

Opted-out entries are reported as `reference-unverifiable` (info, reason "skipped
by author"). Opting out is visible in the source, so co-authors and reviewers can
see which entries were not checked. Agents are told never to add opt-outs
themselves.

## Provenance

`overfull cite` marks what it writes:

```bibtex
  x-overfull = {cite doi.org 2026-11-09 514dc6c201be}
```

The last part is a hash over the entry's type, key, title, authors, year, DOI
and eprint. Editing any of them by hand breaks it, and a marker without a
matching hash counts as no marker. The hash is tamper-evident, not
authentication: anyone can recompute it. The guarantee is verification against
the indexes; the marker only records that an entry came from real metadata.

With `references.requireCite: true` (the templates set it), every cited entry
that is not verified needs an intact marker and a DOI, eprint or URL, else
`reference-unproven` (error). Offline, that is still checked: entries with a
valid marker get `reference-not-reverified` (warning), entries without one are
errors. Books, websites and software follow the same rule; for one that
`overfull cite` cannot add, the author (never an agent) adds
`note = {overfull: author-provided}`, reported as a note (`info`) and not
verified. Only the author may write this note: it says the author vouches for the
entry, so an agent that adds it defeats the check.

**Writing entries by hand.** With `requireCite` on, an entry you type yourself
passes when it verifies against the indexes (a correct DOI is usually enough)
or when you add `note = {overfull: author-provided}`. Anything else is
`reference-unproven`. If you do not use agents at all, set
`requireCite: false`: every entry is still looked up, but none needs a marker
or note.

## Configuration

```yaml
references:
  mailto: you@example.org   # sent to CrossRef (and OpenAlex) as a contact address
  ignore: [rfc9110]
  requireCite: true         # unverified entries need an `overfull cite` marker or an author-provided note
  cache: user               # or `project`: .overfull/cache/refs.json (never read in CI)
  reportUncited: false      # true: report entries that nothing cites (reference-uncited)
```

`mailto` puts your requests in CrossRef's "polite pool", which is faster and more
reliable. You can also set it with the `OVERFULL_MAILTO` environment variable or
`--mailto`. It is sent only to CrossRef and OpenAlex. `mailto` does not turn
OpenAlex on. OpenAlex title search runs only when the `OPENALEX_API_KEY`
environment variable is set; it is not an `overfull.yml` key, so the key stays out
of your repository.

`SEMANTIC_SCHOLAR_API_KEY`, when set, is sent to Semantic Scholar for a higher
rate limit; without it the shared public limit applies. Like the OpenAlex key,
it is read from the environment only.

## Offline

```sh
overfull check --offline
```

The references check is skipped with the reason "offline: references were not
looked up". Missing citation keys, `.bib` syntax errors and, with
`requireCite`, entries without provenance are still reported.
Other checks run normally.
