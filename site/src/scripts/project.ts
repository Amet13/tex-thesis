/**
 * Picks the files of a project (from a .zip or a dropped folder) that the
 * browser check uses. Pure functions: no DOM, no I/O.
 */

export type ProjectKind = 'tex' | 'bib' | 'aux' | 'log' | 'pdf';

export interface ProjectFile {
  /** Clean relative path with forward slashes. */
  path: string;
  kind: ProjectKind;
  text?: string;
  data?: Uint8Array;
}

/** File kinds a project contributes, by extension only (a README.txt is not a log). */
export function projectKindOf(path: string): ProjectKind | null {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  if (ext === 'tex' || ext === 'bib' || ext === 'log' || ext === 'pdf') return ext;
  if (ext === 'aux' || ext === 'bcf') return 'aux';
  return null;
}

const stem = (path: string) => path.replace(/\.[^./]+$/, '');
const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** True when the source has a \documentclass that is not commented out. */
function hasDocumentclass(text: string): boolean {
  return /^[^%\n]*\\documentclass\b/m.test(text.replace(/\\%/g, ''));
}

export interface MainChoice {
  /** The chosen main file, or undefined when there is none or the user must choose. */
  main?: string;
  /** Candidates to offer when several fit and nothing settles it. */
  candidates: string[];
}

/**
 * main.tex if it is at the root; else the only root-level .tex with a
 * \documentclass; if several, the one with a .log or .pdf of the same name;
 * if that does not settle it, the candidates are returned for the user.
 * Without any root-level candidate, .tex files deeper in the tree are tried.
 */
export function chooseMain(files: ProjectFile[]): MainChoice {
  const tex = files.filter((f) => f.kind === 'tex');
  if (tex.some((f) => f.path === 'main.tex')) return { main: 'main.tex', candidates: [] };
  const withClass = (list: ProjectFile[]) =>
    list.filter((f) => hasDocumentclass(f.text ?? '')).map((f) => f.path);
  let candidates = withClass(tex.filter((f) => !f.path.includes('/')));
  if (!candidates.length) candidates = withClass(tex);
  candidates.sort();
  if (candidates.length === 1) return { main: candidates[0] as string, candidates };
  if (candidates.length === 0) return { candidates };
  const built = new Set(
    files.filter((f) => f.kind === 'log' || f.kind === 'pdf').map((f) => stem(f.path)),
  );
  const matching = candidates.filter((c) => built.has(stem(c)));
  if (matching.length === 1) return { main: matching[0] as string, candidates };
  return { candidates };
}

/**
 * The files the checks run on, for a chosen main file: every .tex and .bib,
 * and the .log, .aux/.bcf and .pdf that belong to it (same name next to it),
 * else the first of each at the root.
 */
export function selectForMain(files: ProjectFile[], main: string | undefined): ProjectFile[] {
  const out = files.filter((f) => f.kind === 'tex' || f.kind === 'bib');
  const dir = main ? dirOf(main) : '';
  const base = main ? stem(main) : '';
  const rest = files.filter((f) => f.kind !== 'tex' && f.kind !== 'bib');
  for (const kind of ['log', 'pdf', 'aux'] as const) {
    const ofKind = rest.filter((f) => f.kind === kind).sort((a, b) => a.path.localeCompare(b.path));
    const same = ofKind.filter((f) => stem(f.path) === base);
    if (same.length) out.push(...same);
    else {
      const near = ofKind.filter((f) => dirOf(f.path) === dir);
      if (kind === 'aux') out.push(...near);
      else if (near[0]) out.push(near[0]);
    }
  }
  return out;
}
