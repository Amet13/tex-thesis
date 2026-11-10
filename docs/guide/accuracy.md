---
title: How accurate is the reference check
description: How Overfull's reference check is measured against real and fabricated bibliography entries, what the numbers mean, and what the check cannot do.
order: 53
section: Project
---

No measured run has been published yet. This page describes the method; the
table will be added from the first monthly run that is committed to the
repository as `bench/refs/results.json`.

## Method

The benchmark lives in `bench/refs/`. It checks two BibTeX files with the same
code `overfull check` uses, against the live indexes:

- **Real entries** (124): works found through the indexes' own listings and
  fetched with Overfull's lookup, never written by hand. Journal articles,
  proceedings papers, preprints, books, a dissertation and titles in other
  languages, across several fields.
- **Fabricated entries** (90), derived mechanically from the real ones, 30 per
  class: invented titles with no identifier, real titles with wrong authors and
  year, and real entries carrying the DOI of a different work.

[The dataset notes](https://github.com/amet13/overfull/blob/main/bench/refs/dataset/README.md)
say how every entry was obtained.

## What is reported

- **False "not found" on real works.** The share of real entries the check
  reports as `reference-not-found`. This is the number that matters most: a
  check that cries wolf teaches people to ignore it.
- **Detection per fabricated class.** The share reported as not found, as a
  metadata mismatch, or as a DOI that belongs to another work.
- **Undecided.** Entries the check could not decide, because no index answered
  or the kind of entry is not indexed.
- **Time** per entry (median and 95th percentile) and in total, and which
  indexes were reachable during the run.

Each number comes with its count and a 95% confidence interval.

## Run it yourself

```bash
node bench/refs/run.mjs
```

It writes `bench/refs/results.json` and prints the table. A GitHub workflow
(`.github/workflows/bench.yml`) runs it monthly and on demand.

## What the check cannot do

- It does not judge whether a cited work supports the sentence that cites it.
- Index coverage is incomplete. Theses, workshop papers, technical reports,
  books from small publishers and very recent work are often missing. Such
  entries are reported as "could not be checked", never as invented.
- A "not found" is a prompt to look at the entry, not proof that the work does
  not exist.
