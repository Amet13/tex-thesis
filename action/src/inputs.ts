import { isAbsolute, resolve } from 'node:path';
import type { CheckId, CheckOptions } from 'overfull';

/** Reads an Action input the way the runner passes it (INPUT_<NAME>, spaces → _). */
export function input(env: Record<string, string | undefined>, name: string): string | undefined {
  const v = env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`];
  const t = v?.trim();
  return t ? t : undefined;
}

export function boolInput(
  env: Record<string, string | undefined>,
  name: string,
  fallback: boolean,
): boolean {
  const v = input(env, name);
  if (v === undefined) return fallback;
  if (/^(true|yes|1|on)$/i.test(v)) return true;
  if (/^(false|no|0|off)$/i.test(v)) return false;
  throw new Error(`Input "${name}" must be true or false, got "${v}"`);
}

const splitList = (v: string | undefined) =>
  v
    ?.split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

export interface ActionInputs {
  workingDirectory: string;
  failOn: 'error' | 'warning' | 'never';
  annotations: boolean;
  summary: boolean;
  check: CheckOptions;
}

/** Turns the Action inputs into check options. Empty inputs fall back to overfull.yml. */
export function readInputs(
  env: Record<string, string | undefined>,
  workspace: string,
): ActionInputs {
  const workingDirectory = input(env, 'working-directory') ?? '.';
  const failOn = input(env, 'fail-on') ?? 'error';
  if (!['error', 'warning', 'never'].includes(failOn)) {
    throw new Error(`Input "fail-on" must be error, warning or never, got "${failOn}"`);
  }
  const checks = splitList(input(env, 'checks')) as CheckId[] | undefined;
  const bib = splitList(input(env, 'bib'));
  const opt = (name: string) => input(env, name);
  const check: CheckOptions = {
    cwd: isAbsolute(workingDirectory) ? workingDirectory : resolve(workspace, workingDirectory),
    env,
    // The Action only checks existing outputs; it never starts containers.
    engine: 'local',
    runner: 'action',
    offline: boolInput(env, 'offline', false),
    ...(checks?.length ? { checks } : {}),
    ...(bib?.length ? { bib } : {}),
    ...(opt('profile') ? { profile: opt('profile') } : {}),
    ...(opt('pdf') ? { pdf: opt('pdf') } : {}),
    ...(opt('log') ? { log: opt('log') } : {}),
    ...(opt('aux') ? { aux: opt('aux') } : {}),
    ...(opt('mailto') ? { mailto: opt('mailto') } : {}),
  };
  return {
    workingDirectory,
    failOn: failOn as ActionInputs['failOn'],
    annotations: boolInput(env, 'annotations', true),
    summary: boolInput(env, 'summary', true),
    check,
  };
}
