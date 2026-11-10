/** Provenance is tamper-evident; cite --json reports what core says answered. */
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatBibEntry, markCited, parseBib, type Report } from '@overfull/core';
import { afterEach, describe, expect, it } from 'vitest';
import { citeCommand } from '../src/commands/cite.js';
import { main } from '../src/main.js';
import { memIo, tempDir } from './helpers.js';

/** Shell-script fakes on PATH and FIFOs do not exist on Windows; these tests run on Linux and macOS. */
const _POSIX_ONLY = process.platform === 'win32';

const savedPath = process.env.PATH;
afterEach(() => {
  process.env.PATH = savedPath;
});

function _fakeBin(scripts: Record<string, string>): string {
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
