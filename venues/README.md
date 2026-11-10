# Venue profiles

One YAML file per venue profile, named `<id>.yml`. `node scripts/build-venues.mjs`
checks every file and writes `packages/core/src/venue/venues.generated.ts`, which
is committed. CI runs `node scripts/build-venues.mjs --check` (`pnpm venues:check`).
Never edit the generated file by hand.

Every field comes from the venue's official call for papers or author kit. Leave a
field out when you cannot confirm it: a wrong value is worse than none. See
"Adding a venue" in [CONTRIBUTING.md](../CONTRIBUTING.md) and the
[venues guide](../docs/guide/venues.md).

## Format

```yaml
id: example-2027            # same as the file name; lower-case words joined by "-"
name: Example Conference 2027
year: 2027                  # or: rolling
source:                     # required: official pages the values were read from
  - https://example.org/cfp
checkedOn: 2026-11-10       # required: the day you read those pages (YYYY-MM-DD)
extends: paper              # optional built-in profile: generic (default), thesis, paper, arxiv, double-blind
paper: letter               # a4 | letter | any
pageLimit:
  max: 9
  endLabel: overfull:main-end  # optional: count up to this label
  counts: Main text including figures and tables
  excludes: [References, Appendix]
anonymous: true             # double-blind review
disclosure: required        # required | recommended | off
accessibility: recommended  # required | recommended | off
styleFiles:                 # style or class files the venue requires
  - name: example_2027.sty
    sha256: <64 hex digits of the official file, only if you computed it from the official kit>
textBlock:                  # from the official style file, in millimetres (optional)
  widthMm: 139.7            # \textwidth
  heightMm: 228.6           # \textheight (with topMm: also checks top and bottom)
  topMm: 25.4               # distance from the top edge of the page
notes: Free text.
```

Required: `id`, `name`, `year`, `source`, `checkedOn`. A profile whose `checkedOn`
is more than 14 months old gets an info note that it may be out of date.
