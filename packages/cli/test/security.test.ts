import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Report } from '@overfull/core';
import { afterEach, describe, expect, it } from 'vitest';
import { readInputs } from '../../../action/src/inputs.js';
import { escapeData, outputRecord } from '../../../action/src/output.js';
import { refsCachePath, userCacheDir } from '../src/cache.js';
import { runCheck } from '../src/check.js';
import { buildHelp, latexmkArgs } from '../src/commands/build.js';
import { citeCommand } from '../src/commands/cite.js';
import { defaultBase } from '../src/commands/diff.js';
import { latexmkrcDirs, loadConfig } from '../src/config.js';
import { main } from '../src/main.js';
import { isDiffArtifact, listFiles, readAux } from '../src/project.js';
import {
  neutralizeWorkflowCommands,
  neutralizingWriter,
  safeImage,
  safeJobname,
  safeRelPath,
} from '../src/safety.js';
import { imageUnavailable, quoteWindowsArg } from '../src/tools.js';
import { runVeraPdf, verapdfFlavour } from '../src/verapdf.js';
import { memIo, tempCopy, tempDir } from './helpers.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.org',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.org',
    },
  })
    .toString()
    .trim();

/** A directory with fake executables, put first on PATH for the test. */
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

describe('S1: names that reach latexmk are validated', () => {
  it('rejects a jobname with shell syntax in overfull.yml (exit 2)', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'overfull.yml'), 'jobname: "x$(id>PWNED)"\n');
    writeFileSync(join(dir, 'main.tex'), '\\documentclass{article}\n');
    const io = memIo(dir);
    expect(await main(['build', '--engine', 'local'], io)).toBe(2);
    expect(io.stderrText()).toContain('Unsafe jobname');
    expect(existsSync(join(dir, 'PWNED'))).toBe(false);
  });

  it('rejects unsafe main, jobname and output directories', () => {
    expect(() => safeJobname('a/b')).toThrow(/Unsafe jobname/);
    expect(() => safeJobname('-x')).toThrow();
    expect(() => safeRelPath('../main.tex')).toThrow();
    expect(() => safeRelPath('chapters/../../x.tex')).toThrow();
    expect(() => safeRelPath('a b.tex')).toThrow();
    expect(() => safeRelPath('-main.tex')).toThrow();
    expect(safeRelPath('src/main.tex')).toBe('src/main.tex');
    expect(safeJobname('thesis-v2.final')).toBe('thesis-v2.final');
    const dir = tempDir();
    writeFileSync(join(dir, 'overfull.yml'), 'main: "../x.tex"\n');
    expect(() => loadConfig(dir)).toThrow(/Unsafe main file/);
  });

  it('validates Docker image references from every source', async () => {
    expect(safeImage('ghcr.io/amet13/overfull:0.1')).toBe('ghcr.io/amet13/overfull:0.1');
    expect(safeImage('overfull:dev')).toBe('overfull:dev');
    expect(safeImage(`localhost:5000/a/b@sha256:${'a'.repeat(64)}`)).toContain('sha256');
    expect(() => safeImage('-v/:/host')).toThrow(/Invalid Docker image/);
    expect(() => safeImage('img;rm -rf /')).toThrow();
    const dir = tempDir();
    writeFileSync(join(dir, 'main.tex'), 'x');
    expect(() => loadConfig(dir, undefined, { OVERFULL_IMAGE: '--privileged' })).toThrow(
      /OVERFULL_IMAGE/,
    );
    writeFileSync(join(dir, 'overfull.yml'), 'build: { image: "--privileged" }\n');
    expect(() => loadConfig(dir)).toThrow(/build.image/);
    const io = memIo(tempDir());
    writeFileSync(join(io.cwd, 'main.tex'), 'x');
    expect(await main(['build', '--image=-v/:/x'], io)).toBe(2);
    expect(io.stderrText()).toContain('Invalid Docker image');
  });

  it('build --help lists the image precedence (C7)', () => {
    expect(buildHelp).toMatch(/--image, then \$OVERFULL_IMAGE, then\s+build\.image/);
  });
});

describe('S2: workflow commands in printed text', () => {
  it('neutralizes lines that start with :: or ##[, also after blanks', () => {
    const out = neutralizeWorkflowCommands(
      'ok\n::error::x\n  ::set-env name=A::1\n##[group]g\nnot ::x',
    );
    for (const line of out.split('\n')) expect(line.trimStart().startsWith('::')).toBe(false);
    expect(out).toContain('not ::x');
    expect(out).toContain('\u200b::error::x');
  });

  it('neutralizes across chunk boundaries', () => {
    const parts: string[] = [];
    const w = neutralizingWriter((s) => parts.push(s));
    w('line one\n  :');
    w(':warning::bad\nfine');
    w(' end\n::');
    w('stop-commands::t\n');
    const text = parts.join('');
    expect(text).toBe('line one\n  \u200b::warning::bad\nfine end\n\u200b::stop-commands::t\n');
  });

  it('main() neutralizes stdout and stderr in GitHub Actions, except --annotations', async () => {
    const dir = tempDir();
    const io = memIo(dir, { GITHUB_ACTIONS: 'true' });
    // An unknown rule id is echoed back on stderr.
    await main(['explain', '\n::error::pwned'], io);
    expect(io.stderrText()).not.toMatch(/^::error/m);
  });

  it('writes step outputs with a random delimiter', () => {
    const a = outputRecord('status', 'pass');
    const b = outputRecord('status', 'pass');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^status<<ghadelimiter_[0-9a-f-]{36}\npass\nghadelimiter_[0-9a-f-]{36}\n$/);
    expect(() => outputRecord('x', 'a\nEOF\nb', 'EOF')).toThrow();
    expect(escapeData('a\nb%')).toBe('a%0Ab%25');
  });

  it('C8: the Action resolves working-directory with path.isAbsolute', () => {
    const rel = readInputs({ 'INPUT_WORKING-DIRECTORY': 'paper' }, '/ws');
    expect(rel.check.cwd).toBe('/ws/paper');
    const abs = readInputs({ 'INPUT_WORKING-DIRECTORY': '/abs/dir' }, '/ws');
    expect(abs.check.cwd).toBe('/abs/dir');
    expect(abs.check.engine).toBe('local');
  });
});

describe('S3: reference cache location', () => {
  it('defaults to the user cache dir, keyed by project', () => {
    const env = { XDG_CACHE_HOME: '/xdg' };
    const a = refsCachePath('/p/one', 'user', env);
    const b = refsCachePath('/p/two', 'user', env);
    expect(a.startsWith('/xdg/overfull/')).toBe(true);
    expect(a).not.toBe(b);
    expect(userCacheDir({ HOME: '/home/u' }, 'linux')).toBe('/home/u/.cache/overfull');
    expect(userCacheDir({ LOCALAPPDATA: 'C:\\L' }, 'win32')).toContain('overfull');
    expect(refsCachePath('/p', 'project', env)).toBe('/p/.overfull/cache/refs.json');
  });

  it('ignores a git-tracked project cache in CI', async () => {
    const dir = tempCopy('project');
    writeFileSync(
      join(dir, 'overfull.yml'),
      'main: main.tex\njobname: thesis\nbib: [references.bib]\nreferences:\n  cache: project\n',
    );
    mkdirSync(join(dir, '.overfull', 'cache'), { recursive: true });
    writeFileSync(join(dir, '.overfull', 'cache', 'refs.json'), '{}\n');
    git(dir, 'init', '-q');
    git(dir, 'add', '-A');
    const report = await runCheck({
      cwd: dir,
      checks: ['references'],
      offline: true,
      env: { PATH: process.env.PATH, CI: 'true' },
    });
    const rules = report.checks.flatMap((c) => c.problems.map((p) => p.rule));
    expect(rules).toContain('refs-cache-ignored');
    const local = await runCheck({
      cwd: dir,
      checks: ['references'],
      offline: true,
      env: { PATH: process.env.PATH },
    });
    expect(local.checks.flatMap((c) => c.problems.map((p) => p.rule))).not.toContain(
      'refs-cache-ignored',
    );
  });
});

describe('S4: paths stay inside the project', () => {
  it('refuses check paths and bib files outside the root', async () => {
    const parent = tempDir();
    const dir = join(parent, 'proj');
    mkdirSync(dir);
    writeFileSync(join(parent, 'secret.bib'), '@misc{s, title={Secret}}\n');
    writeFileSync(join(dir, 'overfull.yml'), 'bib: [../secret.bib]\n');
    for (const args of [
      ['check', '--offline', '--checks', 'references'],
      ['check', '--offline', '--checks', 'build', '--log', '../x.log'],
      ['check', '--offline', '--checks', 'output', '--pdf', '/etc/passwd'],
      ['cite', '10.1/x', '--bib', '../secret.bib', '--dry-run'],
    ]) {
      const io = memIo(dir);
      expect(await main(args, io), args.join(' ')).toBe(2);
      expect(io.stderrText()).toContain('outside the project directory');
    }
  });

  it('does not follow symlinked directories or outside aux inputs', () => {
    const outside = tempDir();
    writeFileSync(join(outside, 'leak.tex'), 'secret');
    writeFileSync(join(outside, 'leak.aux'), '\\citation{leaked}');
    const dir = tempDir();
    writeFileSync(join(dir, 'main.tex'), 'x');
    symlinkSync(outside, join(dir, 'linked'));
    symlinkSync(join(outside, 'leak.tex'), join(dir, 'leak.tex'));
    expect(listFiles(dir)).toEqual(['main.tex']);
    writeFileSync(join(dir, 'main.aux'), `\\@input{../${outside.split('/').pop()}/leak.aux}\n`);
    expect(readAux(dir, 'main')).not.toContain('leaked');
  });
});

describe('C1: veraPDF flavour follows the PDF/UA claim', () => {
  it('maps pdfuaid:part to a flavour', () => {
    expect(verapdfFlavour(1)).toBe('ua1');
    expect(verapdfFlavour(2)).toBe('ua2');
    expect(verapdfFlavour(undefined)).toBe('ua2');
  });

  it('runs ua1 for a PDF/UA-1 file, without a ua2 attempt', async () => {
    const log = join(tempDir(), 'args');
    const bin = fakeBin({
      verapdf: `echo "$@" >> ${log}\necho '{"report":{"jobs":[{"validationResult":[{"compliant":true,"details":{"ruleSummaries":[]}}]}]}}'`,
    });
    const res = await runVeraPdf('/tmp/x.pdf', { PATH: bin }, { pdfuaPart: 1 });
    expect(res).not.toBeNull();
    process.env.PATH = `${bin}:${savedPath}`;
    await runVeraPdf('/tmp/x.pdf', { PATH: `${bin}:${savedPath}` }, { pdfuaPart: 1 });
    const calls = readFileSync(log, 'utf8').trim().split('\n');
    expect(calls.every((c) => c.includes('--flavour ua1'))).toBe(true);
  });
});

describe('C2: \\nocite{*} verifies every entry', () => {
  it('looks up uncited entries when the aux has \\citation{*}', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'main.tex'), '\\bibliography{refs}');
    writeFileSync(
      join(dir, 'refs.bib'),
      ['a', 'b', 'c']
        .map((k) => `@article{${k}, title={T ${k}}, author={X}, year={2020}, doi={10.9999/${k}}}`)
        .join('\n'),
    );
    writeFileSync(join(dir, 'main.aux'), '\\citation{a}\n\\citation{*}\n');
    const urls: string[] = [];
    const fetch = (async (u: string | URL | Request) => {
      urls.push(String(u));
      return new Response('', { status: 404 });
    }) as typeof globalThis.fetch;
    await runCheck({ cwd: dir, checks: ['references'], fetch, cache: false, env: {} });
    const joined = decodeURIComponent(urls.join(' '));
    for (const k of ['a', 'b', 'c']) expect(joined).toContain(`10.9999/${k}`);
  });
});

describe('C3: diff', () => {
  it('falls back to HEAD~1 when the merge-base is HEAD', async () => {
    const dir = tempDir();
    git(dir, 'init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'a.tex'), '1');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'one');
    writeFileSync(join(dir, 'a.tex'), '2');
    git(dir, 'commit', '-qam', 'two');
    git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    const base = await defaultBase(dir);
    expect(base?.ref).toBe(git(dir, 'rev-parse', 'HEAD~1'));
    expect(base?.note).toContain('HEAD~1');
  });

  it('skips latexdiff output when scanning tex files', () => {
    expect(isDiffArtifact('main-diff1a2b3c4.tex')).toBe(true);
    expect(isDiffArtifact('chapters/intro-diffdeadbeef.tex')).toBe(true);
    expect(isDiffArtifact('overfull-diff.tex')).toBe(true);
    expect(isDiffArtifact('my-diffusion.tex')).toBe(false);
  });

  it('reports a Docker failure (exit 125) instead of retrying latexdiff', async () => {
    const bin = fakeBin({
      docker: `if [ "$1" = info ]; then echo 27.0; exit 0; fi\necho "Unable to find image: manifest unknown" >&2\nexit 125`,
    });
    process.env.PATH = `${bin}:${savedPath}`;
    const dir = tempDir();
    git(dir, 'init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'main.tex'), '1');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'one');
    writeFileSync(join(dir, 'main.tex'), '2');
    git(dir, 'commit', '-qam', 'two');
    const io = memIo(dir, { PATH: process.env.PATH });
    expect(await main(['diff', '--engine', 'docker'], io)).toBe(2);
    expect(io.stderrText()).toContain('is not available');
    expect(io.stderrText()).not.toContain('retrying');
  });
});

describe('C4: latexmk output directory', () => {
  it('passes build.outDir and reads outputs from it', async () => {
    const dir = tempCopy('project');
    mkdirSync(join(dir, 'build'));
    for (const ext of ['log', 'pdf', 'aux', 'bbl'])
      execFileSync('mv', [join(dir, `thesis.${ext}`), join(dir, 'build')]);
    writeFileSync(
      join(dir, 'overfull.yml'),
      `${readFileSync(join(dir, 'overfull.yml'), 'utf8')}build:\n  outDir: build\n`,
    );
    const config = loadConfig(dir);
    expect(latexmkArgs(config, 'main.tex')).toEqual(
      expect.arrayContaining(['-outdir=build', '-auxdir=build', '-jobname=thesis']),
    );
    const report = await runCheck({
      cwd: dir,
      checks: ['build', 'output'],
      offline: true,
      verapdf: false,
      env: { PATH: process.env.PATH },
    });
    expect(report.target).toBe('build/thesis.pdf');
    expect(report.checks.every((c) => c.status !== 'skipped')).toBe(true);
  });

  it('uses $out_dir from .latexmkrc when build.outDir is unset', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.latexmkrc'), "$pdf_mode = 4;\n$out_dir = 'out';\n");
    expect(latexmkrcDirs(dir)).toEqual({ outDir: 'out' });
    const config = loadConfig(dir);
    expect(config.build.outDir).toBe('out');
    expect(latexmkArgs(config, 'main.tex').some((a) => a.startsWith('-outdir'))).toBe(false);
  });
});

describe('C6: CLI rules are explained', () => {
  it('explains bib-file-missing and lists it', async () => {
    const io = memIo(tempDir());
    expect(await main(['explain', 'bib-file-missing'], io)).toBe(0);
    const list = memIo(tempDir());
    await main(['explain', '--list'], list);
    expect(list.stdoutText()).toContain('bib-file-missing');
    expect(list.stdoutText()).toContain('refs-cache-ignored');
  });
});

describe('C8 / H4 helpers', () => {
  it('quotes Windows arguments and refuses shell metacharacters', () => {
    expect(quoteWindowsArg('C:\\My Files\\a.pdf')).toBe('"C:\\My Files\\a.pdf"');
    expect(quoteWindowsArg('--format')).toBe('--format');
    expect(() => quoteWindowsArg('a&calc')).toThrow();
  });

  it('recognizes an image that cannot be pulled', () => {
    expect(imageUnavailable('Error response from daemon: manifest unknown')).toBe(true);
    expect(imageUnavailable('pull access denied for x')).toBe(true);
    expect(imageUnavailable('no space left on device')).toBe(false);
  });

  it('doctor does not say "Ready to build" when the image is unavailable', async () => {
    const bin = fakeBin({
      docker: `case "$1" in info) echo 27.0; exit 0;; image) exit 1;; manifest) echo "manifest unknown" >&2; exit 1;; esac\nexit 1`,
    });
    process.env.PATH = `${bin}:/usr/bin:/bin`;
    const io = memIo(tempDir(), { PATH: process.env.PATH });
    await main(['doctor'], io);
    expect(io.stdoutText()).toContain('is not available');
    expect(io.stdoutText()).not.toContain('Ready to build');
  });
});

describe('H5: check --engine', () => {
  it('rejects an unknown engine', async () => {
    const io = memIo(tempCopy('project'));
    expect(await main(['check', '--engine', 'podman'], io)).toBe(2);
  });

  it('runs veraPDF in the image when it is not installed', async () => {
    const log = join(tempDir(), 'args');
    const bin = fakeBin({ docker: `echo "$@" >> ${log}\necho '{}'` });
    process.env.PATH = `${bin}:${savedPath}`;
    await runVeraPdf(
      '/proj/out/x.pdf',
      { PATH: bin },
      { docker: { image: 'overfull:dev', root: '/proj' } },
    );
    const args = readFileSync(log, 'utf8');
    expect(args).toContain(
      '--entrypoint verapdf overfull:dev --flavour ua2 --format json ./out/x.pdf',
    );
    expect(args).toContain('--network none');
    expect(args).toContain('--mount type=bind,source=/proj,target=/work,readonly');
  });
});

describe('cite (C5, H1, H2)', () => {
  it('keeps CRLF line endings and records provenance', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'references.bib'), '@misc{a,\r\n  title = {A}\r\n}\r\n');
    const io = memIo(dir);
    const code = await citeCommand(['10.1093/comjnl/27.2.97'], io, async () => ({
      entry: {
        key: 'knuth1984literate',
        type: 'article',
        line: 1,
        raw: '',
        fields: {
          title: 'Literate Programming',
          author: 'Knuth, Donald E.',
          year: '1984',
          doi: '10.1093/COMJNL/27.2.97',
        },
      },
      source: 'doi.org',
      confidence: 1,
    }));
    expect(code).toBe(0);
    const text = readFileSync(join(dir, 'references.bib'), 'utf8');
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
    expect(text).toMatch(/x-overfull\s*=\s*\{cite doi\.org \d{4}-\d{2}-\d{2} [0-9a-f]{12}\}/);
  });

  it('reports unreachable sources as a normal failure, in JSON too', async () => {
    const dir = tempDir();
    const io = memIo(dir);
    const code = await main(['cite', '10.1093/comjnl/27.2.97', '--json'], io);
    expect(code).toBe(1);
    expect(io.stderrText()).not.toContain('internal error');
    const out = JSON.parse(io.stdoutText()) as {
      found: boolean;
      searched: string[];
      failures: { source: string; reason: string }[];
      message: string;
    };
    expect(out.found).toBe(false);
    expect(out.searched).toEqual([]);
    expect(out.failures.length).toBeGreaterThan(0);
    expect(out.message).toContain('Could not reach');
    const human = memIo(dir);
    expect(await main(['cite', '10.1093/comjnl/27.2.97'], human)).toBe(1);
    expect(human.stderrText()).toContain('Could not reach');
    expect(human.stderrText()).not.toContain('internal error');
  });

  it('says which sources were searched when nothing matched', async () => {
    const dir = tempDir();
    const io = memIo(dir);
    io.fetch = (async () => new Response('', { status: 404 })) as typeof fetch;
    expect(await main(['cite', '10.9999/nothing', '--json'], io)).toBe(1);
    const out = JSON.parse(io.stdoutText()) as { searched: string[]; message: string };
    expect(out.searched).toContain('doi.org');
    expect(out.message).toContain('in doi.org');
  });
});

describe('H6: init runs git init', () => {
  it('initializes a repository on main outside an existing repo', async () => {
    const parent = tempDir();
    const io = memIo(parent, {
      PATH: process.env.PATH,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
    });
    expect(await main(['init', 'paper', 'p'], io)).toBe(0);
    expect(existsSync(join(parent, 'p', '.git'))).toBe(true);
    expect(git(join(parent, 'p'), 'symbolic-ref', '--short', 'HEAD')).toBe('main');
    expect(io.stdoutText()).toContain('git add -A && git commit');
  });

  it('does not nest a repository inside another', async () => {
    const parent = tempDir();
    git(parent, 'init', '-q');
    const io = memIo(parent, { PATH: process.env.PATH });
    expect(await main(['init', 'paper', 'p'], io)).toBe(0);
    expect(existsSync(join(parent, 'p', '.git'))).toBe(false);
  });
});

describe('report JSON keeps its shape', () => {
  it('check --json still works with the new options', async () => {
    const io = memIo(tempCopy('project'));
    await main(['check', '--offline', '--no-verapdf', '--json'], io);
    const report = JSON.parse(io.stdoutText()) as Report;
    expect(report.target).toBe('thesis.pdf');
  });
});
