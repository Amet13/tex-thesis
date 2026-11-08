---
title: References
description: How Overfull verifies bibliography entries against CrossRef, doi.org, arXiv, DBLP and OpenAlex, the four outcomes, false positives, opting out, configuration, offline use, and why it never calls a reference fake.
order: 31
section: Checks
---

Invented references are the most visible failure of AI-assisted writing, and
they also happen by hand: a wrong year copied from a blog, a title from memory,
a DOI with a typo. The `references` check looks up every cited entry in public
scholarly indexes.

## How it works

For each entry that your document cites (keys come from the `.aux` or `.bcf`):

1. If it has a DOI, resolve it through doi.org and CrossRef.
2. Else, if it has an arXiv id (`eprint` with `archivePrefix = {arXiv}`, or an
   arXiv URL), query the arXiv API.
3. Else, search by title in CrossRef, then DBLP, then OpenAlex (OpenAlex only if
   a contact address or an OpenAlex key is configured).
4. Compare the best candidate's title, authors and year with your entry.

Results are cached in `.overfull/cache/refs.json`, so repeat runs are fast and
make few network requests. The templates git-ignore that folder.

## The four outcomes

| Outcome | Severity | Meaning |
| --- | --- | --- |
| `verified` | none | Found, and title, authors and year match. |
| `mismatch` | warning | Found, but the year, authors or title differ meaningfully. |
| `not-found` | error | A scholarly entry (article, inproceedings, incollection, phdthesis…) with no similar candidate in any index. |
| `unverifiable` | info | Not the kind of thing indexes cover: websites, software, standards such as RFCs, datasets. |

If a lookup itself fails (a timeout or a service error), the entry gets the
status `error` and the message says the service could not be reached. That says
nothing about your entry; run the check again later.

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
overfull cite 10.1145/3442188.3445922 --key bender2021 --dry-run
```

`--dry-run` prints the entry without writing it. `--bib` chooses the file when
you have several, and `--key` sets the citation key. If the lookup is not
confident, `cite` writes nothing and says so.

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

Opting out is visible in the source, so co-authors and reviewers can see which entries were not checked. Agents are told never to add opt-outs themselves.

## Configuration

```yaml
references:
  mailto: you@example.org   # sent to CrossRef and OpenAlex as a contact address
  ignore: [rfc9110]
```

`mailto` puts your requests in CrossRef's and OpenAlex's "polite pool", which is
faster and more reliable, and enables OpenAlex title search. It is sent only to
those services. If you have an OpenAlex API key, the programmatic API accepts it
as the `openalexKey` option; OpenAlex search is then used even without `mailto`.

## Offline

```sh
overfull check --offline
```

The references check is skipped with the reason "offline". Other checks run
normally.
