/** Types produced by the build-log parser (`parseLog`). */

/** A TeX error (`! …` or `file:line: …`) with the context TeX printed. */
export interface LogError {
  /** The error message without the `! ` / `file:line: ` prefix, continuation lines joined. */
  message: string;
  /** Project-relative file the error belongs to (innermost open file, or the `file:line:` prefix). */
  file?: string;
  /** Source line from `l.<n>` or the `file:line:` prefix. */
  line?: number;
  /** Context lines TeX printed (pairs of "before" and "after" lines, `l.<n>` last). */
  context: string[];
  /** The `l.<n>` context split into the text before and after the point TeX stopped. */
  source?: { before: string; after: string };
  /** TeX's help text (shown in nonstop mode), useful for option clashes and missing files. */
  help: string[];
  /** Text of a preceding `Runaway argument?` report, when present. */
  runaway?: string;
  /** The complete raw lines of this error. */
  raw: string;
  /** 1-based line in the log file where the error starts. */
  logLine: number;
}

export type LogWarningKind =
  | 'undefined-citation'
  | 'undefined-reference'
  | 'undefined-references-summary'
  | 'duplicate-label'
  | 'labels-changed'
  | 'rerun-latex'
  | 'rerun-biber'
  | 'rerun-bibtex'
  | 'bib-entry-not-found'
  | 'empty-bibliography'
  | 'no-file'
  | 'overfull'
  | 'underfull'
  | 'font-substitution'
  | 'missing-glyph'
  | 'pdf-string-token'
  | 'font-feature'
  | 'float-too-large'
  | 'other';

/** A warning or diagnostic (`LaTeX Warning`, `Package … Warning`, boxes, missing characters…). */
export interface LogWarning {
  kind: LogWarningKind;
  /** Message with continuation lines joined. */
  message: string;
  /** Package or source that issued it (`LaTeX`, `biblatex`, `Font`, `TeX`). */
  source: string;
  file?: string;
  line?: number;
  page?: number;
  /** Extracted facts: `key`, `label`, `amountPt`, `lines`, `from`/`to`, `char`… */
  data: Record<string, unknown>;
  raw: string;
  /** 1-based line in the log file where the warning starts. */
  logLine: number;
}

export interface LogOutputFile {
  name: string;
  pages: number;
  bytes?: number;
}

export interface ParsedLog {
  /** e.g. `LuaHBTeX 1.24.0 (TeX Live 2026)`. */
  engine?: string;
  /** Format name from the banner, e.g. `lualatex`. */
  format?: string;
  errors: LogError[];
  warnings: LogWarning[];
  /** From `Output written on main.pdf (12 pages, 345 bytes).` */
  outputFile?: LogOutputFile;
  /** TeX reported `No pages of output.` */
  noPages: boolean;
  /** The run stopped early (`Emergency stop`, `==> Fatal error occurred`, capacity exceeded). */
  fatal: boolean;
  /** What another tool run would change. */
  rerunNeeded: { latex: boolean; biber: boolean; bibtex: boolean };
  /** Every file TeX opened, project-relative or package basename, in order. */
  files: string[];
}
