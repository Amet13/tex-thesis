/** Regression tests for the lead's follow-up list (A1–A13), CLI side. */
import { chmodSync, cpSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatBibEntry, markCited, parseBib, type Report } from '@overfull/core';
import { afterEach, describe, expect, it } from 'vitest';
import { runCheck } from '../src/check.js';
import { upToDate } from '../src/commands/build.js';
import { citeCommand } from '../src/commands/cite.js';
import { loadConfig } from '../src/config.js';
import { main } from '../src/main.js';
import { memIo, tempCopy, tempDir } from './helpers.js';

const savedPath = process.env.PATH;
afterEach(() => {
  process.env.PATH = savedPath;
});

function fakeBin(scripts: Record<string, string>): string {
  const dir = tempDir();
  for (const [name, body] of Object.entries(scripts)) {
    const p = join(dir, name);
    writeFileSync(p, `#!/bin/sh\n${body}\n`);
    chmodSync(p, 0o755);
  }
  return dir;
}

const problems = (r: Report) => r.checks.flatMap((c) => c.problems);

describe('A1: provenance is tamper-evident and offline is not a pass', () => {
  function project(bib: string): string {
    const dir = tempDir();
    writeFileSync(join(dir, 'overfull.yml'), 'bib: [refs.bib]\nreferences:\n  requireCite: true\n');
    writeFileSync(join(dir, 'refs.bib'), bib);
    return dir;
  }
  const paper = `@article{p, title = {Zorbulating hyperflux capacitors in tandem orchards},
  author = {Zyx, Quorbl}, journal = {J}, year = {2023}, doi = {10.1234/zz}}`;

  it('offline + requireCite: a hand-written entry is an error (exit 1)', async () => {
    const io = memIo(project(paper));
    expect(await main(['check', '--offline', '--checks', 'references', '--json'], io)).toBe(1);
    const report = JSON.parse(io.stdoutText()) as Report;
    expect(problems(report).map((p) => p.rule)).toContain('reference-unproven');
  });

  it('offline + requireCite: an intact cite marker is a warning, not an error', async () => {
    const [e] = parseBib(paper);
    const cited = formatBibEntry(markCited(e as NonNullable<typeof e>, 'doi.org', '2026-11-09'));
    const io = memIo(project(cited));
    expect(await main(['check', '--offline', '--checks', 'references', '--json'], io)).toBe(0);
    const rules = problems(JSON.parse(io.stdoutText()) as Report).map((p) => [p.rule, p.severity]);
    expect(rules).toEqual([['reference-not-reverified', 'warning']]);
  });

  it('an edited entry (title changed after cite) loses its provenance', async () => {
    const [e] = parseBib(paper);
    const cited = formatBibEntry(markCited(e as NonNullable<typeof e>, 'doi.org', '2026-11-09'));
    const io = memIo(project(cited.replace('tandem orchards', 'tandem vineyards')));
    expect(await main(['check', '--offline', '--checks', 'references', '--json'], io)).toBe(1);
    expect(problems(JSON.parse(io.stdoutText()) as Report).map((p) => p.rule)).toContain(
      'reference-unproven',
    );
  });

  it('a hand-typed marker without the hash is not provenance; author-provided is info', async () => {
    const io = memIo(
      project(
        `${paper.replace('doi = {10.1234/zz}', 'doi = {10.1234/zz}, x-overfull = {cite doi.org 2026-11-09}')}
@book{b, title = {A book the author owns}, author = {Doe, J.}, year = {1999},
  note = {overfull: author-provided}}`,
      ),
    );
    await main(['check', '--offline', '--checks', 'references', '--json'], io);
    const ps = problems(JSON.parse(io.stdoutText()) as Report);
    expect(ps.filter((p) => p.rule === 'reference-unproven').map((p) => p.data?.key)).toEqual([
      'p',
    ]);
  });

  it('cite writes a marker whose hash matches the written entry', async () => {
    const dir = tempDir();
    await citeCommand(['10.1/x'], memIo(dir), async () => ({
      entry: {
        key: 'doe2020t',
        type: 'article',
        line: 0,
        raw: '',
        fields: { title: 'T', author: 'Doe, J.', year: '2020', doi: '10.1/x' },
      },
      source: 'doi.org',
      confidence: 1,
    }));
    const io = memIo(dir);
    writeFileSync(
      join(dir, 'overfull.yml'),
      'bib: [references.bib]\nreferences:\n  requireCite: true\n',
    );
    expect(await main(['check', '--offline', '--checks', 'references', '--json'], io)).toBe(0);
  });
});

describe('A3: errors from typeset bibliography entries point at the .bib entry', () => {
  for (const [name, engine] of [
    ['bbl-a', 'biblatex (reported at main.tex)'],
    ['bbl-b', 'BibTeX (reported at main.bbl)'],
  ] as const) {
    it(engine, async () => {
      const dir = tempDir();
      cpSync(new URL(`./fixtures/${name}`, import.meta.url), dir, { recursive: true });
      const report = await runCheck({
        cwd: dir,
        checks: ['build'],
        offline: true,
        env: { PATH: process.env.PATH },
      });
      const tab = problems(report).find((p) => p.rule === 'misplaced-alignment-tab');
      expect(tab?.data?.bibKey).toBe('bad');
      expect(tab?.message).toContain('in the bibliography entry `bad`');
      expect(tab?.location).toEqual({ file: 'references.bib', line: 8 });
    });
  }
});

describe('A4 + A9 + A10: sources feed accessibility and citation locations; order', () => {
  it('figure-missing-alt comes from the source with file:line; citation-key-missing has a line', async () => {
    const report = await runCheck({
      cwd: tempCopy('project'),
      offline: true,
      verapdf: false,
      env: { PATH: process.env.PATH },
    });
    const alt = problems(report).find((p) => p.rule === 'figure-missing-alt');
    expect(alt?.location).toEqual({ file: 'main.tex', line: 16 });
    expect(alt?.severity).toBe('error'); // thesis profile: accessibility required
    const missing = problems(report).find((p) => p.rule === 'citation-key-missing');
    expect(missing?.location).toMatchObject({ file: 'main.tex', line: 13 });
  });

  it('problems in each check are sorted errors → warnings → info, then by file and line', async () => {
    const report = await runCheck({
      cwd: tempCopy('project'),
      offline: true,
      verapdf: false,
      env: { PATH: process.env.PATH },
    });
    const order = { error: 0, warning: 1, info: 2 };
    for (const c of report.checks) {
      const keys = c.problems.map(
        (p) => [order[p.severity], p.location?.file ?? '￿', p.location?.line ?? 0] as const,
      );
      const sorted = [...keys].sort(
        (a, b) => a[0] - b[0] || a[1].localeCompare(b[1]) || a[2] - b[2],
      );
      expect(keys, c.check).toEqual(sorted);
    }
  });

  it('the paper profile requires accessibility', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'overfull.yml'), 'profile: paper\n');
    expect(loadConfig(dir).profile.accessibility).toBe('required');
  });
});

describe('A8: --json on every command', () => {
  it('usage errors are JSON with exit 2', async () => {
    for (const args of [
      ['build', '--json', 'nope.tex'],
      ['pages', '--json'],
      ['diff', '--json'],
      ['explain', '--json', 'no-such-rule'],
      ['check', '--json', '--fail-on', 'sometimes'],
      ['init', '--json', 'nosuchtemplate', 'x'],
    ]) {
      const io = memIo(tempDir());
      expect(await main(args, io), args.join(' ')).toBe(2);
      const out = JSON.parse(io.stdoutText()) as { error: { code: string; message: string } };
      expect(out.error.code, args.join(' ')).toBe('usage');
      expect(out.error.message.length).toBeGreaterThan(0);
    }
  });

  it('init and explain print JSON results', async () => {
    const io = memIo(tempDir());
    expect(await main(['init', 'paper', 'p', '--no-git', '--json'], io)).toBe(0);
    expect(JSON.parse(io.stdoutText())).toEqual({ template: 'paper', dir: 'p', git: null });
    const ex = memIo(tempDir());
    await main(['explain', 'overfull-box', '--json'], ex);
    expect((JSON.parse(ex.stdoutText()) as { id: string }).id).toBe('overfull-box');
  });

  it('build --json prints the report (from an up-to-date build)', async () => {
    const dir = upToDateProject();
    const io = memIo(dir, { PATH: '/nonexistent' });
    expect(await main(['build', '--json'], io)).toBe(0);
    const report = JSON.parse(io.stdoutText()) as Report;
    expect(report.tool).toBe('overfull');
    expect(report.checks.map((c) => c.check)).toEqual(['build', 'output']);
  });
});

/** The fixture project with a recorder file, its PDF newer than every source. */
function upToDateProject(): string {
  const dir = tempCopy('project');
  writeFileSync(
    join(dir, 'thesis.fls'),
    `PWD ${dir}\nINPUT /usr/share/texmf/tex/latex/base/article.cls\nINPUT ./main.tex\nINPUT ${dir}/thesis.aux\nOUTPUT thesis.pdf\n`,
  );
  const past = new Date(Date.now() - 60_000);
  for (const f of ['main.tex', 'references.bib', 'overfull.yml', 'thesis.aux'])
    utimesSync(join(dir, f), past, past);
  // The fixture log has errors; an up-to-date build needs a clean last run.
  const log = readFileSync(join(dir, 'thesis.log'), 'utf8')
    .split('\n')
    .filter((l) => !/^! |^\S+:\d+: /.test(l))
    .join('\n');
  writeFileSync(join(dir, 'thesis.log'), log);
  const now = new Date();
  utimesSync(join(dir, 'thesis.pdf'), now, now);
  return dir;
}

describe('A12: a no-change build does not run LaTeX', () => {
  it('skips latexmk when the PDF is newer than every input', async () => {
    const dir = upToDateProject();
    expect(upToDate(loadConfig(dir), 'main.tex')).toBe(true);
    const log = join(tempDir(), 'calls');
    const bin = fakeBin({ latexmk: `echo "$@" >> ${log}\nexit 0` });
    process.env.PATH = `${bin}:${savedPath}`;
    const io = memIo(dir, { PATH: process.env.PATH });
    await main(['build', '--engine', 'local'], io);
    expect(io.stderrText()).toContain('up to date');
    expect(() => readFileSync(log, 'utf8')).toThrow();
    // --force runs latexmk with -g
    await main(['build', '--engine', 'local', '--force'], memIo(dir, { PATH: process.env.PATH }));
    expect(readFileSync(log, 'utf8')).toMatch(/^-g /);
  });

  it('a source edited after the PDF means not up to date', () => {
    const dir = upToDateProject();
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(dir, 'main.tex'), later, later);
    expect(upToDate(loadConfig(dir), 'main.tex')).toBe(false);
    const dir2 = upToDateProject();
    utimesSync(join(dir2, 'references.bib'), later, later);
    expect(upToDate(loadConfig(dir2), 'main.tex')).toBe(false);
  });
});

describe('A13: doctor exit code and veraPDF advice', () => {
  it('doctor exits 1 and says so first when nothing can build', async () => {
    const bin = fakeBin({
      docker: `case "$1" in info) echo 27.0; exit 0;; image) exit 1;; manifest) echo "manifest unknown" >&2; exit 1;; esac\nexit 1`,
    });
    process.env.PATH = `${bin}:/usr/bin:/bin`;
    const io = memIo(tempDir(), { PATH: process.env.PATH });
    expect(await main(['doctor'], io)).toBe(1);
    expect(io.stdoutText()).toMatch(/^Cannot build/);
  });

  it('check: veraPDF not run is a warning when accessibility is required', async () => {
    const report = await runCheck({
      cwd: tempCopy('project'),
      checks: ['accessibility'],
      engine: 'local',
      env: { PATH: '/nonexistent' },
    });
    const v = problems(report).find((p) => p.rule === 'verapdf-not-run');
    expect(v?.severity).toBe('warning');
  });
});

describe('A5: cite --json reports what core says answered', () => {
  it('a dblp bot wall (HTTP 202) is listed under failures, not searched', async () => {
    const dir = tempDir();
    const io = memIo(dir);
    io.fetch = (async (input: string | URL | Request) => {
      const u = new URL(String(input instanceof Request ? input.url : input));
      if (u.host === 'dblp.org')
        return new Response('<html>Making sure you are not a bot</html>', { status: 202 });
      if (u.host === 'api.crossref.org')
        return new Response('{"message":{"items":[]}}', {
          headers: { 'content-type': 'application/json' },
        });
      if (u.host === 'export.arxiv.org')
        return new Response('<feed xmlns="http://www.w3.org/2005/Atom"></feed>', {
          headers: { 'content-type': 'application/atom+xml' },
        });
      return new Response('', { status: 404 });
    }) as typeof fetch;
    expect(await main(['cite', 'A long title that nobody ever wrote down', '--json'], io)).toBe(1);
    const out = JSON.parse(io.stdoutText()) as {
      searched: string[];
      failures: { source: string }[];
    };
    expect(out.searched).not.toContain('dblp');
    expect(out.failures.map((f) => f.source)).toContain('dblp');
  });
});
