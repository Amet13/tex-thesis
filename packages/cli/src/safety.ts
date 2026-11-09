import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { UsageError } from './io.js';

/**
 * Names that reach latexmk, which builds a shell command line from them
 * (`-jobname`, the main file, `-outdir`). Only plain path characters pass.
 */
const SAFE_NAME = /^[A-Za-z0-9._/-]+$/;

function checkName(value: string, what: string, allowSlash: boolean): string {
  const segments = value.split('/');
  const ok =
    SAFE_NAME.test(value) &&
    !value.startsWith('-') &&
    !value.startsWith('/') &&
    (allowSlash || !value.includes('/')) &&
    !segments.includes('..') &&
    !segments.some((s) => s.startsWith('-'));
  if (!ok) {
    throw new UsageError(
      `Unsafe ${what} "${value}": use only letters, digits, ".", "_", "-"${allowSlash ? ' and "/"' : ''}, ` +
        `no leading "-" and no ".." (latexmk passes it to a shell).`,
    );
  }
  return value;
}

/** Validates a jobname: plain file name, no directories. */
export function safeJobname(value: string): string {
  return checkName(value, 'jobname', false);
}

/** Validates a project-relative main file or output directory (may contain "/"). */
export function safeRelPath(value: string, what = 'main file'): string {
  return checkName(value.split('\\').join('/'), what, true);
}

/**
 * A Docker image reference: [registry[:port]/]name[/name...][:tag][@sha256:digest].
 * Rejects anything that could be read as a `docker run` option.
 */
const IMAGE_REF =
  /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?(?::[0-9]+)?\/)?[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(?:@sha256:[a-f0-9]{64})?$/;

export function safeImage(value: string, where = 'image'): string {
  if (value.startsWith('-') || !IMAGE_REF.test(value)) {
    throw new UsageError(
      `Invalid Docker image "${value}" (${where}). Use a reference like ghcr.io/owner/name:tag.`,
    );
  }
  return value;
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

/**
 * Resolves `path` against the project root and refuses anything outside it,
 * including through symlinks. `what` names the path in the error.
 */
export function insideRoot(root: string, path: string, what: string): string {
  const abs = resolve(root, path);
  let ok = isInside(root, abs);
  if (ok && existsSync(abs)) {
    try {
      ok = isInside(realpathSync(root), realpathSync(abs));
    } catch {
      /* unreadable: the lexical check stands */
    }
  }
  if (!ok) {
    throw new UsageError(
      `${what} "${path}" is outside the project directory (${root}). Overfull only reads and writes files inside the project.`,
    );
  }
  return abs;
}

/** Like insideRoot, but returns undefined instead of throwing (for paths found inside files). */
export function insideRootOrUndefined(root: string, path: string): string | undefined {
  try {
    return insideRoot(root, path, 'path');
  } catch {
    return undefined;
  }
}

/**
 * Neutralizes GitHub workflow commands in untrusted text: a line whose first
 * non-blank characters are `::` (or `##[`) would be run by the Actions runner,
 * which trims leading whitespace before matching. A zero-width space before
 * the marker keeps the line readable but no longer a command.
 */
export function neutralizeWorkflowCommands(text: string): string {
  return text.replace(/^([ \t]*)(::|##\[)/gm, '$1\u200b$2');
}

/**
 * Wraps a writer so every line it prints is neutralized, across chunk
 * boundaries. A line start is held back only until it is clear whether it
 * begins with a command marker (at most a few characters).
 */
export function neutralizingWriter(write: (s: string) => void): (s: string) => void {
  let line = '';
  let decided = false;
  return (s: string) => {
    let out = '';
    for (const part of s.split(/(?<=\n)/)) {
      if (!part) continue;
      if (decided) {
        out += part;
        if (part.endsWith('\n')) decided = false;
        continue;
      }
      line += part;
      const complete = line.endsWith('\n');
      const head = line.replace(/^[ \t]+/, '');
      const maybeMarker = head === '' || '::'.startsWith(head) || '##['.startsWith(head);
      if (complete || !maybeMarker) {
        out += neutralizeWorkflowCommands(line);
        decided = !complete;
        line = '';
      }
    }
    if (out) write(out);
  };
}
