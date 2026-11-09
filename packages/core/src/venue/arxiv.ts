import type { Problem } from '../types.js';
import { findCommands, grepTex } from './tex.js';
import type { VenueContext } from './types.js';

const PATH_COMMANDS = [
  'includegraphics',
  'input',
  'include',
  'addbibresource',
  'bibliography',
  'subfile',
  'includepdf',
  'lstinputlisting',
  'inputminted',
];

/** Detects the TeX engine from the first line of a log ("This is pdfTeX, ..."). */
export function detectEngine(
  log: string | undefined,
): 'pdflatex' | 'lualatex' | 'xelatex' | undefined {
  if (!log) return undefined;
  const head = log.slice(0, 400);
  if (/This is LuaH?B?TeX|This is LuaTeX/i.test(head)) return 'lualatex';
  if (/This is XeTeX/i.test(head)) return 'xelatex';
  if (/This is pdfTeX|This is e-pTeX/i.test(head)) return 'pdflatex';
  return undefined;
}

function isAbsolute(p: string): boolean {
  return /^(\/|~[/\\]|[A-Za-z]:[\\/]|\\\\)/.test(p.trim());
}

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i + 1);
}

export function arxivProblems(ctx: VenueContext): Problem[] {
  const problems: Problem[] = [];
  const files = ctx.texFiles ?? [];
  const uses = findCommands(files, PATH_COMMANDS);
  for (const use of uses) {
    for (const p of use.arg.split(',')) {
      if (!isAbsolute(p)) continue;
      problems.push({
        rule: 'arxiv-absolute-path',
        check: 'venue',
        severity: 'error',
        message: `Absolute path in \\${use.name}: ${p.trim()}`,
        location: { file: use.file, line: use.line },
        fix: 'Use a path relative to the main file (arXiv only has your uploaded files)',
      });
    }
    if (/\s/.test(use.arg.trim()) && use.name !== 'bibliography') {
      problems.push({
        rule: 'arxiv-filename-space',
        check: 'venue',
        severity: 'warning',
        message: `File name with a space in \\${use.name}: ${use.arg.trim()}`,
        location: { file: use.file, line: use.line },
        fix: 'Rename the file without spaces (use - or _)',
      });
    }
  }
  const engine = detectEngine(ctx.log);
  if (engine === 'lualatex') {
    problems.push({
      rule: 'arxiv-unsupported-engine',
      check: 'venue',
      severity: 'error',
      message: 'This build used LuaLaTeX, but arXiv compiles with pdfLaTeX',
      fix: 'arXiv compiles with pdfLaTeX; build with `make arxiv` / `latexmk -pdf` and check that log with --log',
      data: { engine },
    });
  }
  if (engine === 'pdflatex') {
    for (const use of uses.filter(
      (u) => u.name === 'includegraphics' && /\.e?ps$/i.test(u.arg.trim()),
    )) {
      problems.push({
        rule: 'arxiv-eps-pdflatex',
        check: 'venue',
        severity: 'warning',
        message: `EPS figure with pdfLaTeX: ${use.arg.trim()}`,
        location: { file: use.file, line: use.line },
        fix: 'Convert to PDF (`epstopdf figure.eps`) and include the .pdf; arXiv’s pdfLaTeX will not convert it',
      });
    }
  }
  const shell =
    /\\usepackage(\[[^\]]*\])?\{[^}]*\b(minted|pythontex|svg|gnuplottex|shellesc)\b[^}]*\}|\\write18|\\ShellEscape|\\immediate\\write18/g;
  for (const hit of grepTex(files, shell)) {
    problems.push({
      rule: 'arxiv-shell-escape',
      check: 'venue',
      severity: 'warning',
      message: `Needs shell escape, which arXiv does not allow: ${hit.match.slice(0, 60)}`,
      location: { file: hit.file, line: hit.line },
      fix: 'Use `listings` instead of `minted`, or pre-generate the output (minted: `frozencache`) and upload it',
    });
  }
  if (ctx.main && ctx.files) {
    for (const f of ctx.files.filter((f) => /\s/.test(f) && !f.startsWith('.'))) {
      problems.push({
        rule: 'arxiv-filename-space',
        check: 'venue',
        severity: 'warning',
        message: `File name with a space: ${f}`,
        location: { file: f },
        fix: 'Rename the file without spaces (use - or _)',
      });
    }
    const usesBib = uses.some((u) => u.name === 'addbibresource' || u.name === 'bibliography');
    // arXiv compiles the main file, so it reads `<main basename>.bbl`; a `<jobname>.bbl`
    // from a build with another jobname is only usable when the names agree.
    const stem = ctx.main.replace(/\.tex$/i, '');
    const expected = `${stem}.bbl`;
    const hasBbl = ctx.files.some((f) => f.toLowerCase() === expected.toLowerCase());
    if (usesBib && !hasBbl) {
      const other = ctx.files.find(
        (f) => f.toLowerCase().endsWith('.bbl') && dirname(f) === dirname(ctx.main ?? ''),
      );
      problems.push({
        rule: 'arxiv-missing-bbl',
        check: 'venue',
        severity: 'info',
        message: other
          ? `Found ${other}, but arXiv compiles ${ctx.main} and reads ${expected}; rename or copy it to ${expected}`
          : `No ${expected} next to ${ctx.main}; arXiv does not run biber`,
        fix: other
          ? `Copy the .bbl to ${expected} (arXiv runs on the main file, not on your jobname)`
          : 'Build once, then upload the generated .bbl (named like your main file) with your sources',
        data: { expected, ...(other ? { found: other } : {}) },
      });
    }
  }
  const seen = new Set<string>();
  return problems.filter((p) => {
    const key = `${p.rule}|${p.location?.file}|${p.location?.line}|${p.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
