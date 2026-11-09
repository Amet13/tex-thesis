import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE, loadConfig } from '../src/config.js';
import { UsageError } from '../src/io.js';
import { tempCopy, tempDir } from './helpers.js';

describe('loadConfig', () => {
  it('reads overfull.yml and merges venue fields over the profile', () => {
    const dir = tempCopy('project');
    const c = loadConfig(dir);
    expect(c).toMatchObject({
      root: dir,
      main: 'main.tex',
      jobname: 'thesis',
      bib: ['references.bib'],
      references: { mailto: 'test@example.org', ignore: ['rfc9110'] },
      build: { engine: 'auto', image: DEFAULT_IMAGE },
    });
    expect(c.profile).toMatchObject({
      id: 'thesis',
      accessibility: 'required',
      pageLimit: { max: 1, endLabel: 'overfull:main-end' },
    });
    expect(c.checks).toEqual(['build', 'output', 'references', 'accessibility', 'venue']);
  });

  it('uses defaults without a config file and finds the bibliography in main.tex', () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, 'main.tex'),
      '% \\addbibresource{old.bib}\n\\addbibresource{refs/papers.bib}\n',
    );
    const c = loadConfig(dir);
    expect(c.file).toBeUndefined();
    expect(c).toMatchObject({ main: 'main.tex', jobname: 'main', bib: ['refs/papers.bib'] });
    expect(c.profile.id).toBe('generic');
  });

  it('falls back to *.bib files and honours OVERFULL_IMAGE and OVERFULL_MAILTO', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'b.bib'), '');
    writeFileSync(join(dir, 'a.bib'), '');
    const c = loadConfig(dir, undefined, {
      OVERFULL_IMAGE: 'local:dev',
      OVERFULL_MAILTO: 'me@x.org',
    });
    expect(c.bib).toEqual(['a.bib', 'b.bib']);
    expect(c.build.image).toBe('local:dev');
    expect(c.references.mailto).toBe('me@x.org');
  });

  it.each([
    ['mian: main.tex', /unknown key `mian` \(did you mean `main`\?\)/],
    ['profile: neurips', /Unknown profile "neurips"/],
    ['checks: [build, spelling]', /unknown check "spelling"/],
    ['venue:\n  disclosure: maybe', /venue.disclosure` must be required, recommended or off/],
    ['venue:\n  pageLimit: { max: nine }', /venue.pageLimit` must be/],
    ['build:\n  engine: podman', /build.engine` must be auto, local or docker/],
    ['main: [a, b', /invalid YAML/],
    ['- a\n- b', /must be a mapping/],
  ])('rejects %j', (yaml, message) => {
    const dir = tempDir();
    writeFileSync(join(dir, 'overfull.yml'), yaml);
    expect(() => loadConfig(dir)).toThrow(UsageError);
    expect(() => loadConfig(dir)).toThrow(message);
  });

  it('reports a missing --config file', () => {
    expect(() => loadConfig(tempDir(), 'nope.yml')).toThrow(/Config file not found: nope.yml/);
  });
});
