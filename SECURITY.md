# Security policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.x (Overfull) | Yes |
| tex-thesis 2.x and older | No |

## Reporting a vulnerability

Please do not open a public issue. Use
[private vulnerability reporting](https://github.com/amet13/overfull/security/advisories/new).
You will get an acknowledgment within 72 hours and a resolution target of 30 days.

## Scope

- The `overfull` CLI and `@overfull/core`: they read local files (logs, PDFs,
  BibTeX) that may come from untrusted sources, and send reference titles and
  DOIs to public indexes (CrossRef, doi.org, DBLP, arXiv, optionally OpenAlex).
- The browser check on the website: files are processed in the browser and are
  never uploaded.
- The Docker image and the GitHub Action.
- CI/CD workflows (injection, token permissions).
- LaTeX shell escape: templates never enable it and `overfull build` never
  passes `-shell-escape`.

## Building untrusted projects is not safe

Only run `overfull build`, `overfull diff`, `make build` or `latexmk` on
projects you trust. A LaTeX project is code: its `.latexmkrc` is a Perl
script that latexmk runs, and TeX itself can read and write files. Running
the build in the Docker image limits what it can reach, but it still writes
to the mounted project directory and has network access.

`overfull check` on outputs (log, PDF, `.aux`, `.bib`) produced elsewhere is
the safe operation. It never runs code from the project: no LaTeX, latexmk,
Perl or project scripts, and nothing the project's `overfull.yml` chooses. The
only programs it may start are veraPDF and pdffonts, either installed locally
or in a Docker image chosen by `--image`, `$OVERFULL_IMAGE` or the default
(`build.image` in `overfull.yml` is ignored by `check`). In Docker they run with
no network, the project mounted read-only, an unprivileged user, all
capabilities dropped and a fixed entrypoint. `check` also:

- reads only regular files inside the project directory (after resolving
  symlinks); a `.bib` named in the source outside the project is skipped with
  a warning;
- never reads a reference cache located in the project when it runs in CI
  (any common CI provider, with or without `.git`), and outside CI never uses
  one reached through a symlink;
- in GitHub Actions, neutralizes workflow commands in everything it prints
  (log excerpts, titles, file names, error messages) and prints human output
  inside `::stop-commands::` with a random token.

The GitHub Action only runs `check`.

Commands that write (`cite --bib`, `diff --out`, `pages --out`, `init`) refuse
targets that leave the project directory through a symlink, and dangling
symlinks. `overfull cite` validates `--key` and generated keys, and removes
dangerous TeX (`\input`, `\write`, `\catcode`, `\directlua`…) from
publisher-supplied BibTeX.

## Supply chain

- Docker base image pinned by `sha256` digest.
- GitHub Actions pinned to commit SHAs.
- npm dependencies locked with `pnpm-lock.yaml`; packages published with provenance.
- Dependabot updates Actions, Docker and npm weekly.
