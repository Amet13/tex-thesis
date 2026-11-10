# Contributing

Thanks for helping. Overfull is maintained by one person, so small, focused
pull requests with tests get merged fastest.

## Setup

```bash
pnpm install
pnpm build
pnpm test
```

You need Node 26 or newer and pnpm 12 (`corepack enable` or
`npm install -g pnpm@12`). Docker is needed for anything that
compiles LaTeX (corpus, templates, end-to-end tests).

## Where things live

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). In short: checks live in
`packages/core`, the command line in `packages/cli`, templates in `templates/`,
agent skills in `skills/`, the website in `site/`.

## The most useful contribution: a corpus case

If Overfull did not recognize a LaTeX error, or explained it badly:

1. Add `corpus/<short-id>/main.tex` that reproduces it with as little code as possible.
2. Add `corpus/<short-id>/case.json` with the engine and the rule you expect.
3. Run `pnpm corpus:capture <short-id>` (needs Docker) to record the real log.
4. Add or improve the rule in `packages/core/src/log/`, then `pnpm test`.

CI recompiles every case on the pinned TeX Live, so rules stay correct when
TeX Live changes.

## Changing a template or a skill

Edit `skills/` or `shared/agents/`, never the copies inside `templates/*/.agents`.
Then run `pnpm templates:sync`. CI fails if templates drift.

## Checks before you push

```bash
pnpm lint            # Biome, markdownlint, portable file names
pnpm build
pnpm typecheck
pnpm test
pnpm templates:check
```

If you changed `action/src` or anything it bundles, rebuild the Action and
commit `action/dist`: `pnpm --filter overfull-action build` (CI checks it).

`make help` lists the Docker tasks: `make image`, `make corpus`, `make e2e`.

## Cutting a release (maintainers)

Overfull ships as a Docker image, GitHub Release downloads and the Action. It is
not published to npm.

1. `node scripts/bump-version.mjs X.Y.Z --dry-run`, then without `--dry-run`.
   It updates every `package.json`, core's `VERSION`, `CITATION.cff` and, on a
   new major version, every `:<major>` image tag and `@v<major>` Action
   reference.
2. Add the `## [vX.Y.Z]` section to `CHANGELOG.md`; run
   `pnpm build && pnpm --filter overfull-action build` and the checks above.
3. Optional dry run: run the `release` workflow manually on the branch
   (Actions → release → Run workflow). It builds every asset and publishes nothing.
4. Merge to `main` and wait for CI to pass. Then open Actions → release →
   Run workflow, pick `main`, tick **publish** and run it. No clone needed. It:
   - refuses to run unless CI passed on that commit and `vX.Y.Z` is not
     released yet;
   - builds the executables, `overfull.cjs`, template PDFs, `SHA256SUMS` and
     the signed provenance, then creates the `vX.Y.Z` tag and GitHub release;
   - moves the Action's major tag (`vX`);
   - publishes `ghcr.io/amet13/overfull:X.Y.Z`, `X.Y` and `X`.

   Pushing a `vX.Y.Z` tag yourself does the same (the image is then built by
   `image.yml` on the tag push).

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
