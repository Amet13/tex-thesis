/**
 * Static data for the TeX error explainers: the ordered table of message
 * patterns (each names its handler in `explain.ts`) and the fixed texts of the
 * explanations that need no information from the log.
 */

export interface SimpleExplanation {
  rule: string;
  message: string;
  detail: string;
  fix: string;
}

/** Explanations whose text does not depend on the log, keyed by the name the pattern table uses. */
export const SIMPLE_EXPLANATIONS: Record<string, SimpleExplanation> = {
  lonelyItem: {
    rule: 'lonely-item',
    message: '`\\item` is used outside a list',
    detail: '`\\item` only works inside `itemize`, `enumerate` or `description`.',
    fix: 'Wrap the items in `\\begin{itemize}` … `\\end{itemize}` (or `enumerate`).',
  },
  missingItem: {
    rule: 'missing-item',
    message: 'LaTeX expected `\\item` here',
    detail:
      'Common causes: text inside a list before the first `\\item`, `\\\\` at the start of a paragraph, or an empty `thebibliography`.',
    fix: 'Start each list entry with `\\item`, move text before `\\begin{itemize}`, and remove `\\\\` after blank lines.',
  },
  noLineToEnd: {
    rule: 'no-line-to-end',
    message: '`\\\\` is used where there is no line to end',
    detail:
      '`\\\\` ends a line inside a paragraph; after a blank line, at the start of a paragraph or after a list there is no line yet.',
    fix: 'Remove the `\\\\`. Use a blank line for a new paragraph and `\\vspace{…}` for vertical space.',
  },
  invalidUtf8: {
    rule: 'unicode-character',
    message: 'A source file is not saved as UTF-8',
    detail:
      'LaTeX expects UTF-8 input, but the file contains bytes from another encoding (often Latin-1 or Windows-1252).',
    fix: 'Re-save the file as UTF-8 in your editor (or convert it with `iconv -f latin1 -t utf-8`).',
  },
  notInOuterParMode: {
    rule: 'not-in-outer-par-mode',
    message: 'A float or margin note is inside a box',
    detail:
      '`figure`, `table` and `\\marginpar` cannot be placed inside a `minipage`, `\\parbox`, table cell, another float, or similar box.',
    fix: 'Move the float outside the box. Inside a minipage, drop the `figure` environment and use `\\captionof{figure}{…}` (caption package).',
  },
  dimensionTooLarge: {
    rule: 'dimension-too-large',
    message: 'A length is larger than TeX allows (about 5.75 m / 16383pt)',
    detail:
      'Common causes: a typo in a length (`20000pt`), a pgfplots axis with huge coordinates, or scaling by a very large factor.',
    fix: 'Check the length on this line; for plots, rescale the data or set `restrict y to domain`/`scaled ticks`.',
  },
  floatsLost: {
    rule: 'not-in-outer-par-mode',
    message: 'Floats were lost',
    detail:
      'A `figure` or `table` (or `\\marginpar`) was placed inside a box or another float, so LaTeX dropped it.',
    fix: 'Move floats out of minipages, `\\parbox`es and other floats; use `\\captionof` for captions inside a minipage.',
  },
};

/**
 * Message patterns in match order. A key in `SIMPLE_EXPLANATIONS` selects a fixed
 * text; any other key names a handler in `explain.ts`.
 */
export const EXPLAINER_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/^Undefined control sequence/, 'explainUndefinedControlSequence'],
  [/^Missing \$ inserted/, 'explainMissingDollar'],
  [/^Display math should end with \$\$/, 'explainMissingDollar'],
  [/^Double (subscript|superscript)/, 'explainDoubleScript'],
  [/^Misplaced alignment tab character &/, 'explainAlignmentTab'],
  [/^Missing ([{}]) inserted/, 'explainMissingBrace'],
  [
    /^(?:Extra \}, or forgotten (?:\$|\\endgroup|\\right)|Too many \}'s|Argument of \S+ has an extra \})/,
    'explainExtraBrace',
  ],
  [
    /^(Paragraph ended before|File ended while scanning use of|File ended while scanning definition of|Forbidden control sequence found while scanning use of) (\\?[^\s.]+)(?:\s+was complete)?(?:\s*\.)?\s*$/,
    'explainRunaway',
  ],
  [/^(?:LaTeX|Package \S+) Error: File [`'](.+?)' not found/, 'explainFileNotFound'],
  [/^I can't find file [`'](.+?)'/, 'explainFileNotFound'],
  [/^LaTeX Error: Option clash for package (\S+?)\.?$/, 'explainOptionClash'],
  [/^LaTeX Error: Unknown graphics extension: (\.\S+?)\.?$/, 'explainGraphicsExtension'],
  [/^LaTeX Error: Environment (\S+) undefined/, 'explainEnvironmentUndefined'],
  [
    /^LaTeX Error: \\begin\{([^}]*)\} on input line (\d+) ended by \\end\{([^}]*)\}/,
    'explainEnvironmentMismatch',
  ],
  [/^LaTeX Error: \\begin\{(document)\}() ended by \\end\{([^}]*)\}/, 'explainEnvironmentMismatch'],
  [/^LaTeX Error: Lonely \\item/, 'lonelyItem'],
  [/^LaTeX Error: Something's wrong--perhaps a missing \\item/, 'missingItem'],
  [/^LaTeX Error: There's no line here to end/, 'noLineToEnd'],
  [/^LaTeX Error: Missing \\begin\{document\}/, 'explainMissingBeginDocument'],
  [/^LaTeX Error: Can be used only in preamble/, 'explainPreambleOnly'],
  [
    /^(?:LaTeX|Package inputenc) Error: Unicode character (\S+) \(U\+([0-9A-Fa-f]+)\)/,
    'explainUnicode',
  ],
  [/^Package inputenc Error: Invalid UTF-8 byte/, 'invalidUtf8'],
  [
    /^Package fontspec Error: The font "([^"]+)" cannot be found|^Package fontspec Error: [^"]*?font "([^"]+)"[^\n]*?not found/,
    'explainFontNotFound',
  ],
  [/^Font (\S+?)(?:=\S+)? (?:at [\d.]+pt )?not loadable/, 'explainTfmFont'],
  [/^Package biblatex Error: (.*)$/, 'explainBiblatex'],
  [/^Illegal parameter number in definition of (\\\S+?)\.?$/, 'explainParameterNumber'],
  [/^You can't use [`']macro parameter character #' in \w+ mode()/, 'explainParameterNumber'],
  [/^Package xcolor Error: Undefined color [`']([^']+)'/, 'explainColor'],
  [/^LaTeX Error: Not in outer par mode/, 'notInOuterParMode'],
  [/^Dimension too large/, 'dimensionTooLarge'],
  [/^TeX capacity exceeded, sorry \[(.+?)\]/, 'explainCapacity'],
  [/^Package (pgfkeys|tikz|pgf|pgfplots) Error: (.*)$/, 'explainTikz'],
  [/^Package hyperref Error: (.*)$/, 'explainHyperref'],
  [/^LaTeX Error: Command (\\\S+?) already defined/, 'explainCommandDefined'],
  [
    /^LaTeX Error: Unknown option [`']([^']+)' for (?:package|class) [`']([^']+)'/,
    'explainUnknownOption',
  ],
  [/^LaTeX Error: Float\(s\) lost/, 'floatsLost'],
];
