import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/refs/sha256.js';
import { resolveProfile, type TexFile, type VenueProfile, venueCheck } from '../src/venue/index.js';

const tex = (content: string, path = 'main.tex'): TexFile => ({ path, content });
const run = (profile: VenueProfile, files: TexFile[], rule: string) =>
  venueCheck(profile, { texFiles: files, main: 'main.tex' }).problems.filter(
    (p) => p.rule === rule,
  );

const limited = resolveProfile({ extends: 'paper', pageLimit: { max: 8 } });
const styled = resolveProfile({
  extends: 'paper',
  styleFiles: [{ name: 'venue.sty' }],
});

describe('layout-tampering', () => {
  it('flags a negative \\vspace near a figure, with file and line', () => {
    const src =
      '\\begin{figure}\n\\includegraphics{a}\n\\caption{x}\n\\vspace{-3mm}\n\\end{figure}\n';
    const p = run(limited, [tex(src)], 'layout-tampering');
    expect(p).toHaveLength(1);
    expect(p[0]?.location).toEqual({ file: 'main.tex', line: 4 });
    expect(p[0]?.severity).toBe('warning');
    expect(p[0]?.message).toContain('check that your venue allows this');
  });

  it('does not flag negative \\vspace far from floats and headings, or positive ones', () => {
    const src = `Text.\n\n\n\n\n\n\\vspace{-1em}\n\n\n\n\n\n\n\\vspace{2mm}\n\\begin{figure}\\end{figure}\n`;
    expect(run(limited, [tex(src)], 'layout-tampering')).toHaveLength(0);
  });

  it('flags line spacing below 1 only', () => {
    const src = '\\renewcommand{\\baselinestretch}{0.95}\n\\linespread{1.1}\n\\setstretch{0.9}\n';
    const p = run(limited, [tex(src)], 'layout-tampering');
    expect(p.map((x) => x.location?.line)).toEqual([1, 3]);
  });

  it('flags negative float spacing and savetrees', () => {
    const src = '\\usepackage[subtle]{savetrees}\n\\setlength{\\textfloatsep}{-2pt}\n';
    const p = run(limited, [tex(src)], 'layout-tampering');
    expect(p.map((x) => x.data?.kind).sort()).toEqual(['negative-skip', 'savetrees']);
  });

  it('flags margin and font changes only when the profile names a style file', () => {
    const src =
      '\\documentclass[10pt]{article}\n\\usepackage[margin=1in]{geometry}\n\\setlength{\\textheight}{9.5in}\n\\setlength{\\columnsep}{1em}\n';
    expect(run(limited, [tex(src)], 'layout-tampering')).toHaveLength(0);
    const p = run(styled, [tex(src)], 'layout-tampering');
    expect(p.map((x) => x.data?.kind)).toEqual([
      'font-size',
      'geometry',
      'page-length',
      'page-length',
    ]);
  });

  it('ignores paper-size-only geometry and comments', () => {
    const src = '\\usepackage[a4paper]{geometry}\n% \\usepackage{savetrees}\n';
    expect(run(styled, [tex(src)], 'layout-tampering')).toHaveLength(0);
  });

  it('skips class files and the style files the profile names', () => {
    const files = [
      tex('\\setlength{\\textheight}{9in}\n', 'venue.sty'),
      tex('\\setlength{\\textheight}{9in}\n', 'x.cls'),
    ];
    expect(run(styled, files, 'layout-tampering')).toHaveLength(0);
  });

  it('is off for generic and thesis, and for profiles without a limit or style file', () => {
    const src = '\\usepackage{savetrees}\n';
    expect(run(resolveProfile('generic'), [tex(src)], 'layout-tampering')).toHaveLength(0);
    expect(run(resolveProfile('paper'), [tex(src)], 'layout-tampering')).toHaveLength(0);
    const thesis = resolveProfile({ extends: 'thesis', pageLimit: { max: 80 } });
    expect(run(thesis, [tex(src)], 'layout-tampering')).toHaveLength(0);
  });
});

describe('style-file-modified', () => {
  const official = '\\ProvidesPackage{venue}\n\\setlength{\\textheight}{9in}\n';
  const profile = resolveProfile({
    extends: 'paper',
    styleFiles: [{ name: 'venue.sty', sha256: sha256Hex(official) }, { name: 'other.sty' }],
  });

  it('is silent when the copy matches, also with Windows line endings', () => {
    expect(run(profile, [tex(official, 'venue.sty')], 'style-file-modified')).toHaveLength(0);
    expect(
      run(profile, [tex(official.replace(/\n/g, '\r\n'), 'sty/venue.sty')], 'style-file-modified'),
    ).toHaveLength(0);
  });

  it('warns when the copy differs', () => {
    const p = run(profile, [tex(`${official}\\relax\n`, 'sty/venue.sty')], 'style-file-modified');
    expect(p).toHaveLength(1);
    expect(p[0]?.severity).toBe('warning');
    expect(p[0]?.location).toEqual({ file: 'sty/venue.sty' });
  });

  it('does nothing when the file is absent or the profile records no hash', () => {
    expect(run(profile, [tex('x', 'main.tex')], 'style-file-modified')).toHaveLength(0);
    expect(run(styled, [tex('changed', 'venue.sty')], 'style-file-modified')).toHaveLength(0);
  });
});

describe('anonymity-link', () => {
  const anon = resolveProfile('double-blind');
  const p = (src: string) => run(anon, [tex(src)], 'anonymity-link');

  it('flags personal repositories, pages and institutional sites with location', () => {
    const found = p(
      'Code: \\url{https://github.com/jdoe/project}.\n\\href{https://jdoe.github.io/}{me}\nSee http://www.cs.uni.edu/~jdoe/x and https://lab.mit.edu/a\n',
    );
    expect(found.map((x) => x.location?.line)).toEqual([1, 2, 3, 3]);
    expect(found[0]?.severity).toBe('warning');
  });

  it('allows anonymizers, ordinary sites and comments', () => {
    expect(
      p(
        'https://anonymous.4open.science/r/abc\nhttps://arxiv.org/abs/1\n% https://github.com/jdoe/x\nhttps://github.com/\n',
      ),
    ).toHaveLength(0);
  });

  it('only runs for anonymous profiles', () => {
    expect(
      run(resolveProfile('paper'), [tex('https://github.com/jdoe/x')], 'anonymity-link'),
    ).toHaveLength(0);
  });
});
