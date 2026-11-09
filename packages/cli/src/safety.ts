import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { neutralizeWorkflowCommands, RUNNER_WHITESPACE } from '@overfull/core';
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
 * Resolves a path the CLI is about to write (a new .bib, `diff --out`,
 * `pages --out`, an `init` target) and refuses it unless it stays inside
 * `root` after symlinks: the nearest existing ancestor is resolved with
 * realpath, and a dangling symlink anywhere on the way is refused (writing
 * through it would create its target, wherever that is).
 */
export function insideRootForWrite(root: string, path: string, what: string): string {
  const abs = insideRoot(root, path, what);
  const refuse = (why: string) =>
    new UsageError(
      `${what} "${path}" ${why}. Overfull only writes files inside the project directory (${root}).`,
    );
  let probe = abs;
  for (;;) {
    let st: ReturnType<typeof lstatSync> | undefined;
    try {
      st = lstatSync(probe);
    } catch {
      st = undefined;
    }
    if (st) {
      if (st.isSymbolicLink() && !existsSync(probe)) throw refuse('goes through a dangling symlink');
      break;
    }
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  let realRoot = root;
  let realProbe = probe;
  try {
    realRoot = realpathSync(root);
    realProbe = realpathSync(probe);
  } catch {
    throw refuse('cannot be resolved');
  }
  if (!isInside(realRoot, realProbe)) throw refuse('leads outside the project through a symlink');
  return abs;
}

/** True when `path` is a symlink whose target does not exist. */
export function isDanglingSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink() && !existsSync(path);
  } catch {
    return false;
  }
}

/** CI providers' marker variables; any of them set (non-empty, not "false") means CI. */
const CI_VARS = [
  'CI',
  'GITHUB_ACTIONS',
  'TF_BUILD',
  'GITLAB_CI',
  'BUILDKITE',
  'CIRCLECI',
  'JENKINS_URL',
  'TEAMCITY_VERSION',
];

/** True when running in a CI system. Used by every CI-dependent behavior. */
export function isCI(env: Record<string, string | undefined>): boolean {
  return CI_VARS.some((k) => {
    const v = env[k];
    return v !== undefined && v !== '' && v.toLowerCase() !== 'false' && v !== '0';
  });
}

/** True inside a GitHub Actions job, where printed lines can be workflow commands. */
export function inGitHubActions(env: Record<string, string | undefined>): boolean {
  return env.GITHUB_ACTIONS === 'true';
}

export { neutralizeWorkflowCommands };

const LEADING_WS = new RegExp(`^${RUNNER_WHITESPACE}+`);

/**
 * Wraps a writer so every line it prints is neutralized, across chunk
 * boundaries. Lines end at LF or CR (as the Actions runner reads them). Every
 * chunk is processed: only the start of a line is held back, and only until it
 * is clear whether it begins with a command marker (whitespace plus at most a
 * few characters).
 */
export function neutralizingWriter(write: (s: string) => void): (s: string) => void {
  let pending = '';
  let midLine = false;
  return (s: string) => {
    let out = '';
    for (const part of s.split(/(?<=[\r\n])/)) {
      if (!part) continue;
      const complete = /[\r\n]$/.test(part);
      if (midLine) {
        // The rest of a line already known not to be a command.
        out += part;
        if (complete) midLine = false;
        continue;
      }
      pending += part;
      const head = pending.replace(LEADING_WS, '');
      const maybeMarker = head === '' || '::'.startsWith(head) || '##['.startsWith(head);
      if (complete || !maybeMarker) {
        out += neutralizeWorkflowCommands(pending);
        pending = '';
        midLine = !complete;
      }
    }
    if (out) write(out);
  };
}

/**
 * `::stop-commands::<token>` … `::<token>::`: while active, the Actions runner
 * executes no workflow command at all, whatever the text. Used around
 * untrusted human-readable output, in addition to neutralizing it.
 */
export function stopCommands(): { start: string; end: string } {
  const token = `overfull-${randomBytes(16).toString('hex')}`;
  return { start: `::stop-commands::${token}\n`, end: `::${token}::\n` };
}
