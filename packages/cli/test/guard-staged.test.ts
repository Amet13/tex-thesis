/** `overfull guard --staged` in real temporary git repositories (no network). */
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { formatBibEntry, markCited, parseBib } from '@overfull/core';
import { describe, expect, it } from 'vitest';
import { adoptCommand } from '../src/commands/init.js';
import { main } from '../src/main.js';
import { memIo, tempDir } from './helpers.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function repoWith(files: Record<string, string> = {}, commit = false): string {
  const dir = tempDir();
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.org');
  git(dir, 'config', 'user.name', 'T');
  git(dir, 'config', 'commit.gpgsign', 'false');
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
  if (Object.keys(files).length) git(dir, 'add', '-A');
  if (commit) git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

async function guard(dir: string, ...args: string[]) {
  const io = memIo(dir);
  const code = await main(['guard', '--staged', ...args], io);
  return { code, out: io.stdoutText(), err: io.stderrText() };
}

const invented = `@article{zyx2023zorbulating,
  title = {Zorbulating hyperflux capacitors in tandem orchards},
  author = {Zyx, Quorbl},
  journal = {Journal of Nothing},
  year = {2023},
  doi = {10.1234/zz}
}
`;
const [parsed] = parseBib(invented);
const cited = formatBibEntry(
  markCited(parsed as NonNullable<typeof parsed>, 'doi.org', '2026-11-10'),
);

describe('guard --staged', () => {
  it('refuses a commit that adds a fabricated entry, with the cite command (first commit, no HEAD)', async () => {
    const dir = repoWith({ 'refs.bib': invented });
    const r = await guard(dir, '--offline');
    expect(r.code).toBe(1);
    expect(r.err).toContain('refs.bib:1');
    expect(r.err).toContain('zyx2023zorbulating');
    expect(r.err).toContain('overfull cite "Zorbulating hyperflux capacitors in tandem orchards"');
    expect(r.err).toContain('note = {overfull: author-provided}');
  });

  it('with the lookup on and the indexes unreachable, it still refuses', async () => {
    const dir = repoWith({ 'refs.bib': invented });
    const r = await guard(dir);
    expect(r.code).toBe(1);
    expect(r.err).toContain('could not be asked');
  });

  it('passes an entry that carries cite provenance', async () => {
    const dir = repoWith({ 'refs.bib': cited });
    const r = await guard(dir, '--offline', '--json');
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.status).toBe('pass');
    expect(j.passed).toEqual([
      { file: 'refs.bib', key: 'zyx2023zorbulating', line: 1, via: 'provenance' },
    ]);
  });

  it('refuses when a cited entry was edited afterwards (hash no longer matches)', async () => {
    const dir = repoWith({ 'refs.bib': cited }, true);
    writeFileSync(join(dir, 'refs.bib'), cited.replace(/year(\s*=\s*)\{2023\}/, 'year$1{2019}'));
    git(dir, 'add', 'refs.bib');
    const r = await guard(dir, '--offline', '--json');
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out).blocked[0].key).toBe('zyx2023zorbulating');
  });

  it('passes author-provided and skip notes', async () => {
    const a = invented.replace(
      'year = {2023}',
      'year = {2023},\n  note = {overfull: author-provided}',
    );
    const b = a.replace('zyx2023zorbulating', 'second').replace('author-provided', 'skip');
    const dir = repoWith({ 'refs.bib': a + b });
    const j = JSON.parse((await guard(dir, '--offline', '--json')).out);
    expect(j.status).toBe('pass');
    expect(j.passed.map((p: { via: string }) => p.via)).toEqual(['author-provided', 'skip']);
  });

  it('passes an entry that verifies against the indexes', async () => {
    const dir = repoWith({ 'refs.bib': invented });
    const io = memIo(dir);
    io.fetch = (async (input: RequestInfo | URL) => {
      if (new URL(String(input)).host === 'doi.org')
        return Response.json({
          title: 'Zorbulating hyperflux capacitors in tandem orchards',
          author: [{ given: 'Quorbl', family: 'Zyx' }],
          issued: { 'date-parts': [[2023]] },
          'container-title': 'Journal of Nothing',
          type: 'article-journal',
        });
      return new Response('', { status: 404 });
    }) as typeof fetch;
    expect(await main(['guard', '--staged', '--json'], io)).toBe(0);
    expect(JSON.parse(io.stdoutText()).passed[0].via).toBe('verified');
  });

  it('passes removed entries, whitespace and reordering, and unrelated files', async () => {
    const dir = repoWith(
      { 'refs.bib': cited + invented.replace('zyx2023', 'old2023'), 'a.tex': 'x' },
      true,
    );
    // Remove one entry; reflow and reorder the fields of the other; touch a .tex file.
    const [kept] = parseBib(cited);
    const fields = Object.entries((kept as NonNullable<typeof kept>).fields).reverse();
    const reordered = `@article{zyx2023zorbulating,\n${fields.map(([k, v]) => `    ${k}   =   {${v}}`).join(',\n')}\n}\n`;
    writeFileSync(join(dir, 'refs.bib'), reordered);
    writeFileSync(join(dir, 'a.tex'), 'y');
    git(dir, 'add', '-A');
    const r = await guard(dir, '--offline', '--json');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).checked).toBe(0);
  });

  it('checks only the new entry when one is added next to existing ones', async () => {
    const dir = repoWith({ 'refs.bib': cited }, true);
    writeFileSync(join(dir, 'refs.bib'), `${cited}\n${invented.replace('zyx2023', 'new2023')}`);
    git(dir, 'add', 'refs.bib');
    const j = JSON.parse((await guard(dir, '--offline', '--json')).out);
    expect(j.status).toBe('blocked');
    expect(j.checked).toBe(1);
    expect(j.blocked.map((b: { key: string }) => b.key)).toEqual(['new2023zorbulating']);
  });

  it('an entry moved to another .bib file is not new', async () => {
    const dir = repoWith({ 'a.bib': invented, 'b.bib': '' }, true);
    writeFileSync(join(dir, 'a.bib'), '');
    writeFileSync(join(dir, 'b.bib'), invented);
    git(dir, 'add', '-A');
    // Only changed files are compared: a.bib at HEAD holds the entry, so the move passes.
    expect((await guard(dir, '--offline')).code).toBe(0);
  });

  it('a renamed .bib file keeps its entries', async () => {
    const dir = repoWith({ 'a.bib': invented }, true);
    git(dir, 'mv', 'a.bib', 'b.bib');
    expect((await guard(dir, '--offline')).code).toBe(0);
  });

  it('exits 2 outside a git repository', async () => {
    const io = memIo(tempDir());
    expect(await main(['guard', '--staged', '--json'], io)).toBe(2);
    expect(JSON.parse(io.stdoutText()).error.code).toBe('internal');
  });

  it('does not put shell syntax from a title into the suggested command', async () => {
    const evil = invented.replace('Zorbulating', 'Zorbulating $(touch pwned) `id` \\');
    const dir = repoWith({ 'refs.bib': evil });
    const j = JSON.parse((await guard(dir, '--offline', '--json')).out);
    expect(j.blocked[0].cite).not.toMatch(/[`$\\]/);
  });
});

describe('init --here --hooks and --agents', () => {
  const tex = '\\documentclass{article}\\begin{document}x\\end{document}\n';

  it('installs an executable pre-commit hook', async () => {
    const dir = repoWith({ 'main.tex': tex });
    expect(await adoptCommand(['--hooks'], memIo(dir))).toBe(0);
    const fd = openSync(join(dir, '.git/hooks/pre-commit'), 'r');
    try {
      expect(readFileSync(fd, 'utf8')).toContain('overfull guard --staged');
      // Windows has no execute bits; git for Windows runs hooks regardless.
      if (process.platform !== 'win32') expect(fstatSync(fd).mode & 0o111).not.toBe(0);
    } finally {
      closeSync(fd);
    }
  });

  it('installs a pre-commit hook only when none exists, and never overwrites', async () => {
    const dir = repoWith({ 'main.tex': tex });
    const io = memIo(dir);
    expect(await adoptCommand(['--hooks'], io)).toBe(0);
    const hook = join(dir, '.git/hooks/pre-commit');
    expect(readFileSync(hook, 'utf8')).toContain('overfull guard --staged');
    writeFileSync(hook, '#!/bin/sh\necho mine\n');
    chmodSync(hook, 0o755);
    const again = memIo(dir);
    expect(await adoptCommand(['--hooks', '--force'], again)).toBe(0);
    expect(readFileSync(hook, 'utf8')).toContain('echo mine');
    expect(again.stdoutText()).toContain('overfull guard --staged || exit 1');
  });

  it('outside a git repository --hooks writes nothing and says so', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'main.tex'), tex);
    const io = memIo(dir);
    expect(await adoptCommand(['--hooks'], io)).toBe(0);
    expect(io.stdoutText()).toContain('No git repository');
  });

  it('--agents writes both hook settings; an existing settings file is merged, not replaced', async () => {
    const dir = repoWith({ 'main.tex': tex });
    const settings = join(dir, '.claude/settings.json');
    execFileSync('mkdir', ['-p', join(dir, '.claude')]);
    writeFileSync(settings, JSON.stringify({ model: 'opus', hooks: { Stop: [] } }));
    const io = memIo(dir);
    expect(await adoptCommand(['--agents'], io)).toBe(0);
    const merged = JSON.parse(readFileSync(settings, 'utf8'));
    expect(merged.model).toBe('opus');
    expect(merged.hooks.Stop).toEqual([]);
    expect(merged.hooks.PreToolUse[0].hooks[0].command).toContain('overfull guard --hook claude');
    expect(existsSync(join(dir, '.gemini/settings.json'))).toBe(true);
    // Second run changes nothing.
    const before = readFileSync(settings, 'utf8');
    await adoptCommand(['--agents'], memIo(dir));
    expect(readFileSync(settings, 'utf8')).toBe(before);
  });

  it('a settings file that is not JSON is left alone', async () => {
    const dir = repoWith({ 'main.tex': tex });
    execFileSync('mkdir', ['-p', join(dir, '.claude')]);
    writeFileSync(join(dir, '.claude/settings.json'), '{ not json');
    const io = memIo(dir);
    expect(await adoptCommand(['--agents'], io)).toBe(0);
    expect(readFileSync(join(dir, '.claude/settings.json'), 'utf8')).toBe('{ not json');
    expect(io.stdoutText()).toContain('not valid JSON');
  });
});
