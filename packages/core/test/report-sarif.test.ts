import { describe, expect, it } from 'vitest';
import { formatSarif } from '../src/report/index.js';
import type { Report } from '../src/types.js';

const report: Report = {
  tool: 'overfull',
  version: '3.1.0',
  target: 'paper.pdf',
  status: 'fail',
  checks: [
    {
      check: 'build',
      status: 'fail',
      problems: [
        {
          rule: 'undefined-control-sequence',
          check: 'build',
          severity: 'error',
          message: 'Undefined control sequence \\foo\n::error::injected',
          location: { file: 'sections/intro.tex', line: 12 },
          fix: 'Define `\\foo` or load its package',
        },
        {
          rule: 'overfull-hbox',
          check: 'build',
          severity: 'warning',
          message: 'Overfull \\hbox (3pt too wide)',
          location: { file: 'main.tex' },
        },
      ],
    },
    {
      check: 'output',
      status: 'warn',
      problems: [
        {
          rule: 'pdf-unresolved-reference',
          check: 'output',
          severity: 'info',
          message: '"??" printed',
          location: { page: 3 },
        },
        { rule: 'made-up-rule', check: 'venue', severity: 'info', message: 'No location' },
      ],
    },
  ],
};

interface Res {
  ruleId: string;
  ruleIndex: number;
  level: string;
  message: { text: string };
  locations?: {
    physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number } };
  }[];
}
interface Sarif {
  version: string;
  runs: {
    tool: {
      driver: {
        name: string;
        version: string;
        informationUri: string;
        rules: { id: string; shortDescription: { text: string }; helpUri: string }[];
      };
    };
    results: Res[];
  }[];
}

describe('formatSarif', () => {
  const log = JSON.parse(formatSarif(report, { fallbackFile: 'main.tex' })) as Sarif;
  const run = log.runs[0];

  it('is one SARIF 2.1.0 run with the overfull driver', () => {
    expect(log.version).toBe('2.1.0');
    expect(log.runs).toHaveLength(1);
    expect(run?.tool.driver).toMatchObject({
      name: 'overfull',
      version: '3.1.0',
      informationUri: 'https://amet13.github.io/overfull/',
    });
  });

  it('lists each occurring rule once, with a help link, and results point at them', () => {
    const rules = run?.tool.driver.rules ?? [];
    expect(rules.map((r) => r.id)).toEqual([
      'undefined-control-sequence',
      'overfull-hbox',
      'pdf-unresolved-reference',
      'made-up-rule',
    ]);
    for (const r of rules) {
      expect(r.shortDescription.text.length).toBeGreaterThan(0);
      expect(r.helpUri).toBe(`https://amet13.github.io/overfull/rules/${r.id}/`);
    }
    for (const res of run?.results ?? []) expect(rules[res.ruleIndex]?.id).toBe(res.ruleId);
  });

  it('maps severities and locations; every result has a location when a fallback exists', () => {
    const res = run?.results ?? [];
    expect(res.map((r) => r.level)).toEqual(['error', 'warning', 'note', 'note']);
    expect(res[0]?.locations?.[0]?.physicalLocation).toEqual({
      artifactLocation: { uri: 'sections/intro.tex', uriBaseId: '%SRCROOT%' },
      region: { startLine: 12 },
    });
    expect(res[1]?.locations?.[0]?.physicalLocation.region.startLine).toBe(1);
    expect(res[2]?.locations?.[0]?.physicalLocation.artifactLocation.uri).toBe('main.tex');
    expect(res[2]?.message.text).toBe('Page 3: "??" printed');
  });

  it('keeps message text on one line and prefixes root', () => {
    const out = JSON.parse(formatSarif(report, { root: 'docs/paper/' })) as Sarif;
    const first = out.runs[0]?.results[0];
    expect(first?.message.text).not.toContain('\n');
    expect(first?.locations?.[0]?.physicalLocation.artifactLocation.uri).toBe(
      'docs/paper/sections/intro.tex',
    );
  });

  it('omits locations for file-less problems with no fallback', () => {
    const out = JSON.parse(formatSarif(report)) as Sarif;
    expect(out.runs[0]?.results[3]?.locations).toBeUndefined();
  });

  it('matches the snapshot', () => {
    expect(formatSarif(report, { fallbackFile: 'main.tex' })).toMatchSnapshot();
  });
});
