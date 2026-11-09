import type { Problem, Report } from '../types.js';
import { sortedProblems } from './shared.js';

/** Escapes a workflow-command message (GitHub: %, CR, LF). */
export function escapeData(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** Escapes a workflow-command property value (also `:` and `,`). */
export function escapeProperty(s: string): string {
  return escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

export interface AnnotationOptions {
  /** Prefix for file paths (e.g. the working directory relative to the repo root). */
  root?: string;
  /** Maximum number of annotations (GitHub shows at most 10 errors per step). */
  limit?: number;
}

function joinPath(root: string | undefined, file: string): string {
  if (!root || root === '.' || root === './') return file;
  return `${root.replace(/\/+$/, '')}/${file}`;
}

function annotation(p: Problem, opts: AnnotationOptions): string {
  const cmd = p.severity === 'error' ? 'error' : p.severity === 'warning' ? 'warning' : 'notice';
  const props: string[] = [];
  if (p.location?.file) {
    props.push(`file=${escapeProperty(joinPath(opts.root, p.location.file))}`);
    if (p.location.line) props.push(`line=${p.location.line}`);
  }
  props.push(`title=${escapeProperty(`overfull ${p.rule}`)}`);
  const page = p.location?.page && !p.location.file ? `Page ${p.location.page}: ` : '';
  const msg = p.fix ? `${page}${p.message}\nFix: ${p.fix}` : `${page}${p.message}`;
  return `::${cmd} ${props.join(',')}::${escapeData(msg)}`;
}

/** GitHub workflow-command annotations, errors first. */
export function githubAnnotations(report: Report, opts: AnnotationOptions = {}): string[] {
  const list = sortedProblems(report).map((p) => annotation(p, opts));
  return opts.limit ? list.slice(0, opts.limit) : list;
}
