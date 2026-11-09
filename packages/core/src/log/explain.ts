/**
 * Root-cause explanations for TeX errors.
 *
 * Each explainer recognises one error message and turns TeX's terse report into
 * a plain-language message, the reason, and a concrete fix, quoting the
 * author's own text where the log shows it.
 */

import {
  COMMAND_PACKAGES,
  COMMON_COMMANDS,
  COMMON_ENVIRONMENTS,
  closest,
  ENVIRONMENT_PACKAGES,
  MATH_COMMANDS,
  NATBIB_TO_BIBLATEX,
  SIUNITX_V3,
  THEOREM_LIKE,
  TIKZ_KEYS,
  UNICODE_REPLACEMENTS,
} from './hints.js';
import { extension } from './paths.js';
import type { LogError } from './types.js';

export interface Explanation {
  rule: string;
  check: 'build' | 'output';
  message: string;
  detail?: string;
  fix?: string;
  data?: Record<string, unknown>;
}

export interface ExplainContext {
  /** Packages loaded in the run (basenames of opened `.sty` files, without extension). */
  packages: ReadonlySet<string>;
}

type Explainer = (m: RegExpExecArray, error: LogError, ctx: ExplainContext) => Explanation;

/** Wraps text in backticks for inline code. */
const code = (text: string): string => `\`${text}\``;

/** The source line TeX was reading, reconstructed from the `l.<n>` context. */
function sourceText(error: LogError): string {
  if (!error.source) return '';
  return (error.source.before.replace(/^\.\.\./, '') + error.source.after).trim();
}

/** The text of the first context line, without its `<argument> `/`l.12 ` label. */
function firstContextBefore(error: LogError): string {
  const first = error.context[0] ?? '';
  return first.replace(/^l\.\d+ /, '').replace(/^<[^>]*> ?/, '');
}

/** The last control sequence at the end of `text`, e.g. `textbff` for `Our \textbff`. */
function trailingControlSequence(text: string): string | undefined {
  return /\\([A-Za-z@]+|[^A-Za-z@\s])\s*$/.exec(text)?.[1];
}

/** The whitespace-delimited word around the point where TeX stopped. */
function wordAtStop(error: LogError): string {
  if (!error.source) return '';
  const before = /(\S*)$/.exec(error.source.before)?.[1] ?? '';
  const after = /^\s*(\S*)/.exec(error.source.after)?.[1] ?? '';
  return (before + after).replace(/[.,;:!?)]+$/, '');
}

/** The tail of the source text before the stop, for "near …" quotes. */
function textNearStop(error: LogError, length = 40): string {
  const before = (error.source?.before ?? '').replace(/^\.\.\./, '').trim();
  return before.length > length ? `…${before.slice(-length)}` : before;
}

function escapeSpecials(text: string): string {
  return text.replace(/\\?([_&#%$])/g, '\\$1').replace(/\^/g, '\\^{}');
}

/** "Add `\usepackage{x}` …" for a package description such as `algorithm (or algorithm2e)`. */
function loadAdvice(pkg: string): string {
  const m = /^([a-z][\w-]*)(.*)$/.exec(pkg);
  if (!m) return `Load ${pkg}.`;
  return `Add ${code(`\\usepackage{${m[1]}}`)}${m[2]} to the preamble.`;
}

function hasPackage(ctx: ExplainContext, name: string): boolean {
  return ctx.packages.has(name);
}

// ---------------------------------------------------------------------------
// Undefined control sequence

function windowsPathIn(text: string): string | undefined {
  const braced = /\{([^{}]*\\[^{}]*)\}/.exec(text)?.[1];
  if (braced && /(?:^[A-Za-z]:\\|\\[\w.-]+\\|\\[\w-]+\.[A-Za-z]{2,4}$)/.test(braced)) return braced;
  return undefined;
}

function undefinedInGraphicsPath(path: string): Explanation {
  const name = path.split('\\').pop() ?? path;
  return {
    rule: 'undefined-control-sequence',
    check: 'build',
    message: `Backslashes in the file path ${code(path)} are read as commands`,
    detail:
      'TeX treats every `\\` as the start of a command, so a Windows-style path breaks into ' +
      'undefined commands. TeX paths always use forward slashes.',
    fix: `Use a forward-slash path relative to the main file, e.g. ${code(`\\includegraphics{figures/${name}}`)}, and copy the file into the project.`,
    data: { path },
  };
}

function natbibAdvice(cs: string, ctx: ExplainContext): Explanation | undefined {
  const replacement = NATBIB_TO_BIBLATEX[cs];
  if (!replacement) return undefined;
  if (hasPackage(ctx, 'biblatex')) {
    return {
      rule: 'undefined-control-sequence',
      check: 'build',
      message: `${code(`\\${cs}`)} is a natbib command, but this document uses biblatex`,
      detail:
        'biblatex has its own citation commands and does not define the natbib ones by default.',
      fix: `Write ${code(`${replacement}{…}`)} instead, or load biblatex with ${code('\\usepackage[natbib=true]{biblatex}')} to keep the natbib names.`,
      data: { command: `\\${cs}`, replacement },
    };
  }
  if (hasPackage(ctx, 'natbib')) return undefined;
  return {
    rule: 'undefined-control-sequence',
    check: 'build',
    message: `${code(`\\${cs}`)} needs a citation package (natbib or biblatex)`,
    detail: `${code(`\\${cs}`)} is not part of plain LaTeX; it is defined by natbib (and, for some names, by biblatex).`,
    fix: `Add ${code('\\usepackage{natbib}')} to the preamble, or with biblatex write ${code(`${replacement}{…}`)}.`,
    data: { command: `\\${cs}`, package: 'natbib' },
  };
}

function siunitxAdvice(cs: string, ctx: ExplainContext): Explanation | undefined {
  const v3 = SIUNITX_V3[cs];
  if (v3 && !hasPackage(ctx, 'siunitx')) {
    return {
      rule: 'undefined-control-sequence',
      check: 'build',
      message: `${code(`\\${cs}`)} comes from the siunitx package, which is not loaded`,
      detail: `${code(`\\${cs}`)} is the siunitx version 2 name; siunitx version 3 calls it ${code(v3)}.`,
      fix: `Add ${code('\\usepackage{siunitx}')} to the preamble and prefer the current name ${code(v3)}.`,
      data: { command: `\\${cs}`, package: 'siunitx', replacement: v3 },
    };
  }
  if (['qty', 'unit', 'qtyrange', 'qtylist'].includes(cs) && hasPackage(ctx, 'siunitx')) {
    return {
      rule: 'undefined-control-sequence',
      check: 'build',
      message: `${code(`\\${cs}`)} needs siunitx version 3, but an older siunitx is installed`,
      detail:
        'siunitx version 3 (2021) introduced `\\qty` and `\\unit`; older versions only have `\\SI` and `\\si`.',
      fix: 'Update TeX Live (or use the Overfull Docker image), or write `\\SI{…}{…}` and `\\si{…}`.',
      data: { command: `\\${cs}`, package: 'siunitx' },
    };
  }
  return undefined;
}

function packageAdvice(cs: string, ctx: ExplainContext): Explanation | undefined {
  if (cs === 'mathbb' || cs === 'mathfrak') {
    if (hasPackage(ctx, 'amssymb') || hasPackage(ctx, 'unicode-math')) return undefined;
    return {
      rule: 'undefined-control-sequence',
      check: 'build',
      message: `${code(`\\${cs}`)} needs the amssymb package`,
      detail: `${code(`\\${cs}`)} (blackboard bold letters such as ℝ) is not part of plain LaTeX math.`,
      fix: `Add ${code('\\usepackage{amssymb}')} to the preamble. With LuaLaTeX or XeLaTeX, ${code('\\usepackage{unicode-math}')} also provides it.`,
      data: { command: `\\${cs}`, package: 'amssymb' },
    };
  }
  const pkg = COMMAND_PACKAGES[cs];
  if (!pkg) return undefined;
  const name = pkg.split(' ')[0] ?? pkg;
  if (/^[a-z][\w-]*$/.test(name) && hasPackage(ctx, name)) return undefined;
  const load = loadAdvice(pkg);
  return {
    rule: 'undefined-control-sequence',
    check: 'build',
    message: `${code(`\\${cs}`)} needs the ${pkg} package`,
    detail: `${code(`\\${cs}`)} is defined by ${pkg}, which this document does not load.`,
    fix: load,
    data: { command: `\\${cs}`, package: pkg },
  };
}

const explainUndefinedControlSequence: Explainer = (_m, error, ctx) => {
  const path = windowsPathIn(sourceText(error)) ?? windowsPathIn(error.context.join(' '));
  if (path) return undefinedInGraphicsPath(path);

  const cs = trailingControlSequence(firstContextBefore(error));
  const fromBib = extension(error.file ?? '') === 'bbl';
  if (!cs) {
    return {
      rule: 'undefined-control-sequence',
      check: 'build',
      message: 'A command on this line is not defined',
      detail: sourceText(error) ? `TeX stopped in ${code(sourceText(error))}.` : undefined,
      fix: 'Check the spelling of each command on the line, and load the package that defines it.',
    };
  }
  const specific = natbibAdvice(cs, ctx) ?? siunitxAdvice(cs, ctx) ?? packageAdvice(cs, ctx);
  if (specific) return specific;

  const command = `\\${cs}`;
  const internal = cs.includes('@');
  const suggestion = internal ? undefined : closest(cs, COMMON_COMMANDS);
  if (suggestion) {
    return {
      rule: 'undefined-control-sequence',
      check: 'build',
      message: `Unknown command ${code(command)} (did you mean ${code(`\\${suggestion}`)}?)`,
      detail: `${code(command)} is not defined by LaTeX or any loaded package; it looks like a typo of ${code(`\\${suggestion}`)}.`,
      fix: `Replace ${code(command)} with ${code(`\\${suggestion}`)}.`,
      data: { command, suggestion: `\\${suggestion}` },
    };
  }
  return {
    rule: 'undefined-control-sequence',
    check: 'build',
    message: `Unknown command ${code(command)}`,
    detail: fromBib
      ? `The command comes from a field in your .bib file (via the .bbl file), not from the .tex sources.`
      : internal
        ? `${code(command)} is an internal command of a package or class; this usually follows an earlier error or a package conflict.`
        : `${code(command)} is not defined by LaTeX or by any package this document loads.`,
    fix: fromBib
      ? `Find ${code(command)} in the .bib file and replace it, or define it in the preamble.`
      : internal
        ? 'Fix the first error in the log first; if this is the only error, check for two packages that conflict.'
        : `Check the spelling, load the package that defines ${code(command)}, or define it with ${code(`\\newcommand{${command}}{…}`)}.`,
    data: { command },
  };
};

// ---------------------------------------------------------------------------
// Math mode

function mathyScript(word: string): boolean {
  return /^\$?[A-Za-z]{1,2}[_^]\{?[A-Za-z0-9]{1,3}\}?\$?$/.test(word);
}

const explainMissingDollar: Explainer = (_m, error) => {
  const before = error.source?.before ?? '';
  const word = wordAtStop(error);
  const script = /([_^])\s*$/.exec(before)?.[1];
  if (script && word) {
    const math = mathyScript(word) || (script === '^' && !/[./]/.test(word));
    const name = script === '_' ? 'underscore `_`' : 'caret `^`';
    if (math) {
      return {
        rule: 'missing-dollar',
        check: 'build',
        message: `${code(word)} uses ${script === '_' ? 'a subscript' : 'a superscript'} outside math mode`,
        detail: `The ${name} only works inside a formula, so TeX inserted a ${code('$')} and continued in math mode.`,
        fix: `Write ${code(`$${word.replace(/\$/g, '')}$`)}.`,
        data: { text: word, char: script },
      };
    }
    const escaped = escapeSpecials(word);
    return {
      rule: 'missing-dollar',
      check: 'build',
      message: `The ${name} in ${code(word)} needs escaping`,
      detail: `In running text ${code(script)} starts a ${script === '_' ? 'subscript' : 'superscript'}, which only works in math mode, so TeX inserted a ${code('$')} and typeset the rest as a formula.`,
      fix: `Write ${code(escaped)}, or for file names and identifiers use ${code(`\\path{${word}}`)} (url package) or ${code(`\\texttt{${escaped}}`)}.`,
      data: { text: word, char: script, replacement: escaped },
    };
  }
  const cs = trailingControlSequence(before);
  if (cs && MATH_COMMANDS.has(cs)) {
    return {
      rule: 'missing-dollar',
      check: 'build',
      message: `${code(`\\${cs}`)} is a math command used outside math mode`,
      detail: `${code(`\\${cs}`)} only works inside a formula, so TeX inserted a ${code('$')}.`,
      fix: `Write ${code(`$\\${cs}$`)} (or put the whole expression in ${code('$…$')}).`,
      data: { command: `\\${cs}` },
    };
  }
  if (error.context.some((line) => /\\par\b/.test(line)) || before.trim() === '') {
    return {
      rule: 'missing-dollar',
      check: 'build',
      message: 'A formula is interrupted by a blank line or is not closed',
      detail:
        'Formulas cannot contain blank lines (paragraph breaks), and every `$` or `\\(` must be closed in the same paragraph.',
      fix: 'Remove blank lines inside the equation environment or `\\[ … \\]`, and check that every `$` has a matching `$`.',
    };
  }
  return {
    rule: 'missing-dollar',
    check: 'build',
    message: `Math-only text outside math mode near ${code(textNearStop(error))}`,
    detail:
      'TeX met a symbol that only works in formulas (such as `_`, `^` or a math command), or a formula that is not closed.',
    fix: 'Put the formula inside `$…$`, escape `_` as `\\_` in text, and check that every `$` is closed.',
  };
};

const explainDoubleScript: Explainer = (m, error) => {
  const which = m[1] === 'subscript' ? 'subscript' : 'superscript';
  const word = wordAtStop(error).replace(/\$/g, '');
  const sym = which === 'subscript' ? '_' : '^';
  const parts = word.split(sym);
  const grouped = parts.length >= 3 ? `${parts[0]}${sym}{${parts.slice(1).join('')}}` : undefined;
  return {
    rule: 'double-script',
    check: 'build',
    message: word ? `${code(word)} has two ${which}s` : `A symbol has two ${which}s`,
    detail: `TeX allows one ${which} per symbol; ${code(`${sym}a${sym}b`)} is ambiguous.`,
    fix: grouped
      ? `Group them: ${code(grouped)}${which === 'subscript' ? ` or ${code(`${parts[0]}_{${parts.slice(1).join(',')}}`)}` : ''}.`
      : `Group the ${which}s in braces, e.g. ${code(`x${sym}{ab}`)} or ${code(`{x${sym}a}${sym}b`)}.`,
    data: word ? { text: word } : undefined,
  };
};

const explainAlignmentTab: Explainer = (_m, error) => {
  const before = (error.source?.before ?? '').replace(/&\s*$/, '');
  const prev = /(\S+)\s*$/.exec(before)?.[1] ?? '';
  const next = /^\s*(\S+)/.exec(error.source?.after ?? '')?.[1] ?? '';
  const phrase = prev && next ? `${prev} & ${next}` : '';
  const fromBib = extension(error.file ?? '') === 'bbl';
  return {
    rule: 'misplaced-alignment-tab',
    check: 'build',
    message: phrase
      ? `Unescaped ${code('&')} in ${code(phrase)}`
      : `Unescaped ${code('&')} outside a table`,
    detail: fromBib
      ? '`&` separates table columns; this one comes from a .bib field (often a journal or publisher name).'
      : '`&` separates table columns and cannot appear in running text.',
    fix: phrase
      ? `Write ${code(`${prev} \\& ${next}`)}${fromBib ? ' in the .bib file' : ''}.`
      : 'Write `\\&` for a literal ampersand.',
    data: phrase ? { text: phrase } : undefined,
  };
};

const explainMissingBrace: Explainer = (m, error) => {
  const near = textNearStop(error);
  const inMath = /\$|\\\]|\\\)/.test(near) || /\$/.test(error.source?.after ?? '');
  return {
    rule: 'missing-brace',
    check: 'build',
    message: `A ${code(m[1] === '{' ? '{' : '}')} is missing near ${code(near || sourceText(error))}`,
    detail: inMath
      ? 'A `{` group opened inside a formula is still open when the formula ends; braces and `$` must nest properly.'
      : 'Braces are unbalanced: a group was closed in the wrong order or not at all.',
    fix: inMath
      ? 'Close every `{` before the closing `$`, e.g. write `$x^{2}$` instead of `$x^{2$`.'
      : 'Check that every `{` on this line has a matching `}`.',
  };
};

const explainExtraBrace: Explainer = (m, error) => {
  const near = textNearStop(error);
  const forgottenDollar = /forgotten \$/.test(m[0]);
  return {
    rule: 'extra-brace',
    check: 'build',
    message: near
      ? `A ${code('}')} has no matching ${code('{')} near ${code(near)}`
      : `A ${code('}')} has no matching ${code('{')}`,
    detail: forgottenDollar
      ? 'TeX found a `}` that closes nothing, often a typo or a `$` that ends a formula too early.'
      : 'There are more closing braces than opening ones, so TeX ignored the extra `}`.',
    fix: 'Delete the extra `}` or add the missing `{`; check that each formula opens and closes with `$`.',
  };
};

const explainRunaway: Explainer = (m, error) => {
  const command = m[2] ?? '';
  const arg = (error.runaway ?? '')
    .replace(/\s*\\par\b.*$/, '')
    .replace(/\\ETC\.$/, '')
    .trim();
  const fileEnded = m[1]?.startsWith('File ended');
  const definition = /definition/.test(m[1] ?? '');
  return {
    rule: 'runaway-argument',
    check: 'build',
    message: definition
      ? `The definition of ${code(command)} is never closed`
      : `The argument of ${code(command)} is never closed${arg ? `: ${code(`${command}${arg}`)}` : ''}`,
    detail: fileEnded
      ? `TeX read to the end of the file looking for the ${code('}')} that closes ${code(command)}.`
      : `TeX reached a blank line (paragraph end) while still reading the argument of ${code(command)}, so a ${code('}')} is missing before it.`,
    fix: arg
      ? `Add the missing ${code('}')}; search for ${code(`${command}${arg.slice(0, 30)}`)} in the source.`
      : `Add the missing ${code('}')} after the argument of ${code(command)}.`,
    data: { command, ...(arg ? { argument: arg } : {}) },
  };
};

// ---------------------------------------------------------------------------
// Files and packages

const IMAGE_EXTENSIONS = /\.(?:pdf|png|jpe?g|eps|ps|svg|gif|tiff?|bmp|webp|jbig2|jb2|mps)$/i;

const explainFileNotFound: Explainer = (m, error) => {
  const file = m[1] ?? '';
  const ext = extension(file);
  if (ext === 'sty' || ext === 'cls') {
    const name = file.replace(/\.(?:sty|cls)$/, '');
    const kind = ext === 'sty' ? 'package' : 'document class';
    return {
      rule: 'missing-package',
      check: 'build',
      message: `The ${kind} ${code(name)} is not installed`,
      detail: `TeX could not find ${code(file)}. Either the name is misspelled or the ${kind} is not part of this TeX installation.`,
      fix: `Check the spelling of ${code(name)}. If it is correct, install it with ${code(`tlmgr install ${name}`)} (TeX Live) or the MiKTeX console, or build with the Overfull Docker image, which has the full TeX Live. A custom ${kind} must sit next to the main .tex file.`,
      data: { file, package: name },
    };
  }
  const graphics =
    /\\includegraphics|draft setting/.test(`${error.message} ${error.context.join(' ')}`) ||
    error.help.some((line) => /extensions:/.test(line)) ||
    IMAGE_EXTENSIONS.test(file);
  if (graphics) {
    const tried = error.help.find((line) => /^\.\w+,/.test(line));
    return {
      rule: 'missing-figure',
      check: 'output',
      message: `Figure file ${code(file)} not found`,
      detail: `${code('\\includegraphics')} could not find ${code(file)}${tried ? ` with any of the extensions ${tried.split(',').slice(0, 4).join(', ')}…` : ''}. The PDF has an empty box instead of the figure.`,
      fix: 'Check the path and the file name, including upper/lower case (CI runs on Linux, where case matters). Paths are relative to the main .tex file or to `\\graphicspath`.',
      data: { file },
    };
  }
  return {
    rule: 'missing-file',
    check: 'build',
    message: `File ${code(file)} not found`,
    detail: `TeX could not open ${code(file)}, so the build stopped there.`,
    fix: 'Check the path and spelling in `\\input`/`\\include`. Paths are relative to the main .tex file, and case matters on Linux.',
    data: { file },
  };
};

const explainOptionClash: Explainer = (m, error) => {
  const pkg = m[1] ?? '';
  const help = error.help.join('\n');
  const first = /already been loaded with options:\s*\n?\s*\[([^\]]*)\]/.exec(help)?.[1];
  const second = /load it with options\s*\n?\s*\[([^\]]*)\]/.exec(help)?.[1];
  const options = [first, second]
    .flatMap((o) => (o ?? '').split(','))
    .map((o) => o.trim())
    .filter(Boolean);
  const merged = [...new Set(options)].join(',');
  const shown =
    first !== undefined && second !== undefined
      ? ` (${code(`[${first}]`)} and ${code(`[${second}]`)})`
      : '';
  const arxiv =
    pkg === 'hyperref'
      ? ' Note that arXiv and many classes load hyperref themselves; use `\\hypersetup{…}` for options instead of loading it again.'
      : '';
  return {
    rule: 'option-clash',
    check: 'build',
    message: `${code(pkg)} is loaded twice with different options${shown}`,
    detail: `A package can be loaded only once. It was loaded again (by you, the class, or another package) with options it was not first loaded with.${arxiv}`,
    fix: merged
      ? `Load it once with all options: ${code(`\\usepackage[${merged}]{${pkg}}`)}. If the class or another package loads it first, put ${code(`\\PassOptionsToPackage{${merged}}{${pkg}}`)} before ${code('\\documentclass')}.`
      : `Remove the second ${code(`\\usepackage{${pkg}}`)} and merge its options into the first; use ${code('\\PassOptionsToPackage')} before ${code('\\documentclass')} if a class loads it.`,
    data: {
      package: pkg,
      ...(first !== undefined ? { firstOptions: first } : {}),
      ...(second !== undefined ? { secondOptions: second } : {}),
    },
  };
};

const explainGraphicsExtension: Explainer = (m, error) => {
  const ext = (m[1] ?? '').toLowerCase();
  const path = /\{([^{}]+\.\w+)\}/.exec(sourceText(error))?.[1];
  const target = path ? path.replace(/\.\w+$/, '.pdf') : `figure.pdf`;
  let fix: string;
  if (ext === '.svg') {
    fix = `Convert it to PDF (e.g. ${code(`inkscape ${path ?? 'figure.svg'} --export-filename=${target}`)}) and include ${code(target)}, or use the svg package's ${code('\\includesvg')}.`;
  } else if (ext === '.eps' || ext === '.ps') {
    fix = `Convert it to PDF with ${code(`epstopdf ${path ?? 'figure.eps'}`)} and include the .pdf, or load ${code('\\usepackage{epstopdf}')}.`;
  } else {
    fix = `Convert it to PNG (photos: JPEG, drawings: PDF) and include that file instead.`;
  }
  return {
    rule: 'unknown-graphics-extension',
    check: 'build',
    message: `${code('\\includegraphics')} cannot use ${code(ext)} files${path ? `: ${code(path)}` : ''}`,
    detail:
      'pdfLaTeX, LuaLaTeX and XeLaTeX include PDF, PNG and JPEG images (and EPS via conversion). Other formats must be converted first.',
    fix,
    data: { extension: ext, ...(path ? { file: path } : {}) },
  };
};

// ---------------------------------------------------------------------------
// Environments and document structure

const explainEnvironmentUndefined: Explainer = (m) => {
  const env = m[1] ?? '';
  const base = {
    rule: 'environment-undefined',
    check: 'build' as const,
    data: { environment: env },
  };
  if (THEOREM_LIKE.has(env)) {
    const title = env.charAt(0).toUpperCase() + env.slice(1);
    return {
      ...base,
      message: `The ${code(env)} environment is not defined`,
      detail: 'Theorem-like environments do not exist until you declare them.',
      fix: `Declare it in the preamble: ${code('\\usepackage{amsthm}')} and ${code(`\\newtheorem{${env}}{${title}}`)}.`,
    };
  }
  const pkg = ENVIRONMENT_PACKAGES[env];
  if (pkg) {
    return {
      ...base,
      message: `The ${code(env)} environment needs the ${pkg} package`,
      detail: `${code(env)} is defined by ${pkg}, which this document does not load.`,
      fix: loadAdvice(pkg),
      data: { environment: env, package: pkg },
    };
  }
  const suggestion = closest(env, COMMON_ENVIRONMENTS);
  return {
    ...base,
    message: suggestion
      ? `Unknown environment ${code(env)} (did you mean ${code(suggestion)}?)`
      : `Unknown environment ${code(env)}`,
    detail: `No loaded package defines ${code(`\\begin{${env}}`)}.`,
    fix: suggestion
      ? `Change ${code(`\\begin{${env}}`)} and its ${code('\\end')} to ${code(suggestion)}.`
      : `Check the spelling, load the package that defines ${code(env)}, or define it with ${code('\\newenvironment')}.`,
  };
};

const explainEnvironmentMismatch: Explainer = (m) => {
  const opened = m[1] ?? '';
  const openedLine = m[2] ?? '';
  const closed = m[3] ?? '';
  if (opened === 'document') {
    return {
      rule: 'environment-mismatch',
      check: 'build',
      message: `${code(`\\end{${closed}}`)} has no matching ${code(`\\begin{${closed}}`)}`,
      detail: `LaTeX found ${code(`\\end{${closed}}`)} while no ${code(closed)} environment was open.`,
      fix: `Remove ${code(`\\end{${closed}}`)} or add the missing ${code(`\\begin{${closed}}`)}.`,
      data: { opened, closed },
    };
  }
  return {
    rule: 'environment-mismatch',
    check: 'build',
    message: `${code(`\\begin{${opened}}`)} (line ${openedLine}) is closed by ${code(`\\end{${closed}}`)}`,
    detail: 'Environments must be closed in the reverse order they were opened.',
    fix: `Change ${code(`\\end{${closed}}`)} to ${code(`\\end{${opened}}`)}, or add the missing ${code(`\\end{…}`)} of an inner environment.`,
    data: { opened, closed, openedLine: Number(openedLine) },
  };
};

const simple =
  (rule: string, message: string, detail: string, fix: string): Explainer =>
  () => ({ rule, check: 'build', message, detail, fix });

const explainMissingBeginDocument: Explainer = (_m, error) => {
  const text = sourceText(error);
  return {
    rule: 'missing-begin-document',
    check: 'build',
    message: text
      ? `Text in the preamble before ${code('\\begin{document}')}: ${code(text.slice(0, 60))}`
      : `Text appears before ${code('\\begin{document}')}`,
    detail:
      'Only definitions and package settings may appear in the preamble. Typeset text (or a stray character, often from a broken package or a byte-order mark) starts the document too early.',
    fix: 'Move the text after `\\begin{document}` or comment it out with `%`.',
    ...(text ? { data: { text } } : {}),
  };
};

const explainPreambleOnly: Explainer = (_m, error) => {
  const cs = trailingControlSequence(error.source?.before ?? '');
  const statement = cs
    ? `\\${cs}${/^\s*(\[[^\]]*\])?\{[^}]*\}/.exec(error.source?.after ?? '')?.[0].trim() ?? ''}`
    : '';
  return {
    rule: 'preamble-only',
    check: 'build',
    message: statement
      ? `${code(statement)} must come before ${code('\\begin{document}')}`
      : `A preamble-only command is used after ${code('\\begin{document}')}`,
    detail:
      'Commands such as `\\usepackage` and `\\documentclass` options only work in the preamble.',
    fix: statement
      ? `Move ${code(statement)} above ${code('\\begin{document}')}.`
      : 'Move the command above `\\begin{document}`.',
    ...(statement ? { data: { command: statement } } : {}),
  };
};

const explainUnicode: Explainer = (m) => {
  const char = m[1] ?? '';
  const codePoint = m[2] ?? '';
  const replacement = UNICODE_REPLACEMENTS[char];
  return {
    rule: 'unicode-character',
    check: 'build',
    message: `pdfLaTeX cannot typeset the character ${code(char)} (U+${codePoint})`,
    detail:
      'pdfLaTeX only knows the Unicode characters its font encodings define. LuaLaTeX and XeLaTeX handle any character the font has.',
    fix: replacement
      ? `Write ${code(replacement)} instead, or compile with LuaLaTeX (\`latexmk -lualatex\`).`
      : `Compile with LuaLaTeX (\`latexmk -lualatex\`), or replace the character with a LaTeX command, or declare it with ${code(`\\DeclareUnicodeCharacter{${codePoint}}{…}`)}.`,
    data: { char, code: `U+${codePoint}`, ...(replacement ? { replacement } : {}) },
  };
};

const explainFontNotFound: Explainer = (m) => {
  const font = (m[1] ?? m[2] ?? '').trim();
  return {
    rule: 'font-not-found',
    check: 'build',
    message: `The font ${code(font)} is not installed`,
    detail:
      'fontspec looks fonts up by name among the fonts installed on this machine (or in the TeX tree). CI machines and Docker images rarely have commercial fonts.',
    fix: `Use a font that ships with TeX Live (e.g. ${code('TeX Gyre Termes')}, ${code('TeX Gyre Heros')}, ${code('Latin Modern Roman')}), or add the font files to the project and load them by file name: ${code('\\setmainfont{MyFont-Regular.otf}[Path=fonts/]')}. List installed names with ${code('luaotfload-tool --list=*')} or ${code('fc-list')}.`,
    data: { font },
  };
};

const explainTfmFont: Explainer = (m) => ({
  rule: 'font-not-found',
  check: 'build',
  message: `The font ${code(m[1] ?? '')} cannot be loaded`,
  detail:
    'TeX found no metric file for this font: the font package is missing from the installation, or a font name is wrong.',
  fix: 'Install the font package that provides it (`tlmgr install …`), or switch to LuaLaTeX with fontspec and an installed font.',
  data: { font: m[1] },
});

const explainBiblatex: Explainer = (m) => {
  const what = m[1] ?? '';
  const base = { rule: 'biblatex-error', check: 'build' as const, data: { message: what } };
  if (/'\\bibliographystyle' invalid/.test(what)) {
    return {
      ...base,
      message: `${code('\\bibliographystyle')} cannot be used with biblatex`,
      detail:
        '`\\bibliographystyle` belongs to BibTeX. biblatex chooses its style with a package option.',
      fix: 'Delete `\\bibliographystyle{…}` and set the style when loading biblatex, e.g. `\\usepackage[style=numeric]{biblatex}`.',
    };
  }
  const incompatible = /Incompatible package '([^']+)'/.exec(what);
  if (incompatible) {
    const pkg = incompatible[1] ?? '';
    return {
      ...base,
      message: `${code(pkg)} cannot be used together with biblatex`,
      detail: `${code(pkg)} is a BibTeX-era citation package; biblatex replaces it.`,
      fix:
        pkg === 'natbib'
          ? 'Remove `\\usepackage{natbib}`. To keep `\\citep`/`\\citet`, load `\\usepackage[natbib=true]{biblatex}`.'
          : `Remove ${code(`\\usepackage{${pkg}}`)}.`,
    };
  }
  if (/backend|created by biblatex|wrong format version|bbl/.test(what)) {
    return {
      ...base,
      message: 'The bibliography file does not match the biblatex backend or version',
      detail: `biblatex reported: ${what}. The .bbl was written by a different backend (BibTeX vs. Biber) or biblatex version.`,
      fix: 'Delete the .bbl file (or run `latexmk -C`), then build again so Biber regenerates it. Use `backend=biber` (the default) unless you know you need BibTeX.',
    };
  }
  return {
    ...base,
    message: `biblatex: ${what}`,
    detail: 'biblatex stopped with an error; the bibliography may be missing or incomplete.',
    fix: 'Read the message, check the biblatex options and the .bib file, then rebuild.',
  };
};

const explainParameterNumber: Explainer = (m) => {
  const macro = m[1];
  if (macro) {
    return {
      rule: 'illegal-parameter-number',
      check: 'build',
      message: `The definition of ${code(macro)} uses a ${code('#')} argument it does not have`,
      detail: `Inside ${code(macro)}, a ${code('#n')} refers to an argument number larger than the declared number of arguments (or a literal ${code('#')} appears in the definition).`,
      fix: `Declare enough arguments, e.g. ${code(`\\newcommand{${macro}}[2]{…#1…#2…}`)}, or write a literal hash sign as ${code('\\#')}.`,
      data: { command: macro },
    };
  }
  return {
    rule: 'illegal-parameter-number',
    check: 'build',
    message: `A literal ${code('#')} appears in the text`,
    detail: '`#` marks macro arguments in TeX and cannot be typeset directly.',
    fix: 'Write `\\#` (for example `issue \\#42`).',
  };
};

const explainColor: Explainer = (m) => {
  const color = m[1] ?? '';
  return {
    rule: 'undefined-color',
    check: 'build',
    message: `Color ${code(color)} is not defined`,
    detail: `xcolor knows only a few base color names unless more are loaded or defined.`,
    fix: `Define it, e.g. ${code(`\\definecolor{${color}}{RGB}{139,0,0}`)}, or load ${code('\\usepackage[dvipsnames,svgnames]{xcolor}')} for named colors (such as ${code('DarkRed')} or ${code('BrickRed')}), or use a base name like ${code('red')}.`,
    data: { color },
  };
};

const explainCapacity: Explainer = (m, error) => {
  const what = m[1] ?? '';
  const cs = trailingControlSequence(error.source?.before ?? '');
  const recursion =
    /grouping levels|input stack size|save size|parameter stack|expansion depth|semantic nest/.test(
      what,
    );
  return {
    rule: 'tex-capacity-exceeded',
    check: 'build',
    message: recursion
      ? `TeX ran out of ${what.replace(/=.*$/, '')}: probably a command that calls itself${cs ? ` (${code(`\\${cs}`)})` : ''}`
      : `TeX ran out of memory (${what})`,
    detail: recursion
      ? `This almost always means infinite recursion: a macro whose definition uses itself${cs ? `, such as ${code(`\\newcommand{\\${cs}}{…\\${cs}…}`)}` : ''}, or a redefinition of a command in terms of itself.`
      : 'Very large TikZ/pgfplots figures or huge tables can exhaust pdfLaTeX memory.',
    fix: recursion
      ? `Check the definition of ${cs ? code(`\\${cs}`) : 'the command on this line'}; to extend an existing command, save it first with ${code('\\let\\oldcmd\\cmd')} or use ${code('\\NewCommandCopy')}.`
      : 'Compile with LuaLaTeX (dynamic memory), externalize large TikZ figures, or reduce plotted data points.',
    data: { capacity: what, ...(cs ? { command: `\\${cs}` } : {}) },
  };
};

const explainTikz: Explainer = (m) => {
  const what = m[2] ?? '';
  const key = /I do not know the key '([^']+)'(?:, to which you passed '([^']*)')?/.exec(what);
  if (key) {
    const full = key[1] ?? '';
    const name = full.split('/').pop() ?? full;
    const family = full.split('/')[1] ?? 'tikz';
    const suggestion = family === 'tikz' ? closest(name, TIKZ_KEYS) : undefined;
    const value = key[2] ? `=${key[2]}` : '';
    return {
      rule: 'tikz-error',
      check: 'build',
      message: `${family === 'tikz' ? 'TikZ' : family} does not know the option ${code(name)}${suggestion ? ` (did you mean ${code(suggestion)}?)` : ''}`,
      detail: `The key ${code(full)} is not defined; it is misspelled, belongs to a library that is not loaded, or needs a newer ${family} version.`,
      fix: suggestion
        ? `Write ${code(`${suggestion}${value}`)} instead of ${code(`${name}${value}`)}.`
        : `Check the spelling, or load the TikZ library that defines it with ${code('\\usetikzlibrary{…}')}.`,
      data: { key: full, ...(suggestion ? { suggestion } : {}) },
    };
  }
  if (/Giving up on this path\. Did you forget a semicolon/.test(what)) {
    return {
      rule: 'tikz-error',
      check: 'build',
      message: 'A TikZ path does not end with a semicolon',
      detail: 'Every `\\draw`, `\\node`, `\\path` and `\\fill` command must end with `;`.',
      fix: 'Add the missing `;` at the end of the previous TikZ command.',
    };
  }
  const shape = /No shape named [`']?([^`'\s]+)'? is known/.exec(what);
  if (shape) {
    return {
      rule: 'tikz-error',
      check: 'build',
      message: `TikZ node ${code(shape[1] ?? '')} does not exist`,
      detail:
        'A path refers to a node name that was never defined (or is defined later, or in another picture).',
      fix: `Check the spelling of ${code(`(${shape[1]})`)} and define the node before it is used; across pictures use ${code('remember picture')}.`,
      data: { node: shape[1] },
    };
  }
  return {
    rule: 'tikz-error',
    check: 'build',
    message: `${m[1] ?? 'TikZ'}: ${what}`,
    detail: 'TikZ/PGF stopped with an error; the figure may be incomplete.',
    fix: 'Check the TikZ code on this line against the PGF/TikZ manual.',
  };
};

const explainHyperref: Explainer = (m) => ({
  rule: 'hyperref-error',
  check: 'build',
  message: `hyperref: ${m[1] ?? ''}`,
  detail:
    'hyperref reported an error; links or PDF metadata may be wrong. hyperref should normally be loaded last.',
  fix: 'Load hyperref after other packages (except cleveref), pass options with `\\hypersetup{…}`, and use `\\texorpdfstring{…}{…}` for math or commands in headings.',
});

const explainCommandDefined: Explainer = (m) => {
  const cs = m[1] ?? '';
  return {
    rule: 'command-already-defined',
    check: 'build',
    message: `${code(cs)} is already defined`,
    detail: `${code('\\newcommand')} refuses to overwrite an existing command; ${code(cs)} is already defined by LaTeX, a package, or earlier in your preamble.`,
    fix: `Pick a different name, or use ${code(`\\renewcommand{${cs}}`)} if you really mean to replace it. If two packages clash over ${code(cs)}, load only one of them.`,
    data: { command: cs },
  };
};

const explainUnknownOption: Explainer = (m) => {
  const option = m[1] ?? '';
  const pkg = m[2] ?? '';
  return {
    rule: 'unknown-package-option',
    check: 'build',
    message: `${code(pkg)} has no option ${code(option)}`,
    detail: `The option ${code(option)} is misspelled or is not supported by the installed version of ${code(pkg)}.`,
    fix: `Check the spelling against the ${pkg} documentation (\`texdoc ${pkg}\`) and remove or correct ${code(option)}.`,
    data: { package: pkg, option },
  };
};

// ---------------------------------------------------------------------------

const EXPLAINERS: [RegExp, Explainer][] = [
  [/^Undefined control sequence/, explainUndefinedControlSequence],
  [/^Missing \$ inserted/, explainMissingDollar],
  [/^Display math should end with \$\$/, explainMissingDollar],
  [/^Double (subscript|superscript)/, explainDoubleScript],
  [/^Misplaced alignment tab character &/, explainAlignmentTab],
  [/^Missing ([{}]) inserted/, explainMissingBrace],
  [
    /^(?:Extra \}, or forgotten (?:\$|\\endgroup|\\right)|Too many \}'s|Argument of \S+ has an extra \})/,
    explainExtraBrace,
  ],
  [
    /^(Paragraph ended before|File ended while scanning use of|File ended while scanning definition of|Forbidden control sequence found while scanning use of) (\\?[^\s.]+)(?:\s+was complete)?(?:\s*\.)?\s*$/,
    explainRunaway,
  ],
  [/^(?:LaTeX|Package \S+) Error: File [`'](.+?)' not found/, explainFileNotFound],
  [/^I can't find file [`'](.+?)'/, explainFileNotFound],
  [/^LaTeX Error: Option clash for package (\S+?)\.?$/, explainOptionClash],
  [/^LaTeX Error: Unknown graphics extension: (\.\S+?)\.?$/, explainGraphicsExtension],
  [/^LaTeX Error: Environment (\S+) undefined/, explainEnvironmentUndefined],
  [
    /^LaTeX Error: \\begin\{([^}]*)\} on input line (\d+) ended by \\end\{([^}]*)\}/,
    explainEnvironmentMismatch,
  ],
  [/^LaTeX Error: \\begin\{(document)\}() ended by \\end\{([^}]*)\}/, explainEnvironmentMismatch],
  [
    /^LaTeX Error: Lonely \\item/,
    simple(
      'lonely-item',
      '`\\item` is used outside a list',
      '`\\item` only works inside `itemize`, `enumerate` or `description`.',
      'Wrap the items in `\\begin{itemize}` … `\\end{itemize}` (or `enumerate`).',
    ),
  ],
  [
    /^LaTeX Error: Something's wrong--perhaps a missing \\item/,
    simple(
      'missing-item',
      'LaTeX expected `\\item` here',
      'Common causes: text inside a list before the first `\\item`, `\\\\` at the start of a paragraph, or an empty `thebibliography`.',
      'Start each list entry with `\\item`, move text before `\\begin{itemize}`, and remove `\\\\` after blank lines.',
    ),
  ],
  [
    /^LaTeX Error: There's no line here to end/,
    simple(
      'no-line-to-end',
      '`\\\\` is used where there is no line to end',
      '`\\\\` ends a line inside a paragraph; after a blank line, at the start of a paragraph or after a list there is no line yet.',
      'Remove the `\\\\`. Use a blank line for a new paragraph and `\\vspace{…}` for vertical space.',
    ),
  ],
  [/^LaTeX Error: Missing \\begin\{document\}/, explainMissingBeginDocument],
  [/^LaTeX Error: Can be used only in preamble/, explainPreambleOnly],
  [
    /^(?:LaTeX|Package inputenc) Error: Unicode character (\S+) \(U\+([0-9A-Fa-f]+)\)/,
    explainUnicode,
  ],
  [
    /^Package inputenc Error: Invalid UTF-8 byte/,
    simple(
      'unicode-character',
      'A source file is not saved as UTF-8',
      'LaTeX expects UTF-8 input, but the file contains bytes from another encoding (often Latin-1 or Windows-1252).',
      'Re-save the file as UTF-8 in your editor (or convert it with `iconv -f latin1 -t utf-8`).',
    ),
  ],
  [
    /^Package fontspec Error: The font "([^"]+)" cannot be found|^Package fontspec Error: [^"]*?font "([^"]+)"[^\n]*?not found/,
    explainFontNotFound,
  ],
  [/^Font (\S+?)(?:=\S+)? (?:at [\d.]+pt )?not loadable/, explainTfmFont],
  [/^Package biblatex Error: (.*)$/, explainBiblatex],
  [/^Illegal parameter number in definition of (\\\S+?)\.?$/, explainParameterNumber],
  [/^You can't use [`']macro parameter character #' in \w+ mode()/, explainParameterNumber],
  [/^Package xcolor Error: Undefined color [`']([^']+)'/, explainColor],
  [
    /^LaTeX Error: Not in outer par mode/,
    simple(
      'not-in-outer-par-mode',
      'A float or margin note is inside a box',
      '`figure`, `table` and `\\marginpar` cannot be placed inside a `minipage`, `\\parbox`, table cell, another float, or similar box.',
      'Move the float outside the box. Inside a minipage, drop the `figure` environment and use `\\captionof{figure}{…}` (caption package).',
    ),
  ],
  [
    /^Dimension too large/,
    simple(
      'dimension-too-large',
      'A length is larger than TeX allows (about 5.75 m / 16383pt)',
      'Common causes: a typo in a length (`20000pt`), a pgfplots axis with huge coordinates, or scaling by a very large factor.',
      'Check the length on this line; for plots, rescale the data or set `restrict y to domain`/`scaled ticks`.',
    ),
  ],
  [/^TeX capacity exceeded, sorry \[(.+?)\]/, explainCapacity],
  [/^Package (pgfkeys|tikz|pgf|pgfplots) Error: (.*)$/, explainTikz],
  [/^Package hyperref Error: (.*)$/, explainHyperref],
  [/^LaTeX Error: Command (\\\S+?) already defined/, explainCommandDefined],
  [
    /^LaTeX Error: Unknown option [`']([^']+)' for (?:package|class) [`']([^']+)'/,
    explainUnknownOption,
  ],
  [
    /^LaTeX Error: Float\(s\) lost/,
    simple(
      'not-in-outer-par-mode',
      'Floats were lost',
      'A `figure` or `table` (or `\\marginpar`) was placed inside a box or another float, so LaTeX dropped it.',
      'Move floats out of minipages, `\\parbox`es and other floats; use `\\captionof` for captions inside a minipage.',
    ),
  ],
];

/** Explains a TeX error; unknown errors get the generic `tex-error` rule with TeX's message. */
export function explainError(error: LogError, ctx: ExplainContext): Explanation {
  for (const [pattern, explain] of EXPLAINERS) {
    const m = pattern.exec(error.message);
    if (m) return explain(m, error, ctx);
  }
  const near = sourceText(error);
  return {
    rule: 'tex-error',
    check: 'build',
    message: error.message.replace(/\.$/, ''),
    detail: near ? `TeX stopped while reading ${code(near)}.` : undefined,
    fix: 'Read the message and the source line it points to; fix the first error in the log first, later ones often follow from it.',
  };
}
