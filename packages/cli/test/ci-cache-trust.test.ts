/** A project cache never vouches for references in CI; one CI detector. */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Report } from '@overfull/core';
import { afterEach, describe, expect, it } from 'vitest';
import { runCheck } from '../src/check.js';
import { isCI } from '../src/safety.js';
import { tempDir } from './helpers.js';

/** Shell-script fakes on PATH and FIFOs do not exist on Windows; these tests run on Linux and macOS. */
const _POSIX_ONLY = process.platform === 'win32';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });

function _fakeBin(scripts: Record<string, string>): string {
  const dir = tempDir();
  for (const [name, body] of Object.entries(scripts)) {
    const p = join(dir, name);
    writeFileSync(p, `#!/bin/sh\n${body}\n`);
    chmodSync(p, 0o755);
  }
  return dir;
}

const savedPath = process.env.PATH;
afterEach(() => {
  process.env.PATH = savedPath;
});

const rules = (r: Report) => r.checks.flatMap((c) => c.problems.map((p) => p.rule));

/** True when some line, after the whitespace the Actions runner trims, is a workflow command. */
function _hasCommand(text: string): boolean {
  return text
    .split(/[\r\n]/)
    .some((l) => /^(::|##\[)/.test(l.replace(/^[\s\u0085\u00a0\ufeff\f\v]+/, '')));
}

/** Every line that is a workflow command, other than stop-commands markers. */
function _commandsIn(text: string): string[] {
  return text
    .split(/[\r\n]/)
    .map((l) => l.replace(/^[\s\u0085\u00a0\ufeff\f\v]+/, ''))
    .filter((l) => /^(::|##\[)/.test(l))
    .filter((l) => !/^::(stop-commands::overfull-[0-9a-f]{32}|overfull-[0-9a-f]{32}::)$/.test(l));
}

// --- R1: project cache -------------------------------------------------------

const FAKE_TITLE = 'Zorbulating hyperflux capacitors in submerged tandem orchards two';
const FORGED = JSON.stringify({
  [`title:${FAKE_TITLE.toLowerCase()}|2023`]: {
    crossref: [
      {
        source: 'crossref',
        title: FAKE_TITLE,
        authors: [{ family: 'Zyx', given: 'Quorbl' }],
        years: [2023],
        venue: 'Journal of Imaginary Results',
        doi: '10.1234/fake',
        type: 'journal-article',
        citations: 0,
      },
    ],
    arxiv: [],
    openalex: [],
    dblp: [],
    cachedAt: { crossref: Date.now(), arxiv: Date.now(), openalex: Date.now(), dblp: Date.now() },
  },
});

/** A project whose committed cache claims a made-up paper exists. `layout` places the cache. */
function forgedProject(layout: 'real' | 'symlink'): string {
  const dir = tempDir();
  writeFileSync(join(dir, 'overfull.yml'), 'bib: [refs.bib]\nreferences:\n  cache: project\n');
  writeFileSync(
    join(dir, 'refs.bib'),
    `@article{fake3, title = {${FAKE_TITLE}}, author = {Zyx, Quorbl},\n  journal = {Journal of Imaginary Results}, year = {2023}}\n`,
  );
  const target = layout === 'real' ? join(dir, '.overfull') : join(dir, 'stuff');
  mkdirSync(join(target, 'cache'), { recursive: true });
  writeFileSync(join(target, 'cache', 'refs.json'), FORGED);
  if (layout === 'symlink') symlinkSync('stuff', join(dir, '.overfull'));
  return dir;
}

const offlineFetch = (async () => {
  throw new TypeError('fetch failed');
}) as typeof fetch;

async function statusOf(dir: string, env: Record<string, string | undefined>) {
  const report = await runCheck({
    cwd: dir,
    checks: ['references'],
    fetch: offlineFetch,
    env: { PATH: process.env.PATH, ...env },
  });
  return { report, refs: report.checks.find((c) => c.check === 'references') };
}

describe('R1: a project cache never vouches for references in CI', () => {
  it('control: outside CI a real .overfull cache is used (the forged entry verifies)', async () => {
    const { refs } = await statusOf(forgedProject('real'), {});
    expect(refs?.stats?.verified).toBe(1);
  });

  it('CI + .overfull symlinked to a git-tracked dir: ignored', async () => {
    const dir = forgedProject('symlink');
    git(dir, 'init', '-q');
    git(dir, 'add', '-A');
    const { report, refs } = await statusOf(dir, { GITHUB_ACTIONS: 'true' });
    expect(refs?.stats?.verified).toBe(0);
    expect(rules(report)).toContain('refs-cache-ignored');
  });

  it('CI without a .git directory (artifact, tarball): ignored, for any CI provider', async () => {
    for (const ci of ['CI', 'GITLAB_CI', 'TF_BUILD', 'BUILDKITE', 'JENKINS_URL']) {
      const { report, refs } = await statusOf(forgedProject('real'), { [ci]: 'true' });
      expect(refs?.stats?.verified, ci).toBe(0);
      expect(rules(report), ci).toContain('refs-cache-ignored');
    }
  });

  it('outside CI: a cache reached through a symlink is not used or written', async () => {
    const dir = forgedProject('symlink');
    const { report, refs } = await statusOf(dir, {});
    expect(refs?.stats?.verified).toBe(0);
    expect(rules(report)).toContain('refs-cache-ignored');
    expect(readFileSync(join(dir, 'stuff', 'cache', 'refs.json'), 'utf8')).toBe(FORGED);
  });
});

describe('R13: one CI detector', () => {
  it('recognizes the common providers and ignores false values', () => {
    for (const k of [
      'CI',
      'GITHUB_ACTIONS',
      'TF_BUILD',
      'GITLAB_CI',
      'BUILDKITE',
      'CIRCLECI',
      'JENKINS_URL',
      'TEAMCITY_VERSION',
    ])
      expect(isCI({ [k]: k === 'JENKINS_URL' ? 'https://ci.example' : 'true' }), k).toBe(true);
    expect(isCI({})).toBe(false);
    expect(isCI({ CI: 'false' })).toBe(false);
    expect(isCI({ CI: '' })).toBe(false);
  });
});
