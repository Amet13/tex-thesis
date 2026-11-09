/**
 * Crafted ~1 MB inputs that made regexes or scans quadratic. Each must finish well
 * under 300 ms; before the fixes several took seconds.
 */
import { describe, expect, it } from 'vitest';
import { hasOthers, parseBib, parseNames } from '../src/bib/index.js';
import { analyzeLog, parseLog } from '../src/log/index.js';
import { findCommands, grepTex } from '../src/venue/tex.js';

const MB = 1_000_000;
const LIMIT_MS = 300;

function timed(fn: () => unknown): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

function fill(unit: string, size = MB): string {
  return unit.repeat(Math.ceil(size / unit.length));
}

describe('1 MB crafted logs stay linear', () => {
  const logs: Record<string, string> = {
    'font shape continuation': `LaTeX Font Warning: Font shape \`x\n${fill("(Font)              ' undefined using `y\n")}`,
    'hyperref token continuation': `Package hyperref Warning: Token not allowed in a PDF string (Unicode):\n${fill('(hyperref)                removing `x\n')}`,
    'citation continuation': `LaTeX Warning: Citation \`a\n${fill("        ' on page `x\n")}`,
    'missing character': `Missing character: There is no x ${fill('in font ')}\n`,
    'runaway argument': `Runaway argument?\n{${' '.repeat(MB)}x\n! Paragraph ended before \\foo was complete.\n`,
    'paragraph ended spaces': `! Paragraph ended before \\foo${' '.repeat(MB)}x\n`,
    'fontspec error': `! Package fontspec Error: ${fill('font "a" ')}\n`,
    'file-line-error with spaces': `./${fill('a ')}\n`,
    'spaced file token': `(./a${fill(' b')}\n`,
    'many spaced file tokens': `${fill('(./a b ')}\n`,
    'LaTeX error file': `! LaTeX Error: File \`${fill("x' ")}\n`,
  };
  it.each(Object.keys(logs))('%s', (name) => {
    const text = logs[name] as string;
    expect(timed(() => analyzeLog(text))).toBeLessThan(LIMIT_MS);
  });

  it('caps the joined message length', () => {
    const parsed = parseLog(logs['font shape continuation'] as string);
    expect(parsed.warnings[0]?.message.length).toBeLessThanOrEqual(4096);
  });
});

describe('1 MB crafted bib and tex sources stay linear', () => {
  it('author field with a long run of spaces', () => {
    const author = `A${' '.repeat(MB)}x`;
    expect(timed(() => parseNames(author))).toBeLessThan(LIMIT_MS);
    expect(timed(() => hasOthers(author))).toBeLessThan(LIMIT_MS);
    expect(
      timed(() => parseBib(`@article{k, author={${author}}, title={T}, year={2020}}\n`)),
    ).toBeLessThan(LIMIT_MS);
  });

  it('still splits names and detects "and others"', () => {
    expect(parseNames('Doe, Jane   and  John Smith and others').map((n) => n.family)).toEqual([
      'Doe',
      'Smith',
    ]);
    expect(hasOthers('Doe, Jane and others ')).toBe(true);
    expect(hasOthers('Doe, Jane and Others')).toBe(true);
    expect(hasOthers('Doe, Jane andothers')).toBe(false);
  });

  it('unclosed command arguments and many matches', () => {
    const files = [
      { path: 'a.tex', content: fill('\\includegraphics{') },
      { path: 'b.tex', content: fill('\\includegraphics[') },
      { path: 'c.tex', content: fill('\\includegraphics{x}\n') },
    ];
    expect(timed(() => findCommands(files, ['includegraphics']))).toBeLessThan(LIMIT_MS);
    expect(timed(() => grepTex(files, /\\includegraphics/))).toBeLessThan(LIMIT_MS);
  });

  it('findCommands keeps arguments, optional arguments and lines', () => {
    const uses = findCommands(
      [{ path: 'm.tex', content: 'x\n\\includegraphics[width=1cm]{a{b}c}\n\\includegraphics{d} % \\includegraphics{e}\n' }],
      ['includegraphics'],
    );
    expect(uses).toEqual([
      { file: 'm.tex', line: 2, name: 'includegraphics', optional: 'width=1cm', arg: 'a{b}c' },
      { file: 'm.tex', line: 3, name: 'includegraphics', arg: 'd' },
    ]);
  });
});
