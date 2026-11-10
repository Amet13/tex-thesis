import { describe, expect, it } from 'vitest';
import { resolveProfile, venueProfileData } from '../src/venue/index.js';

const entries = Object.entries(venueProfileData);

describe('shipped venue profiles', () => {
  it('ships at least one profile', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('uses unique ids that match their keys', () => {
    const ids = entries.map(([, p]) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [key, p] of entries) expect(p.id).toBe(key);
  });

  for (const [id, data] of entries) {
    describe(id, () => {
      it('resolves through resolveProfile', () => {
        const p = resolveProfile(id);
        expect(p.name).toBe(data.name);
      });

      it('has https sources and a checkedOn date', () => {
        expect(data.source?.length).toBeGreaterThan(0);
        for (const url of data.source ?? []) expect(url).toMatch(/^https:\/\/[^\s]+$/);
        expect(data.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      it('records a sha256 only as 64 hex digits', () => {
        for (const f of data.styleFiles ?? [])
          if (f.sha256 !== undefined) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      });
    });
  }
});
