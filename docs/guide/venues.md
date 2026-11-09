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
| `generic` | Any LaTeX document | Accessibility `recommended`, disclosure `off` |
| `thesis` | Theses and dissertations | Accessibility `required` (PDF/UA output), disclosure `off`, no page limit |
| `paper` | Conference and journal papers | Disclosure and accessibility `recommended` |
| `arxiv` | Source packages for arXiv | arXiv packaging rules on, accessibility `recommended`, disclosure `off` |
| `double-blind` | Anonymous review | Anonymity checks on, disclosure and accessibility `recommended` |

No profile sets a page limit, and all of them accept any paper size. Set
`pageLimit` and `paper` under `venue:`. All profiles run all five checks.

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
| `disclosure` | `required` (a missing statement is an error), `recommended` (a missing statement is `info`) or `off`. |
| `accessibility` | `required` (problems are errors), `recommended` (warnings) or `off` (check skipped). |
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
from the `.aux` file and compares it with `max`. A partial page counts as a full
page. Without `endLabel`, every page counts. If the label is not in the `.aux`,
the check reports `page-limit-label-missing` (warning) and counts every page.
Going over the limit is `page-limit-exceeded` (error). The venue line of the
report shows the count as "main text N of M pages (T total)": N pages up to the
label, a limit of M, and T pages in the whole PDF.

If you are over, fix the content. Changing fonts, margins or spacing usually
breaks the venue's formatting rules and can get a paper desk-rejected. The
`fit-page-limit` skill describes what agents may and may not do.

## Anonymity

With `anonymous: true` (or the `double-blind` profile), Overfull checks:

- the PDF's Author metadata field (`anonymity-pdf-author`, error);
- the content of `\author` (`anonymity-author-named`, error);
- an acknowledgments section, which often names people and grants
  (`anonymity-acknowledgments`, warning);
- phrases such as "our previous work" (`anonymity-self-reference`, info).

It cannot catch everything. Also check for other first-person self-citations,
links to your own repositories or websites, file names and comments in the
source if you upload it, and names in figure images.

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
reports `disclosure-missing` as an error when it finds no disclosure in the
document. It recognises a heading that mentions both AI and its use (for example
`\section*{Use of Generative AI}`) or the label `\label{overfull:disclosure}`
anywhere in the source:

```latex
\section*{Use of Generative AI}\label{overfull:disclosure}
We used ... for ...
```

The check confirms that a statement exists and is not a placeholder: text such
as "TODO" or "TBD", or fewer than 40 characters, is reported as
`disclosure-placeholder` (an error with `required`, a warning with
`recommended`). It cannot tell whether the statement is accurate or meets the
venue's policy. The
`write-disclosure` skill lets an agent draft a statement from what actually
happened in the repository. You must read, correct and approve it. See
[Responsible use](./responsible-use.md).

## arXiv

`overfull check --profile arxiv` adds rules for arXiv's build system:

- no absolute paths in `\input`, `\includegraphics`, `\addbibresource` and similar
  commands (`arxiv-absolute-path`, error);
- no spaces in file names (`arxiv-filename-space`, warning);
- no `.eps` figures when the build log shows pdfLaTeX (`arxiv-eps-pdflatex`,
  warning);
- no `minted` or other shell-escape features (`arxiv-shell-escape`, warning);
- a `.bbl` file next to the main file, because arXiv does not run biber
  (`arxiv-missing-bbl`, info).

arXiv's own rules change; read its [submission help](https://info.arxiv.org/help/submit_tex.html)
before you upload. arXiv's
[list of supported processors](https://info.arxiv.org/help/faq/texlive.html)
has not included LuaLaTeX (it lists pdfLaTeX, LaTeX and XeLaTeX).

The paper template handles this: it builds with LuaLaTeX by default and with
pdfLaTeX for arXiv, using `make arxiv` or `latexmk -pdf`. The `.eps` rule reads
the log it is given, so to check the pdfLaTeX build, point `check` at its files:

```sh
make arxiv
overfull check --profile arxiv --checks build,output,venue \
  --log paper-arxiv.log --pdf paper-arxiv.pdf --aux paper-arxiv.aux
```

The thesis and slides templates build with LuaLaTeX and have no pdfLaTeX build. Plan for this before your
first arXiv submission with them. The `prepare-arxiv` skill covers comment
removal with `arxiv_latex_cleaner`.
