---
title: Venues
description: Venue profiles (generic, thesis, paper, arxiv, double-blind), venue fields in overfull.yml, page-limit counting with an end label, anonymity checks, and AI-use disclosure.
order: 33
section: Checks
---

The `venue` check applies the rules of the place you are submitting to. Overfull
does not know every conference and journal. You choose a built-in profile and
fill in the rules from the venue's call for papers or author guide.

## Profiles

Set one in `overfull.yml`, or pass it for a single run:

```yaml
profile: paper
```

```sh
overfull check --profile arxiv
```

| Profile | Use for | Defaults |
| --- | --- | --- |
| `generic` | Any LaTeX document | Accessibility as advice, no disclosure check |
| `thesis` | Theses and dissertations | Accessible PDF/UA output required, no page limit |
| `paper` | Conference and journal papers | Disclosure and accessibility recommended |
| `arxiv` | Source packages for arXiv | arXiv packaging rules on |
| `double-blind` | Anonymous review | Anonymity checks on, disclosure recommended |

Fields under `venue:` in `overfull.yml` override the profile.

## Venue fields

```yaml
venue:
  pageLimit: { max: 9, endLabel: overfull:main-end }
  anonymous: true
  disclosure: required
```

| Field | Meaning |
| --- | --- |
| `pageLimit.max` | Maximum number of pages that count. |
| `pageLimit.endLabel` | Count only up to the page with this label. |
| `paper` | Expected paper size: `a4`, `letter` or `any`. |
| `anonymous` | Run anonymity checks. |
| `disclosure` | `required` (missing statement is an error), `recommended` (info) or `off`. |
| `accessibility` | `required` (problems are errors), `recommended` or `off`. |
| `arxiv` | Apply the arXiv packaging rules. |

The full list is in the [configuration reference](./config.md).

## Page limits

Many venues limit the main text and let references and appendices run longer.
Put a label where the counted part ends:

```latex
... last paragraph of the conclusion.

\label{overfull:main-end}
\printbibliography
```

and set `endLabel: overfull:main-end`. Overfull reads the page of that label
from the `.aux` file and compares it with `max`. Without `endLabel`, every page
counts.

If you are over, fix the content. Changing fonts, margins or spacing usually
breaks the venue's formatting rules and can get a paper desk-rejected. The
`fit-page-limit` skill describes what agents may and may not do.

## Anonymity

With `anonymous: true` (or the `double-blind` profile), Overfull checks:

- the PDF's Author metadata field;
- the content of `\author`;
- an acknowledgments section, which often names people and grants.

It cannot catch everything. Also check for first-person self-citations ("our
earlier work [12]"), links to your own repositories or websites, file names and
comments in the source if you upload it, and names in figure images.

## AI-use disclosure

Policies on AI use in writing and reviewing differ between venues and change
often. Read the venue's current policy page before you submit. Some starting
points:

- [ACM policy on authorship](https://www.acm.org/publications/policy-on-authorship)
- [Springer Nature editorial policies](https://www.springernature.com/gp/policies/editorial-policies)
- [Elsevier generative AI policies for journals](https://www.elsevier.com/about/policies-and-standards/generative-ai-policies-for-journals)

For conferences (NeurIPS, ICML, ACL, CVPR and others), the policy is usually in
that year's call for papers or author guidelines. Universities set their own
rules for theses; ask your graduate school.

If the venue requires a statement, set `disclosure: required`. The check then
reports an error when it finds no disclosure in the document. It recognises a
heading about AI use (for example `\section*{Use of Generative AI}`) or the
label `\label{overfull:disclosure}` anywhere in the source:

```latex
\section*{Use of Generative AI}\label{overfull:disclosure}
We used ... for ...
```

The check confirms that a statement exists. It cannot tell whether the
statement is accurate or meets the venue's policy. The
`write-disclosure` skill lets an agent draft a statement from what actually
happened in the repository. You must read, correct and approve it. See
[Responsible use](./responsible-use.md).

## arXiv

`overfull check --profile arxiv` adds rules for arXiv's build system:

- no absolute paths in `\input`, `\includegraphics` or `\addbibresource`;
- no spaces in file names;
- no `.eps` figures when the build uses pdfLaTeX;
- no `minted` or other shell-escape features;
- a `.bbl` file present when packaging, named like the main file.

arXiv's own rules change; read its [submission help](https://info.arxiv.org/help/submit_tex.html)
before you upload. Note that the templates compile with LuaLaTeX, and arXiv's
[list of supported processors](https://info.arxiv.org/help/faq/texlive.html)
has not included LuaLaTeX (it lists pdfLaTeX, LaTeX and XeLaTeX). Plan for
this before your first arXiv submission.
The `prepare-arxiv` skill covers comment removal with `arxiv_latex_cleaner`.
