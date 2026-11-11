/** Path helpers for file names as TeX prints them. Browser-safe (no `node:path`). */

/** Directories that belong to a TeX distribution rather than to the project. */
const DISTRIBUTION_DIR = /(?:^|\/)(?:texmf[\w-]*|\.texlive\d*|texlive\/\d{4}|miktex[^/]*)\//i;

/** Extensions TeX commonly opens, as a regex alternation (no anchors). */
export const TEX_EXTENSION_GROUP =
  '(?:tex|ltx|sty|cls|clo|cfg|def|fd|aux|toc|lof|lot|bbl|out|nav|snm|vrb|ldf|dfu|lua|bst|tikz|pgf|mkii|trsl|dict|xmpi|ins|dtx|tikzstyles)';

/** Extensions TeX commonly opens; used to recognise bare file names such as `article.cls`. */
const TEX_EXTENSIONS = new RegExp(`\\.${TEX_EXTENSION_GROUP}$`, 'i');

/**
 * A file path that may contain spaces, as TeX prints it: it starts like a path (`./`,
 * `../`, `/`, `~/`, `C:\`) and ends in a known TeX extension. Used to take the whole of
 * `./sub dir/intro.tex` where a whitespace-delimited token would stop at `./sub`.
 */
export const SPACED_PATH_SOURCE = `(?:\\.{1,2}/|/|~/|[A-Za-z]:[\\\\/])[^:()[\\]{}<>\\n"]{0,1024}?\\.${TEX_EXTENSION_GROUP}`;

/** Length of a spaced path starting at `text[start]`, or 0 when there is none. */
export function spacedPathLength(text: string, start: number): number {
  const m = SPACED_PATH_AT.exec(text.slice(start, start + 1100));
  return m ? m[0].length : 0;
}

const SPACED_PATH_AT = new RegExp(`^${SPACED_PATH_SOURCE}(?=[\\s()[\\]{}<>"]|$)`, 'i');

export function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

export function extension(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function cleanRoot(root: string): string {
  let r = root.replace(/\\/g, '/');
  while (r.length > 1 && r.endsWith('/')) r = r.slice(0, -1);
  return r;
}

/** True when `p` lies under `root`; Windows drive letters compare case-insensitively. */
function underRoot(p: string, root: string): boolean {
  if (p.startsWith(`${root}/`)) return true;
  const drive = /^[A-Za-z]:\//;
  return (
    drive.test(root) &&
    drive.test(p) &&
    p.length > root.length &&
    p[root.length] === '/' &&
    p.slice(0, root.length).toLowerCase() === root.toLowerCase()
  );
}

/**
 * Makes a path as printed in a log project-relative with forward slashes:
 * strips `./`, strips `root` when the path lies under it, and reduces files of
 * the TeX distribution (`…/texmf-dist/…/article.cls`) to their basename.
 */
export function normalizePath(path: string, root?: string): string {
  let p = path.trim().replace(/\\/g, '/');
  if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) p = p.slice(1, -1);
  const r = root ? cleanRoot(root) : '';
  if (r && underRoot(p, r)) p = p.slice(r.length + 1);
  else if (DISTRIBUTION_DIR.test(p)) return basename(p);
  p = p.replace(/\/{2,}/g, '/').replace(/\/(?:\.\/)+/g, '/');
  while (p.startsWith('./')) p = p.slice(2);
  return p;
}

/** True when `token` (the text right after a `(` in the log) is a file TeX opened. */
export function isFileToken(token: string): boolean {
  if (token.length === 0) return false;
  if (/^(?:\.{1,2}\/|\/|~\/|[A-Za-z]:[\\/])/.test(token)) return token.length > 2;
  return /^[\w-][\w.\-/]*$/.test(token) && TEX_EXTENSIONS.test(token);
}

