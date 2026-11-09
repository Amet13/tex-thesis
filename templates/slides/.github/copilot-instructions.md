# Copilot instructions

Follow `AGENTS.md` at the repository root: it holds the rules, the build and
check loop, and the definition of done for this LaTeX project. Before a task,
read the matching skill in `.agents/skills/<name>/SKILL.md`.

Never write BibTeX by hand: add references only with `overfull cite`.
Done means `overfull check --json` reports no errors.
