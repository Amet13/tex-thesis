import { describe, expect, it } from 'vitest';
import { allRules, getRule } from '../src/rules.js';
import { CHECK_IDS } from '../src/types.js';

describe('rule registry', () => {
  const rules = allRules();

  it('has unique kebab-case ids', () => {
    const ids = rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('documents every rule', () => {
    for (const r of rules) {
      expect(r.title.trim(), r.id).not.toBe('');
      expect(r.summary.trim(), r.id).not.toBe('');
      expect(r.fix.trim(), r.id).not.toBe('');
      expect(CHECK_IDS).toContain(r.check);
      expect(['error', 'warning', 'info']).toContain(r.severity);
    }
  });

  it('covers every module', () => {
    const checks = new Set(rules.map((r) => r.check));
    for (const c of CHECK_IDS) expect(checks.has(c), c).toBe(true);
  });

  it('looks rules up by id, including dynamic veraPDF clauses', () => {
    expect(getRule('pdf-not-tagged')?.check).toBe('accessibility');
    expect(getRule('verapdf-8-2-5-26')).toMatchObject({
      id: 'verapdf-8-2-5-26',
      title: 'PDF/UA clause 8.2.5.26 failed (veraPDF)',
    });
    expect(getRule('no-such-rule')).toBeUndefined();
  });
});
