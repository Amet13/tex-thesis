/** scripts/venues-watch.mjs and scripts/venues-kits.mjs helpers, without the network. */
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: plain .mjs scripts without type declarations
import { fileFromKit, setHash, sha256, unzip } from '../venues-kits.mjs';
// @ts-expect-error: plain .mjs scripts without type declarations
import { changedPageFinding, lineDiff, nextEditionUrl, pageText } from '../venues-watch.mjs';

/** A minimal ZIP with the given files; `deflate` picks method 8, else stored (0). */
function zip(files: Record<string, string>, deflate = true): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text);
    const data = deflate ? deflateRawSync(raw) : raw;
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    locals.push(local, n, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(deflate ? 8 : 0, 10);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

describe('venues-kits', () => {
  it('reads stored and deflated ZIP entries by base name, first copy wins', () => {
    for (const deflate of [true, false]) {
      const files = unzip(
        zip(
          { 'kit/neurips.sty': '% style v2', 'kit/old/neurips.sty': '% old', 'kit/': '' },
          deflate,
        ),
      );
      expect(files['neurips.sty']?.toString()).toBe('% style v2');
    }
    expect(() => unzip(Buffer.from('not a zip at all, definitely not'))).toThrow(/not a ZIP/);
  });

  it('takes the file from a ZIP kit, or the download itself when the URL names it', () => {
    const z = zip({ 'a/cvpr.sty': 'x' });
    expect(fileFromKit('https://e/kit.zip', z, 'cvpr.sty')?.toString()).toBe('x');
    expect(fileFromKit('https://e/kit.zip', z, 'other.sty')).toBeUndefined();
    const cls = Buffer.from('\\ProvidesClass{IEEEtran}');
    expect(fileFromKit('https://ctan/IEEEtran/IEEEtran.cls', cls, 'IEEEtran.cls')).toBe(cls);
    expect(fileFromKit('https://ctan/page.html', cls, 'IEEEtran.cls')).toBeUndefined();
    expect(sha256(Buffer.from(''))).toMatch(/^e3b0c442/);
  });

  it('replaces only the named file’s hash', () => {
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);
    const yml = `styleFiles:\n  - name: one.sty\n    sha256: ${a}\n    kit: https://k\n  - name: two.sty\n    sha256: ${a}\n`;
    const out = setHash(yml, 'two.sty', a, b);
    expect(out).toBe(yml.replace(`two.sty\n    sha256: ${a}`, `two.sty\n    sha256: ${b}`));
    expect(() => setHash(yml, 'three.sty', a, b)).toThrow();
  });
});

describe('venues-watch', () => {
  it('turns a page into readable lines without menus, scripts or date stamps', () => {
    const html = `<html><head><style>p{}</style><script>var x = "<p>no</p>";</script></head>
<body><nav><a>Home</a></nav><header>Site</header>
<h1>Call for Papers</h1><p>The page limit is <b>9</b>&nbsp;pages.</p>
<ul><li>Anonymity &amp; ethics</li><li>2026-11-11 19:10 CET</li><li>11:59 pm AoE</li></ul>
<footer>© 2026</footer><!-- comment --></body></html>`;
    expect(pageText(html)).toBe(
      'Call for Papers\nThe page limit is 9 pages.\nAnonymity & ethics\n11:59 pm AoE',
    );
  });

  it('shows removed and added lines, capped, as a diff block', () => {
    expect(lineDiff('a\nb\nc', 'a\nc\nd')).toEqual({ removed: ['b'], added: ['d'] });
    const many = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
    expect(lineDiff('', many, 3).added).toEqual(['l0', 'l1', 'l2', '… and 17 more']);
    const f = changedPageFinding('`neurips-2026`', 'https://x', 'limit 9', 'limit 10');
    expect(f).toContain('```diff\n  - limit 9\n  + limit 10\n  ```');
  });

  it('builds the next edition’s URL', () => {
    expect(nextEditionUrl('https://neurips.cc/Conferences/2026/CallForPapers', 2026)).toBe(
      'https://neurips.cc/Conferences/2027/CallForPapers',
    );
    expect(nextEditionUrl('https://aaai.org/authorkit27/', 2027)).toBe(
      'https://aaai.org/authorkit28/',
    );
    expect(nextEditionUrl('https://ctan.org/pkg/acmart', 2026)).toBeUndefined();
  });
});
