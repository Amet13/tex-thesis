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

## Supply chain

- Docker base image pinned by `sha256` digest.
- GitHub Actions pinned to commit SHAs.
- npm dependencies locked with `pnpm-lock.yaml`; packages published with provenance.
- Dependabot updates Actions, Docker and npm weekly.
