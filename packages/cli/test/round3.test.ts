/** Regression tests for the round-3 audit findings (CLI and Action). */
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Report } from '@overfull/core';
import { afterEach, describe, expect, it } from 'vitest';
import { checkImage, runCheck } from '../src/check.js';
import { resolveEngine } from '../src/commands/build.js';
import { citeCommand, sanitizeKey } from '../src/commands/cite.js';
import { DEFAULT_IMAGE } from '../src/config.js';
import { main } from '../src/main.js';
import { readTexFiles } from '../src/project.js';
import { insideRootForWrite, isCI, neutralizingWriter, stopCommands } from '../src/safety.js';
import { bindMount, dockerToolArgs, which } from '../src/tools.js';
import { memIo, tempCopy, tempDir } from './helpers.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });

function fakeBin(scripts: Record<string, string>): string {
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
function hasCommand(text: string): boolean {
  return text
    .split(/[\r\n]/)
    .some((l) => /^(::|##\[)/.test(l.replace(/^[\s\u0085\u00a0\ufeff\f\v]+/, '')));
}

/** Every line that is a workflow command, other than stop-commands markers. */
function commandsIn(text: string): string[] {
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

// --- R2: check never runs a project-chosen image ---------------------------------

describe('R2: check ignores build.image and runs tools locked down', () => {
  it('picks --image, then $OVERFULL_IMAGE, then the default; never overfull.yml', async () => {
    expect(checkImage({ env: {} })).toBe(DEFAULT_IMAGE);
    expect(checkImage({ env: { OVERFULL_IMAGE: 'overfull:dev' } })).toBe('overfull:dev');
    expect(checkImage({ env: { OVERFULL_IMAGE: 'overfull:dev' }, image: 'x/y:1' })).toBe('x/y:1');
    expect(() => checkImage({ env: {}, image: '--privileged' })).toThrow(/Invalid Docker image/);

    const log = join(tempDir(), 'docker-args');
    const bin = fakeBin({
      docker: `echo "$@" >> ${log}\nif [ "$1" = info ]; then echo 27.0; fi\necho '{}'`,
    });
    process.env.PATH = `${bin}:${savedPath}`;
    const dir = tempCopy('project');
    writeFileSync(
      join(dir, 'overfull.yml'),
      `${readFileSync(join(dir, 'overfull.yml'), 'utf8')}build:\n  image: evil.example/pwn:latest\n`,
    );
    await runCheck({
      cwd: dir,
      checks: ['accessibility'],
      engine: 'docker',
      env: { PATH: bin },
    });
    const calls = readFileSync(log, 'utf8');
    expect(calls).not.toContain('evil.example');
    const verapdf = calls.split('\n').find((l) => l.includes('--entrypoint verapdf')) ?? '';
    expect(verapdf).toContain(DEFAULT_IMAGE);
    expect(verapdf).toContain('--network none');
    expect(verapdf).toMatch(/--mount type=bind,source=[^ ]+,target=\/work,readonly/);
    expect(verapdf).toMatch(/--user \d+:\d+/);
  });

  it('dockerToolArgs puts the entrypoint before the image', () => {
    const args = dockerToolArgs('img:1', '/p', 'pdffonts', ['./a.pdf']);
    const i = args.indexOf('img:1');
    expect(args.slice(i - 2, i)).toEqual(['--entrypoint', 'pdffonts']);
    expect(args.slice(i + 1)).toEqual(['./a.pdf']);
    expect(args).not.toContain('-v');
  });
});

// --- R3/R4: workflow commands --------------------------------------------------

describe('R3: errors are neutralized in GitHub Actions, also with --annotations', () => {
  it('a UsageError carrying a command stays inert on stderr with --annotations', async () => {
    const dir = tempCopy('project');
    const io = memIo(dir, { GITHUB_ACTIONS: 'true' });
    const code = await main(['check', '--annotations', '--profile', 'x\n::error::pwned'], io);
    expect(code).toBe(2);
    expect(io.stderrText()).toContain('pwned');
    expect(hasCommand(io.stderrText())).toBe(false);
  });

  it('error messages lose control characters outside CI too', async () => {
    const io = memIo(tempCopy('project'));
    await main(['check', '--profile', 'x\u001b[31m\u202eevil'], io);
    expect(io.stderrText()).not.toContain('\u001b');
    expect(io.stderrText()).not.toContain('\u202e');
  });

  it('plain output runs inside stop-commands, with no other command line', async () => {
    const io = memIo(tempDir(), { GITHUB_ACTIONS: 'true' });
    await main(['explain', '\u3000::error::pwned'], io);
    const err = io.stderrText();
    expect(err).toMatch(/^::stop-commands::overfull-[0-9a-f]{32}\n/);
    const token = /stop-commands::(overfull-[0-9a-f]{32})/.exec(err)?.[1];
    expect(err.endsWith(`::${token}::\n`)).toBe(true);
    expect(commandsIn(err + io.stdoutText())).toEqual([]);
  });

  it('--annotations still prints annotations and no stop-commands', async () => {
    const io = memIo(tempCopy('project'), { GITHUB_ACTIONS: 'true' });
    await main(['check', '--annotations', '--offline', '--no-verapdf', '--checks', 'output'], io);
    expect(io.stdoutText()).toMatch(/^::(error|warning|notice) /m);
    expect(io.stderrText()).not.toContain('stop-commands');
  });

  it('stop-commands tokens are random', () => {
    expect(stopCommands().start).not.toBe(stopCommands().start);
  });
});

describe('R4: neutralizingWriter', () => {
  const collect = (chunks: string[]) => {
    const parts: string[] = [];
    const w = neutralizingWriter((s) => parts.push(s));
    for (const c of chunks) w(c);
    return parts.join('');
  };

  it('a CR inside a line that already started starts a new (neutralized) line', () => {
    const out = collect(['progress', ' 50%\r::error::x\n']);
    expect(hasCommand(out)).toBe(false);
    expect(out).toBe('progress 50%\r\u200b::error::x\n');
  });

  it('CR split across chunks and Unicode whitespace before the marker', () => {
    const out = collect(['ok\r', '\u00a0', ':', ':warning::a\n', '\ufeff##', '[group]g\n']);
    expect(hasCommand(out)).toBe(false);
    expect(out.replace(/\u200b/g, '')).toBe('ok\r\u00a0::warning::a\n\ufeff##[group]g\n');
  });

  it('every chunk after the first is processed, not passed raw', () => {
    const out = collect(['line one ', 'still one\n', '\u2003::set-env name=A::1\n']);
    expect(hasCommand(out)).toBe(false);
  });
});

// --- R5: writes stay inside the project -----------------------------------------

describe('R5: write paths through symlinks', () => {
  function project() {
    const outside = tempDir();
    const dir = tempDir();
    symlinkSync(outside, join(dir, 'link'));
    symlinkSync(join(outside, 'nope', 'new.bib'), join(dir, 'dangling.bib'));
    return { outside, dir };
  }

  it('insideRootForWrite refuses symlinked parents and dangling links', () => {
    const { dir } = project();
    expect(() => insideRootForWrite(dir, 'link/new.bib', 'Bibliography file')).toThrow(
      /through a symlink/,
    );
    expect(() => insideRootForWrite(dir, 'link/a/b/c.pdf', 'Output PDF')).toThrow(/symlink/);
    expect(() => insideRootForWrite(dir, 'dangling.bib', 'Bibliography file')).toThrow(
      /dangling symlink/,
    );
    expect(insideRootForWrite(dir, 'sub/new.bib', 'Bibliography file')).toBe(
      join(dir, 'sub', 'new.bib'),
    );
  });

  it('cite --bib does not create a file outside through a symlinked dir', async () => {
    const { outside, dir } = project();
    const lookup = async () => ({
      entry: {
        key: 'k',
        type: 'misc',
        line: 0,
        raw: '',
        fields: { title: 'T', doi: '10.1/x' },
      },
      source: 'doi.org',
      confidence: 1,
    });
    for (const bib of ['link/new.bib', 'dangling.bib']) {
      const io = memIo(dir);
      await expect(citeCommand(['10.1/x', '--bib', bib], io, lookup)).rejects.toThrow(/symlink/);
    }
    expect(existsSync(join(outside, 'new.bib'))).toBe(false);
    expect(existsSync(join(outside, 'nope'))).toBe(false);
  });

  it('pages --out and init refuse a symlinked target', async () => {
    const { outside, dir } = project();
    execFileSync('cp', [join(tempCopy('project'), 'thesis.pdf'), join(dir, 'main.pdf')]);
    const io = memIo(dir);
    expect(await main(['pages', '1', '--out', 'link/png'], io)).toBe(2);
    expect(io.stderrText()).toContain('symlink');
    const io2 = memIo(dir);
    expect(await main(['init', 'paper', 'link', '--no-git'], io2)).toBe(2);
    expect(await main(['init', 'paper', 'link/x', '--no-git'], memIo(dir))).toBe(2);
    expect(existsSync(join(outside, 'png'))).toBe(false);
    expect(existsSync(join(outside, 'main.tex'))).toBe(false);
    expect(existsSync(join(outside, 'x'))).toBe(false);
  });

  it('diff --out refuses a symlinked directory', async () => {
    const { dir } = project();
    expect(() => insideRootForWrite(dir, 'link/diff.pdf', 'Output PDF')).toThrow(/symlink/);
  });
});

// --- R6: build jobname ---------------------------------------------------------

describe('R6: build <file> derives the jobname unless overfull.yml sets it', () => {
  async function jobnameFor(config: [string, string] | undefined): Promise<string> {
    const log = join(tempDir(), 'latexmk-args');
    const bin = fakeBin({ latexmk: `echo "$@" > ${log}\nexit 1` });
    process.env.PATH = `${bin}:${savedPath}`;
    const dir = tempDir();
    writeFileSync(join(dir, 'main.tex'), '');
    writeFileSync(join(dir, 'other.tex'), '');
    if (config) writeFileSync(join(dir, config[0]), config[1]);
    await main(['build', 'other.tex', '--engine', 'local'], memIo(dir, { PATH: process.env.PATH }));
    return /-jobname=(\S+)/.exec(readFileSync(log, 'utf8'))?.[1] ?? '';
  }

  it('follows the given file with overfull.yaml or overfull.yml lacking jobname', async () => {
    expect(await jobnameFor(['overfull.yaml', 'checks: [build]\n'])).toBe('other');
    expect(await jobnameFor(['overfull.yml', 'checks: [build]\n'])).toBe('other');
    expect(await jobnameFor(undefined)).toBe('other');
  });

  it('keeps an explicit jobname', async () => {
    expect(await jobnameFor(['overfull.yml', 'jobname: thesis\n'])).toBe('thesis');
  });
});

// --- R8: bib outside the project -------------------------------------------------

describe('R8: a discovered .bib outside the project is a warning, not an abort', () => {
  it('\\bibliography{../shared/refs} → bib-outside-project, exit 0', async () => {
    const parent = tempDir();
    mkdirSync(join(parent, 'shared'));
    writeFileSync(join(parent, 'shared', 'refs.bib'), '@misc{s, title={Secret}}\n');
    const dir = join(parent, 'paper');
    mkdirSync(dir);
    writeFileSync(join(dir, 'main.tex'), '\\bibliography{../shared/refs}\n');
    const io = memIo(dir);
    const code = await main(['check', '--offline', '--checks', 'references', '--json'], io);
    expect(code).toBe(0);
    const report = JSON.parse(io.stdoutText()) as Report;
    const p = report.checks[0]?.problems[0];
    expect(p?.rule).toBe('bib-outside-project');
    expect(p?.message).toContain('../shared/refs.bib');
    expect(JSON.stringify(report)).not.toContain('Secret');
  });

  it('an explicit --bib outside is still refused', async () => {
    const parent = tempDir();
    const dir = join(parent, 'paper');
    mkdirSync(dir);
    writeFileSync(join(parent, 'x.bib'), '');
    const io = memIo(dir);
    expect(
      await main(['check', '--offline', '--checks', 'references', '--bib', '../x.bib'], io),
    ).toBe(2);
  });
});

// --- R9: citation keys --------------------------------------------------------

describe('R9: cite keys are BibTeX-safe', () => {
  const lookup = (key: string) => async () => ({
    entry: { key, type: 'misc', line: 0, raw: '', fields: { title: 'T', doi: '10.1/x' } },
    source: 'doi.org',
    confidence: 1,
  });

  it('rejects an unsafe --key and writes nothing', async () => {
    const dir = tempDir();
    for (const key of ['a,b', 'x}, title={evil', 'a b', 'k"q', '\\input']) {
      const io = memIo(dir);
      await expect(citeCommand(['10.1/x', '--key', key], io, lookup('k'))).rejects.toThrow(
        /Invalid --key/,
      );
    }
    expect(existsSync(join(dir, 'references.bib'))).toBe(false);
    const ok = memIo(dir);
    expect(await citeCommand(['10.1/x', '--key', 'Knuth:1984/lp.v2+x'], ok, lookup('k'))).toBe(0);
  });

  it('sanitizes keys generated from index metadata', async () => {
    expect(sanitizeKey('evil},\n@misc{x')).toBe('evilmiscx');
    expect(sanitizeKey('{}')).toBe('anon');
    const dir = tempDir();
    const io = memIo(dir);
    await citeCommand(['10.1/x'], io, lookup('evil}, note={x'));
    const text = readFileSync(join(dir, 'references.bib'), 'utf8');
    expect(text).toMatch(/^@misc\{evilnotex,/);
  });
});

// --- R12: Windows ---------------------------------------------------------------

describe('R12: Windows batch wrappers and paths', () => {
  it('which() skips .bat/.cmd on win32 unless allowed; build explains', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'latexmk.BAT'), '@echo off\n');
    const env = { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' };
    expect(which('latexmk', env, { platform: 'win32' })).toBeUndefined();
    expect(which('latexmk', env, { platform: 'win32', allowBatch: true })).toBe(
      join(dir, 'latexmk.BAT'),
    );
    await expect(resolveEngine('local', env, 'win32')).rejects.toThrow(
      /latexmk\.BAT found.*latexmk\.exe.*--engine docker/,
    );
    writeFileSync(join(dir, 'latexmk.EXE'), '');
    expect(await resolveEngine('local', env, 'win32')).toBe('local');
  });

  it('mounts with --mount so a path with ":" or "," is unambiguous', () => {
    expect(bindMount('C:\\Users\\me\\paper')).toEqual([
      '--mount',
      'type=bind,source=C:\\Users\\me\\paper,target=/work',
    ]);
    expect(bindMount('/a,b/p', true)).toEqual([
      '--mount',
      'type=bind,"source=/a,b/p",target=/work,readonly',
    ]);
  });
});

// --- R14: odd files ---------------------------------------------------------------

describe('R14: non-regular and huge files', () => {
  it('skips FIFOs and files over 20 MB when reading sources', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'main.tex'), 'x');
    execFileSync('mkfifo', [join(dir, 'pipe.tex')]);
    writeFileSync(join(dir, 'big.tex'), '');
    truncateSync(join(dir, 'big.tex'), 21 * 1024 * 1024);
    const skipped: { path: string; reason: string }[] = [];
    const files = readTexFiles(dir, ['big.tex', 'main.tex', 'pipe.tex'], skipped);
    expect(files.map((f) => f.path)).toEqual(['main.tex']);
    expect(skipped.map((s) => s.path)).toEqual(['big.tex', 'pipe.tex']);
  });

  it('check reports skipped sources as info and does not hang on a FIFO', async () => {
    const dir = tempCopy('project');
    execFileSync('mkfifo', [join(dir, 'pipe.tex')]);
    const report = await runCheck({
      cwd: dir,
      checks: ['venue'],
      verapdf: false,
      env: { PATH: process.env.PATH },
    });
    expect(rules(report)).toContain('tex-file-skipped');
  });

  it('a directory named like the log or PDF is a clean usage error', async () => {
    for (const name of ['thesis.log', 'thesis.pdf']) {
      const dir = tempCopy('project');
      execFileSync('rm', [join(dir, name)]);
      mkdirSync(join(dir, name));
      const io = memIo(dir);
      expect(await main(['check', '--offline', '--no-verapdf'], io), name).toBe(2);
      expect(io.stderrText()).toContain('is not a file');
      expect(io.stderrText()).not.toContain('internal error');
    }
  });
});
