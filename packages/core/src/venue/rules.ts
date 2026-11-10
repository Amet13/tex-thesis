import type { RuleInfo } from '../types.js';

export const venueRules: RuleInfo[] = [
  {
    id: 'page-limit-exceeded',
    check: 'venue',
    severity: 'error',
    title: 'Page limit exceeded',
    summary:
      'The document (or its main text, up to the end label) is longer than the venue allows.',
    fix: 'Shorten the main text, or move material to an appendix if the venue does not count it.',
  },
  {
    id: 'page-limit-label-missing',
    check: 'venue',
    severity: 'warning',
    title: 'Page-limit end label not found',
    summary:
      'The profile counts pages up to a label (default `overfull:main-end`), but the .aux has no such label, so all pages were counted.',
    fix: 'Put `\\label{overfull:main-end}` right after the last paragraph of the main text and rebuild.',
  },
  {
    id: 'page-limit-unchecked',
    check: 'venue',
    severity: 'info',
    title: 'Page limit not checked',
    summary: 'There was no PDF (or .aux label) to count pages from.',
    fix: 'Build the document first (`overfull build`).',
  },
  {
    id: 'text-outside-block',
    check: 'venue',
    severity: 'warning',
    title: 'Text outside the text block',
    summary:
      "Text on a page of the PDF reaches into the margin, measured against the text block of the venue's style file (2 mm tolerance). Only for venue profiles that record a text block.",
    fix: 'Find the line, table or figure that sticks out (`overfull pages <n>` renders the page) and make it fit. Changing the margins or the text block is usually against the rules.',
  },
  {
    id: 'paper-size-mismatch',
    check: 'venue',
    severity: 'warning',
    title: 'Wrong paper size',
    summary: 'Pages are not the paper size the venue expects (A4 or US Letter).',
    fix: 'Set the paper size in the class options or with `\\usepackage[a4paper]{geometry}` / `letterpaper`.',
  },
  {
    id: 'anonymity-pdf-author',
    check: 'venue',
    severity: 'error',
    title: 'Author name in PDF metadata',
    summary: 'The PDF Author field names a person in a double-blind submission.',
    fix: 'Set `\\hypersetup{pdfauthor={Anonymous}}` for the review version.',
  },
  {
    id: 'anonymity-author-named',
    check: 'venue',
    severity: 'error',
    title: 'Author named in the source',
    summary: '`\\author{...}` contains names in a double-blind submission.',
    fix: 'Use `\\author{Anonymous}` or the venue class’s anonymous/review option.',
  },
  {
    id: 'anonymity-acknowledgments',
    check: 'venue',
    severity: 'warning',
    title: 'Acknowledgments in an anonymous submission',
    summary: 'Acknowledgments often name people, grants or institutions and break anonymity.',
    fix: 'Remove the acknowledgments until the camera-ready version.',
  },
  {
    id: 'anonymity-self-reference',
    check: 'venue',
    severity: 'info',
    title: 'Possible self-identifying phrase',
    summary: 'Phrases such as "our previous work [3]" reveal who the authors are.',
    fix: 'Refer to your earlier work in the third person.',
  },
  {
    id: 'disclosure-missing',
    check: 'venue',
    severity: 'error',
    title: 'AI-use disclosure missing',
    summary:
      'The venue asks authors to state whether and how generative AI tools were used; no such statement was found.',
    fix: 'Add a short section, e.g. `\\section*{Use of Generative AI}\\label{overfull:disclosure}`. The author writes the statement: which AI tools were used and for what, and that the authors checked the output. Only the author can say whether none were used.',
  },
  {
    id: 'disclosure-placeholder',
    check: 'venue',
    severity: 'error',
    title: 'AI-use disclosure is a placeholder',
    summary:
      'The disclosure section exists but still holds placeholder text or almost nothing. Submitting it as is misstates how the paper was written.',
    fix: 'The author writes the statement: which AI tools were used and for what, and that the authors checked the output. Only the author can say whether none were used.',
  },
  {
    id: 'arxiv-absolute-path',
    check: 'venue',
    severity: 'error',
    title: 'Absolute path (arXiv)',
    summary: 'arXiv compiles only the uploaded files, so absolute paths break the build.',
    fix: 'Use paths relative to the main file.',
  },
  {
    id: 'float-after-main-end',
    check: 'venue',
    severity: 'warning',
    title: 'Figure or table floated past the end of the main text',
    summary:
      'A main-text figure or table landed on a page after the page-limit end label. It may escape the page count, but reviewers see it among the references or appendix.',
    fix: 'Place the float earlier (`[t]`/`[htbp]`, or closer to its first reference) so it lands before the end label, or move it to the appendix on purpose.',
  },
  {
    id: 'arxiv-unsupported-engine',
    check: 'venue',
    severity: 'error',
    title: 'Built with LuaLaTeX (arXiv)',
    summary:
      'arXiv compiles submissions with pdfLaTeX. A paper that only builds with LuaLaTeX (fontspec, Lua code) fails there, and a LuaLaTeX log says nothing about the arXiv build.',
    fix: 'arXiv compiles with pdfLaTeX; build with `make arxiv` / `latexmk -pdf` and check that log with --log.',
  },
  {
    id: 'arxiv-eps-pdflatex',
    check: 'venue',
    severity: 'warning',
    title: 'EPS figure with pdfLaTeX (arXiv)',
    summary:
      'pdfLaTeX cannot include .eps files directly, and arXiv will not convert them for you.',
    fix: 'Convert figures to PDF with `epstopdf` and include the .pdf.',
  },
  {
    id: 'arxiv-shell-escape',
    check: 'venue',
    severity: 'warning',
    title: 'Shell escape needed (arXiv)',
    summary: 'Packages such as `minted` need `-shell-escape`, which arXiv does not enable.',
    fix: 'Switch to `listings`, or pre-generate the output and upload it.',
  },
  {
    id: 'arxiv-missing-bbl',
    check: 'venue',
    severity: 'info',
    title: '.bbl not present (arXiv)',
    summary:
      'arXiv does not run biber; with biblatex you must upload the .bbl generated by your build.',
    fix: 'Build locally, then include the .bbl named like the main file (`main.tex` → `main.bbl`; a `<jobname>.bbl` must be copied to that name) in the upload.',
  },
  {
    id: 'arxiv-filename-space',
    check: 'venue',
    severity: 'warning',
    title: 'File name with spaces (arXiv)',
    summary: 'arXiv’s processing breaks on file names containing spaces.',
    fix: 'Rename files using - or _ instead of spaces.',
  },
  {
    id: 'venue-profile-stale',
    check: 'venue',
    severity: 'info',
    title: 'Venue profile may be out of date',
    summary:
      'The profile was last compared with the venue’s official pages more than 14 months ago. Page limits, style files and policies change between years.',
    fix: 'Read the venue’s current author instructions (the profile lists its sources) and compare them with what Overfull reports.',
  },
  {
    id: 'style-file-modified',
    check: 'venue',
    severity: 'warning',
    title: 'Style file differs from the official one',
    summary:
      'The project’s copy of a style or class file named by the profile does not match the SHA-256 recorded for the official file. Venues often reject papers built with a changed style file. Only profiles that record a hash are checked; a copy with Windows line endings is compared after converting them.',
    fix: 'Download the style file again from the venue’s page and keep your own changes in separate files.',
  },
  {
    id: 'layout-tampering',
    check: 'venue',
    severity: 'warning',
    title: 'Source squeezes the layout',
    summary:
      'The source uses a command often used to fit more text on a page: a negative `\\vspace` next to a figure, table or heading, negative float or equation spacing, line spacing below 1, `savetrees`, or (for profiles that name a style file) changed margins, text block or base font size. Overfull cannot tell whether your venue allows it.',
    fix: 'Check that your venue allows this. If it does not, remove the command and shorten the text instead.',
  },
  {
    id: 'anonymity-link',
    check: 'venue',
    severity: 'warning',
    title: 'Link that can identify the authors',
    summary:
      'An anonymous submission links to a personal repository (`github.com/<user>`, GitLab, Bitbucket), a personal page (`*.github.io`, Google Sites, `~user`) or an institutional page. Links to anonymous.4open.science are allowed. A link to someone else’s page is reported too.',
    fix: 'Use an anonymized copy such as anonymous.4open.science, or remove the link for the review version. Ignore the warning for links that are not yours.',
  },
  {
    id: 'tex-file-skipped',
    check: 'venue',
    severity: 'info',
    title: 'Source file not read',
    summary:
      'A .tex/.sty/.cls file in the project was not read for the venue checks: it is not a regular file (a pipe, socket or device) or it is larger than 20 MB.',
    fix: 'Nothing to do if the file is not part of the document. Otherwise replace it with a regular file of normal size.',
  },
];
