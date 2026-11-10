/** G2: `overfull check --sarif`. */
import { describe, expect, it } from 'vitest';
import { main } from '../src/main.js';
import { memIo, tempCopy } from './helpers.js';

interface Result {
  ruleId: string;
  level: string;
  locations?: {
    physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number } };
  }[];
}

describe('check --sarif', () => {
  it('prints one SARIF 2.1.0 run; every result has a location; exit code as for other formats', async () => {
    const dir = tempCopy('project');
    const io = memIo(dir);
    const code = await main(['check', '--offline', '--sarif'], io);
    const log = JSON.parse(io.stdoutText());
    expect(log.version).toBe('2.1.0');
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0].tool.driver.name).toBe('overfull');
    const results = log.runs[0].results as Result[];
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      const loc = r.locations?.[0]?.physicalLocation;
      expect(loc?.artifactLocation.uri, r.ruleId).toBeTruthy();
      expect(loc?.artifactLocation.uri.startsWith('/')).toBe(false);
      expect(loc?.region.startLine).toBeGreaterThanOrEqual(1);
    }
    const json = memIo(dir);
    const jsonCode = await main(['check', '--offline', '--json'], json);
    expect(code).toBe(jsonCode);
    const rules = new Set<string>(log.runs[0].tool.driver.rules.map((r: { id: string }) => r.id));
    for (const r of results) expect(rules.has(r.ruleId)).toBe(true);
  });

  it('cannot be combined with another format (exit 2)', async () => {
    for (const other of ['--json', '--markdown', '--annotations']) {
      const io = memIo(tempCopy('project'));
      expect(await main(['check', '--offline', '--sarif', other], io)).toBe(2);
      expect(io.stderrText() + io.stdoutText()).toContain('one output format');
    }
  });
});
