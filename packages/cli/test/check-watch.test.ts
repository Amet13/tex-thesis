import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { changes, watchedState } from '../src/commands/check.js';
import { main } from '../src/main.js';
import { memIo, tempDir } from './helpers.js';

const bib = '@article{a, title={A Title Long Enough To Search}, author={Doe, J.}, year={2020}}\n';

describe('check --watch', () => {
  it('watches log, PDF, aux and bib files, and says when a .bib changed', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'main.log'), 'x');
    writeFileSync(join(dir, 'sub', 'refs.bib'), bib);
    writeFileSync(join(dir, 'main.tex'), 'ignored');
    const a = watchedState(dir);
    expect(
      [...a.keys()]
        .map((k) =>
          k
            .slice(dir.length + 1)
            .split('\\')
            .join('/'),
        )
        .sort(),
    ).toEqual(['main.log', 'sub/refs.bib']);
    const later = new Date(Date.now() + 5000);
    utimesSync(join(dir, 'main.log'), later, later);
    expect(changes(a, watchedState(dir))).toEqual({ any: true, bib: false });
    utimesSync(join(dir, 'sub', 'refs.bib'), later, later);
    expect(changes(a, watchedState(dir))).toEqual({ any: true, bib: true });
    expect(changes(a, a)).toEqual({ any: false, bib: false });
  });

  it('runs once, again after a change, and stops on the signal', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'refs.bib'), bib);
    const io = memIo(dir);
    io.env = { ...io.env, OVERFULL_WATCH_INTERVAL_MS: '20' };
    const stop = new AbortController();
    io.signal = stop.signal;
    const run = main(['check', 'refs.bib', '--offline', '--watch'], io);
    await new Promise((r) => setTimeout(r, 150));
    const later = new Date(Date.now() + 5000);
    utimesSync(join(dir, 'refs.bib'), later, later);
    await new Promise((r) => setTimeout(r, 200));
    stop.abort();
    const code = await run;
    expect([0, 1]).toContain(code);
    expect(io.stdoutText().split('overfull ').length - 1).toBeGreaterThanOrEqual(2);
    expect(io.stderrText()).toContain('Watching');
  });

  it('refuses machine formats', async () => {
    const io = memIo(tempDir());
    expect(await main(['check', '--watch', '--json'], io)).toBe(2);
  });
});
