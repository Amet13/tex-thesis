import { describe, expect, it } from 'vitest';
import { formula, parseSums, scoop } from './generate.mjs';

const files = [
  'overfull-darwin-arm64',
  'overfull-darwin-x64',
  'overfull-linux-arm64',
  'overfull-linux-x64',
  'overfull-win-x64.exe',
  'overfull.cjs',
];
const sums = files.map((f, i) => `${String(i).repeat(64)}  ${f}`).join('\n');

describe('packaging', () => {
  it('parses SHA256SUMS and rejects other lines', () => {
    expect(parseSums(`${sums}\n`).get('overfull-linux-x64')).toBe('3'.repeat(64));
    expect(() => parseSums('not a sum')).toThrow(/SHA256SUMS/);
  });

  it('writes a formula with one url and sha256 per platform', () => {
    const rb = formula('3.1.0', parseSums(sums));
    for (const [i, f] of files.slice(0, 4).entries()) {
      expect(rb).toContain(`/releases/download/v3.1.0/${f}"`);
      expect(rb).toContain(`sha256 "${String(i).repeat(64)}"`);
    }
    expect(rb).toContain('bin.install');
    expect(() => formula('3.1', parseSums(sums))).toThrow(/version/);
  });

  it('writes a Scoop manifest for the Windows build', () => {
    const m = JSON.parse(scoop('3.1.0', parseSums(sums)));
    expect(m.version).toBe('3.1.0');
    expect(m.architecture['64bit'].hash).toBe('4'.repeat(64));
    expect(m.architecture['64bit'].url).toMatch(/v3\.1\.0\/overfull-win-x64\.exe#\/overfull\.exe$/);
    expect(m.bin).toBe('overfull.exe');
  });

  it('fails when a build is missing from SHA256SUMS', () => {
    expect(() => formula('3.1.0', parseSums(sums.split('\n').slice(1).join('\n')))).toThrow(
      /overfull-darwin-arm64/,
    );
  });
});
