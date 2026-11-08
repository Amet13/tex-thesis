/**
 * TeX → plain text, for matching and display. Not a TeX interpreter: it knows
 * the markup that appears in bibliography fields (accents, escapes, font
 * commands, inline math, dashes) and drops everything else.
 */

const SYMBOL_ACCENTS: Record<string, string> = {
  '`': '̀',
  "'": '́',
  '^': '̂',
  '~': '̃',
  '=': '̄',
  '.': '̇',
  '"': '̈',
};

const LETTER_ACCENTS: Record<string, string> = {
  u: '̆',
  v: '̌',
  H: '̋',
  c: '̧',
  k: '̨',
  r: '̊',
  d: '̣',
  b: '̱',
  t: '͡',
};

const SPECIAL_LETTERS: Record<string, string> = {
  ss: 'ß',
  o: 'ø',
  O: 'Ø',
  ae: 'æ',
  AE: 'Æ',
  oe: 'œ',
  OE: 'Œ',
  aa: 'å',
  AA: 'Å',
  l: 'ł',
  L: 'Ł',
  i: 'i',
  j: 'j',
  dh: 'ð',
  DH: 'Ð',
  th: 'þ',
  TH: 'Þ',
  ng: 'ŋ',
  NG: 'Ŋ',
};

const NAMED_SYMBOLS: Record<string, string> = {
  textendash: '–',
  textemdash: '—',
  textquoteright: '’',
  textquoteleft: '‘',
  textquotedblleft: '“',
  textquotedblright: '”',
  ldots: '…',
  dots: '…',
  textellipsis: '…',
  textregistered: '®',
  texttrademark: '™',
  copyright: '©',
  textcopyright: '©',
  S: '§',
  P: '¶',
  textasciitilde: '~',
  textbackslash: '\\',
  textunderscore: '_',
  times: '×',
  pm: '±',
  infty: '∞',
  to: '→',
  rightarrow: '→',
  leq: '≤',
  le: '≤',
  geq: '≥',
  ge: '≥',
  neq: '≠',
  approx: '≈',
  cdot: '·',
  ell: 'ℓ',
  // Spacing commands become a space.
  quad: ' ',
  qquad: ' ',
  ',': ' ',
  ';': ' ',
  ' ': ' ',
};

const GREEK = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'varepsilon',
  'zeta',
  'eta',
  'theta',
  'vartheta',
  'iota',
  'kappa',
  'lambda',
  'mu',
  'nu',
  'xi',
  'pi',
  'varpi',
  'rho',
  'varrho',
  'sigma',
  'varsigma',
  'tau',
  'upsilon',
  'phi',
  'varphi',
  'chi',
  'psi',
  'omega',
  'Gamma',
  'Delta',
  'Theta',
  'Lambda',
  'Xi',
  'Pi',
  'Sigma',
  'Upsilon',
  'Phi',
  'Psi',
  'Omega',
];
const GREEK_CHARS = 'αβγδεεζηθϑικλμνξπϖρϱσςτυφϕχψωΓΔΘΛΞΠΣΥΦΨΩ';
const GREEK_MAP: Record<string, string> = Object.fromEntries(
  GREEK.map((name, i) => [name, [...GREEK_CHARS][i] as string]),
);

/** Math operators that read as words: `\log n` → `log n`. */
const MATH_OPERATORS = new Set([
  'log',
  'ln',
  'exp',
  'sin',
  'cos',
  'tan',
  'lim',
  'max',
  'min',
  'sup',
  'inf',
  'det',
  'dim',
  'ker',
  'deg',
  'gcd',
  'Pr',
]);

/** Private-use placeholders so escaped characters survive brace stripping. */
const ESCAPES: Record<string, string> = {
  '{': '',
  '}': '',
  $: '',
  '&': '&',
  '%': '%',
  '#': '#',
  _: '_',
};
const RESTORE: Record<string, string> = { '': '{', '': '}', '': '$' };

function accent(base: string, mark: string): string {
  const letter = base === '\\i' ? 'i' : base === '\\j' ? 'j' : base;
  return (letter + mark).normalize('NFC');
}

function replaceAccents(s: string): string {
  const symbol = /\\([`'^"~=.])\s*(?:\{\s*(\\[ij]|[A-Za-z])\s*\}|(\\[ij])(?![A-Za-z])|([A-Za-z]))/g;
  const letter =
    /\\([uvHckrdbt])(?:\s*\{\s*(\\[ij]|[A-Za-z])\s*\}|\s+(\\[ij](?![A-Za-z])|[A-Za-z]))/g;
  return s
    .replace(symbol, (_m, cmd: string, a?: string, b?: string, c?: string) =>
      accent((a ?? b ?? c) as string, SYMBOL_ACCENTS[cmd] as string),
    )
    .replace(letter, (_m, cmd: string, a?: string, b?: string) =>
      accent((a ?? b) as string, LETTER_ACCENTS[cmd] as string),
    );
}

function replaceCommands(s: string): string {
  return s.replace(/\\([A-Za-z]+|[,; ])\*?(?:\{\})?/g, (_m, name: string) => {
    if (name in SPECIAL_LETTERS) return SPECIAL_LETTERS[name] as string;
    if (name in GREEK_MAP) return GREEK_MAP[name] as string;
    if (name in NAMED_SYMBOLS) return NAMED_SYMBOLS[name] as string;
    if (MATH_OPERATORS.has(name)) return name;
    // Font and structure commands (\emph, \textbf, \mathrm, \url…): keep the argument.
    return '';
  });
}

/**
 * Strips TeX markup from a bibliography field value.
 *
 * `{\"o}` → `ö`, `\'e` → `é`, `\&` → `&`, `\emph{x}` → `x`, `--` → `–`,
 * `$\alpha$` → `α`. Braces and math delimiters are removed and whitespace is
 * collapsed.
 */
export function texToPlain(s: string): string {
  let out = s.replace(/\\([{}$&%#_])/g, (_m, c: string) => ESCAPES[c] as string);
  out = out.replace(/\\\\/g, ' ');
  out = replaceAccents(out);
  out = replaceCommands(out);
  out = out
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/``|''/g, '"')
    .replace(/~/g, ' ')
    .replace(/[{}$]/g, '')
    .replace(/[-]/g, (c) => RESTORE[c] as string);
  return out.replace(/\s+/g, ' ').trim().normalize('NFC');
}
