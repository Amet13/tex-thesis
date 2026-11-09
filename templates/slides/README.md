# Defense slides

A Beamer deck (16:9, LuaLaTeX) for a thesis defense, made from the
[Overfull](https://github.com/amet13/overfull) slides template. The look is
defined in the local theme `beamerthemeThesisSlides.sty`; title and author
come from `metadata.tex`; frames live in `sections/slides.tex`.

**Accessibility:** Beamer cannot produce a tagged (PDF/UA) document, so
`overfull.yml` leaves the accessibility check out. Images still carry alt
text and the PDF has a title and language. Share the thesis PDF (PDF/UA-2)
together with the slides; for a fully tagged deck look at the `ltx-talk` class.

## Two ways to work

**With an AI agent.** `AGENTS.md` and `.agents/skills/` tell the agent how
to build and check the deck. Keep your speaker notes and numbers in `notes/`.

**By hand.** Edit the `.tex` files and run:

```sh
make build    # slides.pdf
make watch    # rebuild on every save
make check    # preflight: build log and PDF
make pages PAGES=1-4   # render slides to PNG
make diff     # PDF showing changes against origin/main
make clean    # remove build files (keeps the PDF)
make help     # all targets
```

Only Docker is required; a local TeX Live 2026 works too.

Licensed MIT-0: use it without attribution.
