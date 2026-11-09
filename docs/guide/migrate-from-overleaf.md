---
title: Migrate from Overleaf
description: Use Overfull with an Overleaf project through Git, or move builds off Overleaf to your machine and GitHub Actions.
order: 3
section: Start
---

You do not have to leave Overleaf to use Overfull. You can keep editing there and
run checks on a Git copy, or move the build to Docker and GitHub Actions.

## Why people move builds

Overleaf's free plan has a short compile timeout. Since 2025 it has been
10 seconds, which a thesis with many figures or pgfplots plots can exceed. Paid
plans allow longer compiles. Check Overleaf's plans page for current limits.

Building with Docker locally or in GitHub Actions has no such limit, uses a
pinned TeX Live, and gives you a history of every change.

## Option 1: keep Overleaf, check with Git

Overleaf's Git integration and GitHub sync are available on paid plans.

**With the Git integration:**

1. In Overleaf, open **Menu** and find the Git clone URL for the project.
   Create a Git authentication token in your Overleaf account settings.
2. Clone it:

   ```sh
   git clone https://git.overleaf.com/<project-id> my-paper
   cd my-paper
   ```

3. Add an `overfull.yml` (see [Configuration](./config.md)) with your main file
   and bibliography, then build and check:

   ```sh
   overfull build --engine docker
   overfull check
   ```

4. Fix problems in Overleaf or locally. If you fix them locally, `git push`
   sends the changes back to Overleaf.

**With GitHub sync:** link the project to a GitHub repository from the Overleaf
menu. Add the [GitHub Action](./action.md) or the template workflow to that
repository, and every sync runs the checks.

Without a paid plan, download the source as a zip from Overleaf and run the same
commands on the extracted folder.

## Option 2: move the project

1. Get the source onto your machine (Git clone, GitHub sync, or zip download).
2. Start from a template and copy your content in, or keep your own structure:

   ```sh
   overfull init paper my-paper
   ```

   Copy sections into `sections/` (or `chapters/`), images into `figures/`, and
   your `.bib` into `references.bib`. Move title and author into `metadata.tex`.
3. Build and check:

   ```sh
   cd my-paper
   make build
   make check
   ```

4. Push to GitHub. The template's workflow builds the PDF in Docker on every push
   and pull request and attaches it as an artifact.

## Differences to expect

- **Engine.** The templates use LuaLaTeX. If your project relied on pdfLaTeX
  packages such as `inputenc` or `fontenc` with Type 1 fonts, check fonts and
  encoding after the move.
- **Tagging.** The templates turn on PDF tagging. A package that does not yet
  support tagging may cause warnings; the accessibility check shows them.
- **File name case.** Overleaf is forgiving about case in some paths; Linux and
  arXiv are not. The build check reports missing files.
- **Collaboration.** Overleaf's real-time editing and comments have no
  equivalent in Git. Many groups keep Overleaf for writing and use Git and
  Overfull for checks and releases.
