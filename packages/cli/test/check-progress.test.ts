/** A5: a progress line on an interactive stderr, and nowhere else. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { progressLine } from '../src/io.js';
import { main } from '../src/main.js';
import { memIo, tempDir } from './helpers.js';

const BIB = `@article{a, author = {Doe, Jane}, title = {Alpha}, journal = {J}, year = {2020}, doi = {10.1/a}}
@article{b, author = {Doe, Jane}, title = {Beta}, journal = {J}, year = {2021}, doi = {10.1/b}}
`;

const quietFetch = (async (input: RequestInfo | URL) => {
  const u = new URL(String(input));
  if (u.host === 'doi.org')
    return Response.json({
      title: 'Alpha',
      author: [{ given: 'Jane', family: 'Doe' }],
      issued: { 'date-parts': [[2020]] },
    });
  return new Response('', { status: 404 });
}) as typeof fetch;

function project() {
  const dir = tempDir();
  writeFileSync(join(dir, 'refs.bib'), BIB);
  return dir;
}

async function run(args: string[], tty: boolean, env: Record<string, string> = {}) {
  const dir = project();
  const io = memIo(dir, { XDG_CACHE_HOME: tempDir(), HOME: tempDir(), ...env });
  io.stderrIsTTY = tty;
  io.fetch = quietFetch;
  await main(['check', 'refs.bib', ...args], io);
  return io.stderrText();
}

describe('progress line', () => {
  it('writes `references done/total` and clears the line on a TTY', async () => {
    const err = await run([], true);
    expect(err).toContain('\rreferences 1/2');
    expect(err).toContain('\r\u001b[K');
  });

  it('is silent when stderr is not a terminal', async () => {
    expect(await run([], false)).not.toContain('references ');
  });

  it('is silent for every machine format', async () => {
    const flags = ['--json', '--markdown', '--annotations', '--sarif'];
    const errs = await Promise.all(flags.map((f) => run([f], true)));
    for (const err of errs) expect(err).not.toContain('references ');
  });

  it('is silent in CI', async () => {
    expect(await run([], true, { GITHUB_ACTIONS: 'true' })).not.toContain('references ');
  });

  it('progressLine returns nothing without a TTY', () => {
    expect(progressLine(memIo(tempDir()), 'references')).toBeUndefined();
  });
});
