/** Lookup tables behind the root-cause explanations. */

/** Splits a whitespace-separated word list. */
function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Splits a comma-separated list. */
function list(text: string): string[] {
  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Commands defined by a package, for "load package X" advice. */
export const COMMAND_PACKAGES: Record<string, string> = {
  mathbb: 'amssymb',
  mathfrak: 'amssymb',
  checkmark: 'amssymb',
  square: 'amssymb',
  blacksquare: 'amssymb',
  leqslant: 'amssymb',
  geqslant: 'amssymb',
  varnothing: 'amssymb',
  therefore: 'amssymb',
  mathscr: 'mathrsfs',
  eqref: 'amsmath',
  text: 'amsmath',
  dfrac: 'amsmath',
  tfrac: 'amsmath',
  binom: 'amsmath',
  operatorname: 'amsmath',
  DeclareMathOperator: 'amsmath',
  boldsymbol: 'amsmath',
  intertext: 'amsmath',
  numberwithin: 'amsmath',
  bm: 'bm',
  toprule: 'booktabs',
  midrule: 'booktabs',
  bottomrule: 'booktabs',
  cmidrule: 'booktabs',
  includegraphics: 'graphicx',
  graphicspath: 'graphicx',
  rotatebox: 'graphicx',
  scalebox: 'graphicx',
  resizebox: 'graphicx',
  textcolor: 'xcolor',
  color: 'xcolor',
  colorbox: 'xcolor',
  definecolor: 'xcolor',
  rowcolor: 'xcolor (with the `table` option)',
  cellcolor: 'xcolor (with the `table` option)',
  url: 'url (or hyperref)',
  path: 'url',
  href: 'hyperref',
  hypersetup: 'hyperref',
  autoref: 'hyperref',
  texorpdfstring: 'hyperref',
  cref: 'cleveref',
  Cref: 'cleveref',
  crefname: 'cleveref',
  multirow: 'multirow',
  makecell: 'makecell',
  captionof: 'caption',
  captionsetup: 'caption',
  subcaption: 'subcaption',
  subcaptionbox: 'subcaption',
  subfloat: 'subfig',
  lipsum: 'lipsum',
  blindtext: 'blindtext',
  todo: 'todonotes',
  missingfigure: 'todonotes',
  xspace: 'xspace',
  ce: 'mhchem',
  lstinline: 'listings',
  lstset: 'listings',
  mintinline: 'minted',
  tikz: 'tikz',
  usetikzlibrary: 'tikz',
  pgfplotsset: 'pgfplots',
  nicefrac: 'nicefrac',
  sout: 'ulem',
  uline: 'ulem',
  hl: 'soul',
  euro: 'eurosym',
  degree: 'gensymb',
  celsius: 'gensymb',
  addbibresource: 'biblatex',
  printbibliography: 'biblatex',
  parencite: 'biblatex',
  textcite: 'biblatex',
  autocite: 'biblatex',
  footcite: 'biblatex',
  gls: 'glossaries',
  newacronym: 'glossaries',
  acrshort: 'glossaries',
  ac: 'acronym',
  newgeometry: 'geometry',
  geometry: 'geometry',
  setstretch: 'setspace',
  onehalfspacing: 'setspace',
  doublespacing: 'setspace',
  fancyhead: 'fancyhdr',
  fancyfoot: 'fancyhdr',
  pagestyle: 'fancyhdr',
  KOMAoption: 'a KOMA-Script class',
  newtheorem: 'amsthm (or the LaTeX kernel)',
  qedhere: 'amsthm',
  theoremstyle: 'amsthm',
  setmainfont: 'fontspec',
  setsansfont: 'fontspec',
  setmonofont: 'fontspec',
  newfontfamily: 'fontspec',
  setmathfont: 'unicode-math',
  SetKwFunction: 'algorithm2e',
  KwData: 'algorithm2e',
  State: 'algpseudocode',
  Require: 'algpseudocode',
  Ensure: 'algpseudocode',
  If: 'algpseudocode',
  For: 'algpseudocode',
  Procedure: 'algpseudocode',
  enquote: 'csquotes',
  num: 'siunitx',
  qty: 'siunitx',
  unit: 'siunitx',
  ang: 'siunitx',
  qtyrange: 'siunitx',
  numrange: 'siunitx',
  sisetup: 'siunitx',
};

/** natbib citation commands and their biblatex equivalents. */
export const NATBIB_TO_BIBLATEX: Record<string, string> = {
  citep: '\\parencite',
  Citep: '\\Parencite',
  citet: '\\textcite',
  Citet: '\\Textcite',
  citealp: '\\cite',
  citealt: '\\cite',
  citeyearpar: '\\parencite*',
  citeauthor: '\\citeauthor',
  Citeauthor: '\\Citeauthor',
  citeyear: '\\citeyear',
  citenum: '\\cite',
};

/** siunitx v2 command names and their v3 replacements. */
export const SIUNITX_V3: Record<string, string> = {
  SI: '\\qty',
  si: '\\unit',
  SIrange: '\\qtyrange',
  SIlist: '\\qtylist',
  SIproduct: '\\qtyproduct',
  numrange: '\\numrange',
};

/** Frequently used commands, for "did you mean" suggestions. */
export const COMMON_COMMANDS = words(`
  textbf textit texttt textsc textrm textsf emph underline textsuperscript textsubscript
  section subsection subsubsection paragraph chapter part caption label ref pageref eqref
  cite footnote footnotetext item begin end includegraphics centering raggedright
  noindent newline linebreak pagebreak newpage clearpage vspace hspace vfill hfill
  textwidth linewidth columnwidth tableofcontents listoffigures listoftables maketitle
  title author date thanks bibliography bibliographystyle printbibliography
  addbibresource usepackage documentclass newcommand renewcommand small footnotesize
  scriptsize large Large LARGE huge frac sqrt sum prod int infty alpha beta gamma delta
  epsilon varepsilon lambda sigma theta omega mathbf mathrm mathit mathcal mathbb left
  right cdot cdots ldots dots times leq geq neq approx equiv partial nabla rightarrow
  Rightarrow leftarrow mapsto hline multicolumn toprule midrule bottomrule url href
  textcolor parencite textcite autocite citep citet autoref cref Cref input include
  appendix today LaTeX TeX quad qquad mathbb operatorname
`);

/** Environments defined by packages. */
export const ENVIRONMENT_PACKAGES: Record<string, string> = {
  align: 'amsmath',
  'align*': 'amsmath',
  aligned: 'amsmath',
  gather: 'amsmath',
  'gather*': 'amsmath',
  multline: 'amsmath',
  'multline*': 'amsmath',
  'equation*': 'amsmath',
  split: 'amsmath',
  cases: 'amsmath',
  pmatrix: 'amsmath',
  bmatrix: 'amsmath',
  vmatrix: 'amsmath',
  matrix: 'amsmath',
  proof: 'amsthm',
  algorithm: 'algorithm (or algorithm2e)',
  algorithmic: 'algpseudocode (algorithmicx)',
  subfigure: 'subcaption',
  subtable: 'subcaption',
  tabularx: 'tabularx',
  longtable: 'longtable',
  tabulary: 'tabulary',
  lstlisting: 'listings',
  minted: 'minted',
  tikzpicture: 'tikz',
  axis: 'pgfplots',
  landscape: 'pdflscape',
  multicols: 'multicol',
  'multicols*': 'multicol',
  wrapfigure: 'wrapfig',
  comment: 'comment',
  frame: 'the beamer document class',
  columns: 'the beamer document class',
  threeparttable: 'threeparttable',
  tcolorbox: 'tcolorbox',
  mdframed: 'mdframed',
  refsection: 'biblatex',
  dmath: 'breqn',
  spacing: 'setspace',
  singlespace: 'setspace',
  CJK: 'CJK',
};

/** Theorem-like environments that need `\newtheorem`. */
export const THEOREM_LIKE = new Set(
  words(`
  theorem lemma corollary proposition definition remark example conjecture claim
  assumption hypothesis observation notation problem
`),
);

export const COMMON_ENVIRONMENTS = words(`
  itemize enumerate description figure figure* table table* tabular equation center
  flushleft flushright verbatim quote quotation minipage abstract document
  thebibliography array eqnarray align align* gather theorem lemma proof definition
  tikzpicture algorithm algorithmic subfigure tabularx longtable lstlisting appendix
  titlepage displaymath
`);

/** Math-only commands that cause `Missing $ inserted` in running text. */
export const MATH_COMMANDS = new Set(
  words(`
  alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu
  nu xi pi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi
  Sigma Phi Psi Omega frac dfrac sqrt sum prod int oint lim infty leq geq neq le ge ne
  approx equiv sim simeq propto pm mp times div cdot cdots circ partial nabla forall
  exists in notin subset subseteq supset cup cap emptyset rightarrow leftarrow to
  Rightarrow Leftarrow leftrightarrow mapsto mathbf mathrm mathit mathcal mathbb mathfrak
  boldsymbol hat bar tilde vec dot ddot overline underbrace overbrace log ln exp sin cos
  tan max min arg argmax argmin det mid parallel perp angle ell hbar Re Im aleph prime
  langle rangle lfloor rfloor lceil rceil left right
`),
);

/** Replacements for Unicode characters that pdfLaTeX does not know by default. */
export const UNICODE_REPLACEMENTS: Record<string, string> = {
  '≥': '$\\geq$',
  '≤': '$\\leq$',
  '≠': '$\\neq$',
  '≈': '$\\approx$',
  '±': '$\\pm$',
  '×': '$\\times$',
  '÷': '$\\div$',
  '→': '$\\rightarrow$',
  '←': '$\\leftarrow$',
  '⇒': '$\\Rightarrow$',
  '↔': '$\\leftrightarrow$',
  '∞': '$\\infty$',
  '∑': '$\\sum$',
  '∈': '$\\in$',
  '∀': '$\\forall$',
  '∃': '$\\exists$',
  '√': '$\\sqrt{}$',
  '∂': '$\\partial$',
  '·': '$\\cdot$',
  '−': '$-$',
  α: '$\\alpha$',
  β: '$\\beta$',
  γ: '$\\gamma$',
  δ: '$\\delta$',
  ε: '$\\varepsilon$',
  θ: '$\\theta$',
  λ: '$\\lambda$',
  μ: '$\\mu$ (or `\\textmu` from textcomp)',
  π: '$\\pi$',
  σ: '$\\sigma$',
  ω: '$\\omega$',
  Δ: '$\\Delta$',
  Σ: '$\\Sigma$',
  Ω: '$\\Omega$',
  '✓': '$\\checkmark$ (amssymb)',
  '✗': '$\\times$',
  '€': '\\euro{} (eurosym)',
  '™': '\\texttrademark',
  ' ': '~',
  '​': 'nothing (delete the zero-width space)',
  '﻿': 'nothing (delete the byte-order mark)',
};

/** TikZ keys, for "did you mean" suggestions on unknown keys. */
export const TIKZ_KEYS = list(`
  color, draw, fill, line width, thick, thin, very thick, ultra thick, dashed, dotted,
  densely dashed, solid, opacity, fill opacity, draw opacity, text, font, align, anchor,
  above, below, left, right, above left, above right, below left, below right,
  node distance, minimum width, minimum height, minimum size, text width, inner sep,
  outer sep, rounded corners, sharp corners, scale, rotate, xshift, yshift, shift,
  xscale, yscale, circle, rectangle, ellipse, label, pin, midway, near start, near end,
  pos, sloped, bend left, bend right, loop, out, in, looseness, shorten, arrows,
  line cap, line join, pattern, shading, top color, bottom color, left color,
  right color, ball color, double, radius, x radius, y radius, samples, domain, smooth,
  mark, every node, style, name, shape, grow, level distance, sibling distance,
  remember picture, overlay
`);

/** Levenshtein distance, giving up (returning max+1) once it exceeds `max`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length] ?? max + 1;
}

/** The closest candidate within a distance that scales with the word length. */
export function closest(word: string, candidates: readonly string[]): string | undefined {
  if (word.length < 3) return undefined;
  const max = word.length <= 4 ? 1 : 2;
  let best: string | undefined;
  let bestDistance = max + 1;
  for (const candidate of candidates) {
    if (candidate === word) return undefined;
    const d = editDistance(word, candidate, max);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}
