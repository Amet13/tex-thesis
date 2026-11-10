/** The MCP server as a real subprocess over stdio: bundles the CLI entry, spawns it, talks JSON-RPC. */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { beforeAll, describe, expect, it } from 'vitest';
import { tempCopy } from './helpers.js';

const root = fileURLToPath(new URL('../../..', import.meta.url));
let bundle = '';

beforeAll(async () => {
  const out = mkdtempSync(join(tmpdir(), 'overfull-mcp-bundle-'));
  bundle = join(out, 'overfull.cjs');
  await build({
    entryPoints: [join(root, 'packages/cli/src/bin.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'error',
    alias: { '@overfull/core': join(root, 'packages/core/src/index.ts') },
    define: {
      __OVERFULL_VERSION__: JSON.stringify('0.0.0-test'),
      __OVERFULL_TEMPLATES__: '{}',
      'import.meta.url': '__importMetaUrl',
    },
    external: ['@napi-rs/canvas'],
    banner: { js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  });
}, 60000);

function session(cwd: string, args: string[] = []) {
  const child = spawn(process.execPath, [bundle, 'mcp', ...args], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, NO_COLOR: '1' },
  });
  let out = '';
  let err = '';
  child.stdout.setEncoding('utf8').on('data', (d: string) => {
    out += d;
  });
  child.stderr.setEncoding('utf8').on('data', (d: string) => {
    err += d;
  });
  const exited = new Promise<number | null>((resolve) =>
    child.on('close', (code) => resolve(code)),
  );
  const lines = () => out.split('\n').filter(Boolean);
  const waitFor = async (n: number) => {
    for (let i = 0; i < 600 && lines().length < n; i++) await new Promise((r) => setTimeout(r, 25));
    expect(lines().length).toBeGreaterThanOrEqual(n);
  };
  return {
    child,
    exited,
    lines,
    stderr: () => err,
    send: (s: string) => child.stdin.write(`${s}\n`),
    waitFor,
  };
}

describe('overfull mcp over stdio', () => {
  it('runs a whole session, writes only JSON-RPC lines to stdout, and exits when stdin closes', async () => {
    const s = session(tempCopy('project'));
    const rpc = (id: number, method: string, params?: unknown) =>
      JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
    s.send(
      rpc(1, 'initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 't', version: '1' },
      }),
    );
    s.send('{"jsonrpc":"2.0","method":"notifications/initialized"}');
    s.send(rpc(2, 'tools/list'));
    s.send(rpc(3, 'tools/call', { name: 'check', arguments: { offline: true } }));
    s.send(rpc(4, 'tools/call', { name: 'explain', arguments: {} }));
    s.send('this is not json');
    s.send(rpc(5, 'no/such/method'));
    s.send(rpc(6, 'ping'));
    await s.waitFor(7);
    s.child.stdin.end();
    expect(await s.exited).toBe(0);

    const msgs = s
      .lines()
      .map((l) => JSON.parse(l) as Record<string, unknown> & { id: number | null }); // every line parses
    for (const m of msgs) expect(m.jsonrpc).toBe('2.0');
    const byId = new Map(msgs.map((m) => [m.id, m]));
    const at = (id: number | null) => byId.get(id) ?? ({} as Record<string, unknown>);
    expect((at(1).result as { serverInfo: { name: string } }).serverInfo.name).toBe('overfull');
    const tools = (at(2).result as { tools: { name: string }[] }).tools;
    expect(tools.map((t) => t.name)).toEqual(['check', 'cite', 'explain', 'pages', 'doctor']);
    const check = at(3).result as { content: { text: string }[]; isError?: boolean };
    expect(check.isError).toBeUndefined();
    expect(
      Array.isArray((JSON.parse(check.content[0]?.text as string) as { checks: unknown[] }).checks),
    ).toBe(true);
    expect(
      (at(4).result as { structuredContent: { rules: unknown[] } }).structuredContent.rules.length,
    ).toBeGreaterThan(50);
    expect((at(null).error as { code: number }).code).toBe(-32700);
    expect((at(5).error as { code: number }).code).toBe(-32601);
    expect(at(6).result).toEqual({});
    expect(msgs.length).toBe(7);
  });

  it('answers a message over 4 MB with an error and keeps serving', async () => {
    const s = session(tempCopy('project'));
    s.send(
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}',
    );
    await s.waitFor(1);
    s.child.stdin.write(`${'x'.repeat(4 * 1024 * 1024 + 10)}\n`);
    await s.waitFor(2);
    s.send('{"jsonrpc":"2.0","id":2,"method":"ping"}');
    await s.waitFor(3);
    s.child.stdin.end();
    await s.exited;
    const second = JSON.parse(s.lines()[1] as string) as {
      error: { code: number; message: string };
    };
    expect(second.error.code).toBe(-32600);
    expect(second.error.message).toMatch(/too large/);
    expect(JSON.parse(s.lines()[2] as string)).toMatchObject({ id: 2, result: {} });
  });

  it('--cwd selects the project; a missing directory is a usage error; --help is not protocol output', async () => {
    const dir = tempCopy('project');
    const s = session(tmpdir(), ['--cwd', dir]);
    s.send(
      '{"jsonrpc":"2.0","id":1,"method":"ping","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}',
    );
    s.send(
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"check","arguments":{"offline":true},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}',
    );
    await s.waitFor(2);
    s.child.stdin.end();
    await s.exited;
    const res = JSON.parse(s.lines()[1] as string) as {
      result: { resultType: string; isError?: boolean };
    };
    expect(res.result.resultType).toBe('complete');
    expect(res.result.isError).toBeUndefined();

    const bad = session(tmpdir(), ['--cwd', join(dir, 'missing')]);
    bad.child.stdin.end();
    expect(await bad.exited).toBe(2);
    expect(bad.lines()).toEqual([]);
    expect(bad.stderr()).toMatch(/not a directory/);
  });

  it('help documents the client configuration', () => {
    const help = readFileSync(join(root, 'packages/cli/src/commands/mcp.ts'), 'utf8');
    expect(help).toContain('"command": "overfull"');
    expect(help).toContain('"args": ["mcp"]');
  });
});
