---
title: Use with Overleaf
description: Check an Overleaf project in your browser from its source zip, or run Overfull on every change through Overleaf's GitHub sync and the GitHub Action.
order: 5
section: Start
---

You do not have to leave Overleaf to use Overfull. Keep writing there and pick
the way that fits how often you want a check.

- **A quick look:** download the source zip and drop it on the [browser
  check](https://amet13.github.io/overfull/check/). Nothing to install.
- **Every change:** link the project to GitHub with Overleaf's GitHub sync and
  run the [GitHub Action](./action.md) on the repository.

## A quick look: the source zip in the browser check

1. In Overleaf, open the project. Choose **File**, then **Download**, then
   **Download as source (.zip)**. From the projects dashboard, the **Download
   .zip file** button does the same.
   ([Overleaf: Downloading a project](https://docs.overleaf.com/managing-projects-and-files/downloading-a-project),
   read 2026-11-10.)
2. Open the [browser check](https://amet13.github.io/overfull/check/) and drop the zip on it, or use
   **Choose files or a .zip**. You can also drop or choose the unzipped folder.
3. The page finds the main file (`main.tex`, else the only top-level `.tex`
   with a `\documentclass`; if several fit, it asks you to choose) and the
   `.bib` files, then runs the reference check and the venue checks that need
   only source files.

The zip is unpacked in your browser and never uploaded. Reference lookups are
the only network requests, and you can switch them off with **Verify references
online**.

**What the zip does not contain.** Overleaf says the zip holds the source files
only ([same page](https://docs.overleaf.com/managing-projects-and-files/downloading-a-project)).
It has no PDF or build log, so the page cannot check the build, the output or
accessibility from the zip alone. To add them, download the PDF from Overleaf
and, if you want the build check, the log from **Logs and output files**
(check Overleaf's documentation for which files that menu offers), and drop
those on the page with the zip, or after it. The `.log` and `.pdf` that have the same name
as the main file are used.

**Limits.** At most 2,000 files, 200 MB unpacked, and 50 MB per file. Encrypted
and ZIP64 archives are refused with a message. Absolute paths, paths with `..`,
`__MACOSX/` and dot-files are ignored. For anything bigger, or for the full
check with veraPDF, arXiv and DBLP, run `overfull check` on the unzipped
folder.

## Every change: GitHub sync and the Action

Overleaf's GitHub sync links a project to a repository on GitHub.com. Overleaf
describes it as a premium feature and says sync is manual: you push Overleaf
changes to GitHub and pull GitHub changes into Overleaf from the project's
GitHub menu. Check Overleaf's documentation for which plans include it and for
current limits.
([Overleaf: GitHub synchronization](https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization/github-synchronization),
read 2026-11-10.)

1. In Overleaf, link your GitHub account in your account settings, then open
   **Integrations**, then **GitHub**, and create a repository from the project.
   Overleaf's documentation says an existing project cannot be linked to an
   existing repository, so start from the project.
2. In the new repository, add a workflow that builds the PDF and runs the
   Action. The build step is yours; the Action checks what it produced:

   ```yaml
   name: paper
   on: [push, pull_request]

   permissions:
     contents: read

   jobs:
     check:
       runs-on: ubuntu-26.04
       steps:
         - uses: actions/checkout@v7
         # ... your step that builds main.pdf and main.log ...
         - uses: amet13/overfull@v3
           with:
             pdf: main.pdf
             log: main.log
             bib: references.bib
             aux: main.aux
   ```

   The [GitHub Action](./action.md) page lists every input, and the template
   workflow shows a build in the Overfull Docker image.
3. Add an `overfull.yml` for your main file and bibliography (see
   [Configuration](./config.md)).
4. Each time you push Overleaf changes to GitHub, the workflow runs. Fix
   problems in Overleaf, push again, and read the result on the commit or pull
   request.

Overleaf also offers a Git integration (`git clone` from `git.overleaf.com`).
Overleaf calls it a premium feature as well; see
[Overleaf: Git integration](https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization/git-integration).
Clone the project, run `overfull build --engine docker` and `overfull check`
locally, and `git push` to send fixes back.

## Differences to expect when you build outside Overleaf

- **Engine.** Overfull builds with LuaLaTeX unless a `.latexmkrc` sets
  `$pdf_mode = 1;` (pdfLaTeX). If the project was written for pdfLaTeX, add a
  `.latexmkrc` next to `main.tex`:

  ```perl
  $pdf_mode = 1;   # pdfLaTeX
  ```

  Check Overleaf's project settings for the compiler the project uses.
- **Tagging.** The templates turn on PDF tagging. A package that does not yet
  support tagging may cause warnings; the accessibility check shows them.
- **File name case.** Linux and arXiv are case-sensitive. The build check
  reports missing files.
- **Collaboration.** Overleaf's real-time editing and comments have no
  equivalent in Git, and Overleaf says pulling from GitHub can lose or displace
  track changes and comments. Many groups keep Overleaf for writing and use
  Git and Overfull for checks and releases.

## Moving the project off Overleaf

Get the source onto your machine (zip, GitHub sync or Git clone), then either
keep your own structure or start from a template and copy your content in:

```sh
overfull init paper my-paper
```

Copy sections into `sections/` (or `chapters/`), images into `figures/`, and
your `.bib` into `references.bib`; move title and author into `metadata.tex`.
Then `make build` and `make check`, and push to GitHub. The template's workflow
builds the PDF in Docker on every push and pull request.
