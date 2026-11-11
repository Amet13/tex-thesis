# Maintaining Overfull

The repository keeps itself up to date. Workflows open pull requests for every
update, merge them when the full CI passes, release on their own, and open an
issue when something needs a person. This page lists what runs, when, and what
is still yours.

## What runs on its own

| When | Workflow | What it does |
| --- | --- | --- |
| Mondays | Dependabot | Pull requests for npm packages, GitHub Actions (also in the templates' workflows) and Docker base images, including the pinned TeX Live image. Patch, minor and digest updates are labelled `automerge`; major updates wait for you. |
| Tuesdays | `update-pins.yml` | Updates what Dependabot cannot: Node.js and veraPDF in `docker/Dockerfile` (version and SHA-256), and pnpm in `packageManager` and `docker/pnpm` together. |
| After each merge, and Wednesdays | `regenerate.yml` | Rebuilds `action/dist`, the agent files in the templates and the venue module, and opens a pull request when they changed (Dependabot cannot rebuild the bundled Action). |
| When ci or codeql finishes | `automerge.yml` | Merges a same-repository pull request labelled `automerge` once every check on its head commit has passed, then starts ci, image, pages and regenerate on `main` (a merge made by a workflow starts no workflows by itself). |
| Sundays | `ci.yml` | The full CI on `main`, so a change outside the repository (runner images, registries) is noticed without a commit. |
| 1st of the month | `autorelease.yml` (propose) | When shipped files changed since the last release, opens "Release vX.Y.Z+1": version bump, a CHANGELOG section from the commit subjects, rebuilt `action/dist`. |
| Daily | `autorelease.yml` (publish) | When `package.json` holds a version that has no tag yet and CI passed on `main`, starts `release.yml` with publish: tag, GitHub release with executables, Homebrew and Scoop files, and the three images. |
| 3rd of the month | `bench.yml` | Runs the reference-check benchmark against the live indexes and opens a pull request with `bench/refs/results.json`; the accuracy page renders it. |
| Wednesdays | `sources-health.yml` | Asks every reference source (doi.org, CrossRef, dblp, arXiv, OpenAlex, Semantic Scholar, ACL Anthology, Europe PMC) for one known work and one invented title. Sources that stop answering, answer with a bot wall, or no longer find the known work are listed in one issue: "Reference sources need a look". |
| 5th of the month | `venues-watch.yml` | Compares every venue profile's official pages (and arXiv's build pages) with the text stored when a person last read them, and puts the changed lines, the next edition's call for papers, and profiles not checked for a year in one issue: "Venue profiles need a look". Also checks each style file against the venue's official kit and opens a pull request when a hash changed. |
| 9th of the month | `refresh-recordings.yml` | Records again the live answers that the offline reference tests replay, and opens a pull request: green is merged, red means a source changed its answers or format. |
| After any of the above | `watchdog.yml` | Opens "Automation failed: <workflow>" when a run on `main`, a scheduled run or an automation branch fails, and closes it when that workflow next succeeds. |

Every pull request goes through the same CI as a person's: lint, types, unit
tests on three operating systems, the image builds (full, check-only, medium),
the corpus on TeX Live and the three templates built and checked. Nothing is
merged on a red or missing check.

## What stays with a person

- **Major updates.** Dependabot's major-version pull requests are not labelled
  `automerge`. Review the changelog of the dependency, then merge or close.
- **Venue rules.** `venues-watch.yml` reports which official pages changed and
  shows the changed lines. Read the venue's pages and update or add the profile by
  hand (CONTRIBUTING.md, "Adding a venue"), then run
  `node scripts/venues-watch.mjs --accept <id>` in the same pull request. Page
  limits, what counts toward them, anonymity and disclosure rules are prose: no
  script and no language model extracts them, because a wrong limit would reject a
  correct paper. Only style-file hashes follow the official kit automatically.
- **Reference sources.** When "Reference sources need a look" is open, read the
  source module in `packages/core/src/refs/sources/` and the API documentation it
  links. A bot wall or a new response format needs a code change; an outage needs
  nothing.
- **API keys (optional).** Repository secrets `OPENALEX_API_KEY` and
  `SEMANTIC_SCHOLAR_API_KEY` (free keys) and the variable `OVERFULL_MAILTO` make
  the benchmark and the source check independent of the keyless budgets that
  runners share.
- **Issues the automation opens.** Each links the failing run. Fix the cause in a
  pull request; the issue closes itself on the next successful run.
- **Agent evals.** They cost money and run only when you start them
  (`evals/README.md`).

## Repository settings this needs

Set these once; the workflows cannot set them:

1. **Settings → Actions → General → Workflow permissions:** tick "Allow GitHub
   Actions to create and approve pull requests". Without it the maintenance
   workflows cannot open their pull requests.
2. **Branch protection on `main`:** if you require reviews, the automation's
   merges are refused; require status checks instead (for example "Lint, types,
   unit tests" and "Image, corpus, templates, Action"), or exempt GitHub Actions
   from the review rule.
3. **Packages:** make `ghcr.io/amet13/overfull` public (Package settings → Change
   visibility), so anyone can pull the images.

The `automerge` and `maintenance` labels are created by the workflows on first
use.

## Turning it off

Disable a workflow under Actions → the workflow → "Disable workflow". To stop
automatic merges entirely, disable `automerge.yml`; pull requests then stay open
for you. To stop automatic releases, disable `autorelease.yml`; releasing by hand
still works (CONTRIBUTING.md, "Cutting a release").
