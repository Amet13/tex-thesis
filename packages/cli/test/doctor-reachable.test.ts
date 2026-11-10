import { describe, expect, it } from 'vitest';
import { main } from '../src/main.js';
import { memIo, tempDir } from './helpers.js';

describe('doctor network line', () => {
  it('says "reachable" for any HTTP response and keeps the status in JSON', async () => {
    for (const status of [200, 405]) {
      const io = memIo(tempDir());
      io.fetch = (async () => new Response('', { status })) as typeof fetch;
      await main(['doctor'], io);
      const line = io
        .stdoutText()
        .split('\n')
        .find((l) => /(^|\s)api\.crossref\.org\s/.test(l));
      expect(line).toMatch(/api\.crossref\.org +reachable$/);
      expect(line).not.toContain('HTTP');
      const j = memIo(tempDir());
      j.fetch = io.fetch;
      await main(['doctor', '--json'], j);
      const item = JSON.parse(j.stdoutText()).items.find(
        (i: { name: string }) => i.name === 'api.crossref.org',
      );
      expect(item).toMatchObject({ ok: true, detail: 'reachable', status });
    }
  });
});
