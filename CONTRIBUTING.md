# Contributing

Thanks for helping. Overfull is maintained by one person, so small, focused
pull requests with tests get merged fastest.

## Setup

```bash
pnpm install
pnpm build
pnpm test
```

You need Node 22.12 or newer and pnpm 12. Docker is needed for anything that
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
pnpm lint
pnpm typecheck
pnpm test
```

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
