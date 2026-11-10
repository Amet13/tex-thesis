import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/main.js';
import { memIo, tempCopy } from './helpers.js';

/** Every file under dir with a hash (symlinks as their target), for before/after comparison. */
function snapshot(dir: string, base = dir): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    const rel = p.slice(base.length + 1);
    if (e.isSymbolicLink()) out[rel] = `link:${readlinkSync(p)}`;
    else if (e.isDirectory()) Object.assign(out, snapshot(p, base));
    else out[rel] = createHash('sha256').update(readFileSync(p)).digest('hex');
  }
  return out;
}

const texAndBib = (s: Record<string, string>) =>
  Object.fromEntries(Object.entries(s).filter(([k]) => /\.(tex|bib)$/.test(k)));

const FIXTURES = ['neurips-style', 'acm-biblatex', 'thesis'];

describe.each(FIXTURES)('init --here on the %s project', (name) => {
  it('writes the files, leaves .tex and .bib alone, and checks without a usage error', async () => {
    const dir = tempCopy(`adopt/${name}`);
    const before = snapshot(dir);
    const io = memIo(dir);
    expect(await main(['init', '--here', '--all'], io), io.stderrText()).toBe(0);
    const after = snapshot(dir);
    expect(texAndBib(after)).toEqual(texAndBib(before));
    for (const f of [
      'overfull.yml',
      'AGENTS.md',
      'CLAUDE.md',
      'GEMINI.md',
      '.github/copilot-instructions.md',
      '.cursor/rules/overfull.mdc',
      '.github/workflows/overfull.yml',
      'Makefile',
    ])
      expect(existsSync(join(dir, f)), f).toBe(true);
    expect(existsSync(join(dir, '.agents/skills/add-citation/SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, '.claude/skills/add-citation/SKILL.md'))).toBe(true);
    for (const f of ['overfull.yml', '.github/workflows/overfull.yml', 'Makefile'])
      expect(io.stdoutText()).toContain(f);

    const check = memIo(dir);
    const code = await main(['check', '--offline'], check);
    expect(code, check.stderrText()).not.toBe(2);
    expect([0, 1]).toContain(code);
  });

  it('a second run changes nothing and says so', async () => {
    const dir = tempCopy(`adopt/${name}`);
    expect(await main(['init', '--here', '--all'], memIo(dir))).toBe(0);
    const first = snapshot(dir);
    const io = memIo(dir);
    expect(await main(['init', '--here', '--all'], io)).toBe(0);
    expect(snapshot(dir)).toEqual(first);
    expect(io.stdoutText()).toContain('Nothing was written');
    const json = memIo(dir);
    await main(['init', '--here', '--all', '--json'], json);
    expect(JSON.parse(json.stdoutText()).written).toEqual([]);
  });

  it('--dry-run writes nothing and lists what it would write', async () => {
    const dir = tempCopy(`adopt/${name}`);
    const before = snapshot(dir);
    const io = memIo(dir);
    expect(await main(['adopt', '--all', '--dry-run'], io)).toBe(0);
    expect(snapshot(dir)).toEqual(before);
    expect(io.stdoutText()).toContain('Would write:');
    expect(io.stdoutText()).toContain('overfull.yml');
    const json = memIo(dir);
    await main(['init', '--here', '--all', '--dry-run', '--json'], json);
    const out = JSON.parse(json.stdoutText());
    expect(out.dryRun).toBe(true);
    expect(out.detected.main).toBeTruthy();
    expect(out.written.map((w: { path: string }) => w.path)).toContain('overfull.yml');
  });

  it('does not overwrite an existing file without --force', async () => {
    const dir = tempCopy(`adopt/${name}`);
    writeFileSync(join(dir, 'overfull.yml'), '# mine\nmain: x.tex\n');
    writeFileSync(join(dir, 'AGENTS.md'), 'my rules\n');
    const io = memIo(dir);
    expect(await main(['init', '--here', '--agents'], io)).toBe(0);
    expect(readFileSync(join(dir, 'overfull.yml'), 'utf8')).toBe('# mine\nmain: x.tex\n');
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe('my rules\n');
    expect(io.stdoutText()).toMatch(/overfull\.yml {2}\(exists; use --force/);
    const forced = memIo(dir);
    expect(await main(['init', '--here', '--agents', '--force'], forced)).toBe(0);
    expect(readFileSync(join(dir, 'overfull.yml'), 'utf8')).toContain('written by');
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toContain('Layout');
  });
});

describe('init --here: Makefile and flags', () => {
  it('leaves an existing Makefile alone, even with --force, and prints the lines to add', async () => {
    const dir = tempCopy('adopt/neurips-style');
    writeFileSync(join(dir, 'Makefile'), 'all:\n\techo hi\n');
    const io = memIo(dir);
    expect(await main(['init', '--here', '--make', '--force'], io)).toBe(0);
    expect(readFileSync(join(dir, 'Makefile'), 'utf8')).toBe('all:\n\techo hi\n');
    expect(io.stdoutText()).toContain('Your Makefile was not changed');
    expect(io.stdoutText()).toContain('overfull check');
  });

  it('writes a .latexmkrc for a pdfLaTeX project so `overfull build` keeps the engine', async () => {
    const dir = tempCopy('adopt/neurips-style');
    expect(await main(['init', '--here'], memIo(dir))).toBe(0);
    expect(readFileSync(join(dir, '.latexmkrc'), 'utf8')).toContain('$pdf_mode = 1');
    const lua = tempCopy('adopt/thesis');
    const before = readFileSync(join(lua, '.latexmkrc'), 'utf8');
    await main(['init', '--here'], memIo(lua));
    expect(readFileSync(join(lua, '.latexmkrc'), 'utf8')).toBe(before);
  });

  it('only overfull.yml without flags; --json has detected, written and skipped', async () => {
    const dir = tempCopy('adopt/acm-biblatex');
    const io = memIo(dir);
    expect(await main(['init', '--here', '--json'], io)).toBe(0);
    const out = JSON.parse(io.stdoutText());
    expect(Object.keys(out)).toEqual(expect.arrayContaining(['detected', 'written', 'skipped']));
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(dir, 'Makefile'))).toBe(false);
  });

  it('rejects here-only flags without --here and positionals with it', async () => {
    const dir = tempCopy('adopt/neurips-style');
    const a = memIo(dir);
    expect(await main(['init', 'paper', 'x', '--agents'], a)).toBe(2);
    expect(a.stderrText()).toContain('--here');
    const b = memIo(dir);
    expect(await main(['init', '--here', 'paper'], b)).toBe(2);
  });

  it('the top-level help lists adopt', async () => {
    const io = memIo(tempCopy('adopt/neurips-style'));
    await main(['--help'], io);
    expect(io.stdoutText()).toMatch(/^ {2}adopt /m);
  });
});
