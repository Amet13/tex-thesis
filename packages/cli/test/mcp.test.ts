/** MCP server: protocol handling and the five tools, driven through the message handler. */
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/main.js';
import { createMcpServer } from '../src/mcp/protocol.js';
import { LineSplitter } from '../src/mcp/stdio.js';
import { createTools } from '../src/mcp/tools.js';
import { tempCopy, tempDir } from './helpers.js';

type Msg = Record<string, unknown>;

const CSL = {
  type: 'article-journal',
  title: 'Zorbulating hyperflux capacitors in tandem orchards',
  author: [{ family: 'Zyx', given: 'Quorbl' }],
  'container-title': 'Journal of Imaginary Results',
  issued: { 'date-parts': [[2023]] },
  DOI: '10.1234/zz',
};

/** doi.org answers CSL JSON for the DOI and has no BibTeX; everything else is unreachable. */
const fakeFetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const accept = new Headers(init?.headers).get('accept') ?? '';
  if (url.startsWith('https://doi.org/10.1234/zz')) {
    return accept.includes('csl+json')
      ? new Response(JSON.stringify(CSL), { status: 200 })
      : new Response('', { status: 404 });
  }
  return new Response('', { status: 404 });
}) as typeof fetch;

function setup(cwd: string, fetchImpl?: typeof fetch) {
  const server = createMcpServer({
    version: '9.9.9',
    tools: createTools({
      cwd,
      env: { PATH: process.env.PATH },
      run: main,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    }),
  });
  let nextId = 1;
  const send = async (method: string, params?: Msg): Promise<Msg> => {
    const line = await server.handle(
      JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, ...(params ? { params } : {}) }),
    );
    expect(line).toBeDefined();
    expect(line).not.toContain('\n');
    return JSON.parse(line as string) as Msg;
  };
  const call = async (name: string, args: Msg = {}) => {
    const res = await send('tools/call', { name, arguments: args });
    return res.result as {
      content: { type: string; text?: string; data?: string }[];
      structuredContent?: Msg;
      isError?: boolean;
    };
  };
  return { server, send, call };
}

async function ready(cwd: string, fetchImpl?: typeof fetch) {
  const s = setup(cwd, fetchImpl);
  await s.send('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 't', version: '1' },
  });
  expect(
    await s.server.handle('{"jsonrpc":"2.0","method":"notifications/initialized"}'),
  ).toBeUndefined();
  return s;
}

describe('MCP protocol', () => {
  it('initialize negotiates the version and declares tools', async () => {
    const { send } = setup(tempDir());
    const same = (await send('initialize', { protocolVersion: '2025-06-18', capabilities: {} }))
      .result as Msg;
    expect(same).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'overfull', version: '9.9.9' },
    });
    const other = (await send('initialize', { protocolVersion: '1999-01-01', capabilities: {} }))
      .result as Msg;
    expect(other.protocolVersion).toBe('2025-11-25');
  });

  it('refuses requests before initialize, but answers ping and discovery', async () => {
    const { send } = setup(tempDir());
    expect(((await send('tools/list')).error as Msg).code).toBe(-32602);
    expect((await send('ping')).result).toEqual({});
    const d = (await send('server/discover')).result as Msg;
    expect(d).toMatchObject({ resultType: 'complete', supportedVersions: ['2026-07-28'] });
  });

  it('errors: unknown method, malformed JSON, bad shapes, unknown tool', async () => {
    const { server, send } = await ready(tempDir());
    expect(((await send('resources/list')).error as Msg).code).toBe(-32601);
    const bad = JSON.parse((await server.handle('{not json')) as string) as Msg;
    expect(bad).toMatchObject({ id: null, error: { code: -32700 } });
    for (const raw of [
      '[]',
      '{"jsonrpc":"1.0","id":1,"method":"ping"}',
      '{"jsonrpc":"2.0","id":null,"method":"ping"}',
    ]) {
      expect(JSON.parse((await server.handle(raw)) as string)).toMatchObject({
        error: { code: -32600 },
      });
    }
    expect(((await send('tools/call', { name: 'nope' })).error as Msg).code).toBe(-32602);
  });

  it('ignores unknown notifications and stray responses', async () => {
    const { server } = await ready(tempDir());
    expect(
      await server.handle('{"jsonrpc":"2.0","method":"notifications/whatever"}'),
    ).toBeUndefined();
    expect(await server.handle('{"jsonrpc":"2.0","id":7,"result":{}}')).toBeUndefined();
  });

  it('modern era: per-request _meta, resultType, UnsupportedProtocolVersion, missing capabilities', async () => {
    const { send } = setup(tempDir());
    const meta = {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientCapabilities': {},
    };
    const list = (await send('tools/list', { _meta: meta })).result as Msg;
    expect(list.resultType).toBe('complete');
    expect((list.tools as Msg[]).length).toBe(5);
    expect(list._meta).toMatchObject({
      'io.modelcontextprotocol/serverInfo': { name: 'overfull' },
    });
    const old = await send('tools/list', {
      _meta: { ...meta, 'io.modelcontextprotocol/protocolVersion': '1900-01-01' },
    });
    expect(old.error).toMatchObject({
      code: -32022,
      data: { supported: ['2026-07-28'], requested: '1900-01-01' },
    });
    const noCaps = await send('tools/list', {
      _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' },
    });
    expect((noCaps.error as Msg).code).toBe(-32602);
    const call = (await send('tools/call', { name: 'explain', arguments: {}, _meta: meta }))
      .result as Msg;
    expect(call.resultType).toBe('complete');
  });
});

describe('MCP tools', () => {
  it('tools/list lists the five tools with schemas and annotations', async () => {
    const { send } = await ready(tempDir());
    const tools = ((await send('tools/list')).result as { tools: Msg[] }).tools;
    expect(tools.map((t) => t.name)).toEqual(['check', 'cite', 'explain', 'pages', 'doctor']);
    for (const t of tools) {
      expect(t.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
      expect(typeof t.description).toBe('string');
      expect(t.annotations).toHaveProperty('readOnlyHint');
      expect(t).not.toHaveProperty('run');
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations as Msg]));
    expect(byName.cite?.readOnlyHint).toBe(false);
    expect(byName.check?.readOnlyHint).toBe(true);
    expect(byName.explain?.openWorldHint).toBe(false);
  });

  it('check on the fixture project returns the same Report as --json', async () => {
    const dir = tempCopy('project');
    const { call } = await ready(dir);
    const res = await call('check', { offline: true });
    expect(res.isError).toBeUndefined();
    const report = JSON.parse(res.content[0]?.text as string) as {
      checks: unknown[];
      summary?: unknown;
    };
    expect(Array.isArray(report.checks)).toBe(true);
    expect(res.structuredContent).toEqual(report);
    const cli = await (async () => {
      const out: string[] = [];
      await main(['check', '--json', '--offline'], {
        cwd: dir,
        env: { PATH: process.env.PATH, NO_COLOR: '1' },
        isTTY: false,
        stdout: (s) => out.push(s),
        stderr: () => {},
      });
      return JSON.parse(out.join('')) as unknown;
    })();
    expect(report).toEqual(cli);
  });

  it('check rejects bad arguments as tool errors, not protocol errors', async () => {
    const { call } = await ready(tempCopy('project'));
    for (const args of [
      { checks: ['nope'] },
      { offline: 'yes' },
      { cwd: '/etc' },
      { profile: '--evil flag' },
      { main: '../../etc/passwd' },
      { main: '/etc/passwd' },
    ]) {
      const res = await call('check', args);
      expect(res.isError, JSON.stringify(args)).toBe(true);
      expect(res.content[0]?.text).toBeTruthy();
    }
  });

  it('explain returns a rule, lists rules, and reports an unknown rule as a tool error', async () => {
    const { call } = await ready(tempDir());
    const list = await call('explain');
    const rules = (list.structuredContent as { rules: { id: string }[] }).rules;
    expect(rules.length).toBeGreaterThan(50);
    const one = await call('explain', { rule: rules[0]?.id });
    expect(one.structuredContent).toMatchObject({ id: rules[0]?.id });
    const bad = await call('explain', { rule: 'no-such-rule' });
    expect(bad.isError).toBe(true);
    expect(bad.content[0]?.text).toMatch(/Unknown rule "no-such-rule"/);
    // A rule that looks like an option is a rule name, not a flag.
    expect((await call('explain', { rule: '--list' })).isError).toBe(true);
  });

  it('doctor returns the tool report', async () => {
    const { call } = await ready(tempDir(), fakeFetch);
    const res = await call('doctor');
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent).toHaveProperty('items');
  });

  it('cite with dryRun and a fake fetch finds the work and writes nothing', async () => {
    const dir = tempCopy('project');
    const bib = join(dir, 'references.bib');
    const before = readFileSync(bib, 'utf8');
    const { call } = await ready(dir, fakeFetch);
    const res = await call('cite', { query: '10.1234/zz', dryRun: true, key: 'zyx23' });
    expect(res.isError, res.content[0]?.text).toBeUndefined();
    expect(res.structuredContent).toMatchObject({ key: 'zyx23', added: false });
    expect(readFileSync(bib, 'utf8')).toBe(before);
    // Without dryRun it appends to the project bibliography, with provenance.
    const real = await call('cite', { query: '10.1234/zz', key: 'zyx23' });
    expect(real.structuredContent).toMatchObject({ key: 'zyx23', added: true });
    expect(readFileSync(bib, 'utf8')).toContain('zyx23');
  });

  it('cite failures are tool errors with the CLI message, and write nothing', async () => {
    const dir = tempCopy('project');
    const bib = join(dir, 'references.bib');
    const before = readFileSync(bib, 'utf8');
    const { call } = await ready(dir, fakeFetch);
    const missing = await call('cite', { query: '10.9999/does-not-exist' });
    expect(missing.isError).toBe(true);
    expect(missing.content[0]?.text).toMatch(/Nothing was added/);
    expect((await call('cite', { query: 'x', key: 'bad key{' })).isError).toBe(true);
    expect((await call('cite', { query: '10.1234/zz', bib: '../x.bib' })).isError).toBe(true);
    expect(readFileSync(bib, 'utf8')).toBe(before);
  });

  it('cite never writes outside the project (bib in overfull.yml pointing out, or a symlink)', async () => {
    const dir = tempCopy('project');
    const outside = tempDir();
    writeFileSync(join(dir, 'overfull.yml'), 'main: main.tex\nbib: [../escape.bib]\n');
    const a = await (await ready(dir, fakeFetch)).call('cite', { query: '10.1234/zz' });
    expect(a.isError).toBe(true);
    expect(a.content[0]?.text).toMatch(/outside the project/);
    const dir2 = tempCopy('project');
    symlinkSync(outside, join(dir2, 'linked'));
    writeFileSync(join(dir2, 'overfull.yml'), 'main: main.tex\nbib: [linked/new.bib]\n');
    const b = await (await ready(dir2, fakeFetch)).call('cite', { query: '10.1234/zz' });
    expect(b.isError).toBe(true);
    expect(existsSync(join(outside, 'new.bib'))).toBe(false);
  });

  it('pages: a range past the end and a bad range are tool errors; no output outside .overfull', async () => {
    const dir = tempCopy('project');
    const { call } = await ready(dir);
    const past = await call('pages', { range: '999' });
    expect(past.isError).toBe(true);
    expect(past.content[0]?.text).toMatch(/does not exist|not found/);
    expect((await call('pages', { range: 'abc' })).isError).toBe(true);
    expect((await call('pages', { range: '1-500' })).isError).toBe(true);
    expect((await call('pages', { range: '1', out: '/tmp/x' })).isError).toBe(true);
  });

  it('pages renders PNGs and returns paths plus small images (needs pdftoppm)', async () => {
    const hasPdftoppm = (await import('../src/tools.js')).which('pdftoppm', process.env);
    if (!hasPdftoppm) return;
    const dir = tempCopy('project');
    mkdirSync(join(dir, '.overfull'), { recursive: true });
    const { call } = await ready(dir);
    const res = await call('pages', { range: '1' });
    expect(res.isError, res.content[0]?.text).toBeUndefined();
    const pages = (res.structuredContent as { pages: { file: string }[] }).pages;
    expect(pages[0]?.file).toMatch(/\.overfull[\\/]pages[\\/]page-1\.png$/);
    expect(existsSync(join(dir, pages[0]?.file as string))).toBe(true);
    expect(res.content.filter((c) => c.type === 'image').length).toBeLessThanOrEqual(5);
  });
});

describe('line framing', () => {
  it('splits lines across chunks, drops empty lines, handles CRLF and a final unterminated line', () => {
    const s = new LineSplitter();
    expect(s.push(Buffer.from('{"a":'))).toEqual([]);
    expect(s.push(Buffer.from('1}\r\n\n{"b":2}\n{"c"'))).toEqual([
      { line: '{"a":1}' },
      { line: '{"b":2}' },
    ]);
    expect(s.end()).toEqual([{ line: '{"c"' }]);
  });

  it('rejects a message over the limit once, then recovers on the next line', () => {
    const s = new LineSplitter(10);
    const ev = [
      ...s.push(Buffer.from('x'.repeat(8))),
      ...s.push(Buffer.from('y'.repeat(8))),
      ...s.push(Buffer.from('zz\nok\n')),
    ];
    expect(ev).toEqual([{ tooLarge: true }, { line: 'ok' }]);
  });

  it('counts bytes, not characters', () => {
    const s = new LineSplitter(4);
    expect(s.push(Buffer.from('ééé\n'))).toEqual([{ tooLarge: true }]);
  });
});
