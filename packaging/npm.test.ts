import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { npmManifest, npmReadme } from './npm.mjs';

describe('npm package', () => {
  it('has one file, one bin and requires Node 26', () => {
    const m = npmManifest('3.2.0');
    expect(m).toMatchObject({
      name: 'overfull',
      version: '3.2.0',
      bin: { overfull: 'overfull.cjs' },
      files: ['overfull.cjs'],
      engines: { node: '>=26' },
      license: 'MIT',
    });
    expect(m).not.toHaveProperty('dependencies');
    expect(() => npmManifest('v3.2.0')).toThrow(/not a version/);
    expect(npmReadme('3.2.0')).toContain('npm install -g overfull');
  });

  it('writes the package with an executable entry point', () => {
    const dir = mkdtempSync(join(tmpdir(), 'overfull-npm-'));
    const cjs = join(dir, 'in.cjs');
    writeFileSync(cjs, 'console.log("ok")\n');
    const out = join(dir, 'out');
    execFileSync(process.execPath, [
      join(import.meta.dirname, 'npm.mjs'),
      '--version',
      '3.2.0',
      '--cjs',
      cjs,
      '--out',
      out,
    ]);
    expect(readFileSync(join(out, 'overfull.cjs'), 'utf8')).toMatch(/^#!\/usr\/bin\/env node\n/);
    expect(JSON.parse(readFileSync(join(out, 'package.json'), 'utf8')).version).toBe('3.2.0');
    expect(statSync(join(out, 'LICENSE')).size).toBeGreaterThan(0);
  });
});
